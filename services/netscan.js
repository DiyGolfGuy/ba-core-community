// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/netscan.js - WHAT IS ON THE FACILITY'S NETWORK (Oct 19 2026)
//
// maintainer: "link the PC ... it'll be like, hey, find the I. P of this p c because here's a bunch of ips that I have which
// ones this pc". The box looks at its own network the way an owner's laptop could:
//   - every address on the box's own /24 is tried on the ports a Windows PC answers on (SMB 445, RPC 135, Remote
//     Desktop 3389) - a plain connection, nothing sent, nothing logged in to;
//   - a PC that answers is asked its own name the way Windows names itself on a network (a NetBIOS name query, UDP 137,
//     RFC 1002 4.2.18): "BAY2-PC";
//   - the hardware address (MAC - what Wake-on-LAN needs) comes from the box's own neighbour table, /proc/net/arp,
//     which every connection above has just filled. No root, no new sudo (rule 19), no tool that is not already on the box.
// The owner then says which PC is in which bay; the assistant writes the address and the MAC into that bay's settings
// (bay_pc_link). Nothing here changes anything.
//   - an address that is not a PC but answers on the web port is asked GET /shelly (Shelly's own discovery address, no
//     login - services/shelly.js info()): a Shelly plug says its model, generation and its own name. The assistant puts
//     it on a bay (bay_plug_add) and switches it (plug_switch).
'use strict';
const os = require('os');
const net = require('net');
const fs = require('fs');
const dgram = require('dgram');
const crypto = require('crypto');

const PORTS = (process.env.BA_TEST_SCAN_PORTS || '445,135,3389').split(',').map(Number);
// a Shelly plug answers on the web port (Oct 19 2026: the scan finds the plugs too - services/shelly.js info())
const PLUG_PORT = Number(process.env.BA_TEST_PLUG_PORT) || 80;
const NBNS_PORT = Number(process.env.BA_TEST_NBNS_PORT) || 137;
const CONNECT_MS = Number(process.env.BA_TEST_SCAN_MS) || 400;
const PARALLEL = 64;

/** The box's own address and the /24 it sits on: { self, base, hosts: [ips] } - or null with no network. */
function localNet() {
  if (process.env.BA_TEST_SCAN_HOSTS) { const hosts = process.env.BA_TEST_SCAN_HOSTS.split(','); return { self: null, base: null, hosts }; }
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal || !/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a.address)) continue;   // a private LAN only
    const base = a.address.split('.').slice(0, 3).join('.');
    const hosts = []; for (let i = 1; i < 255; i++) { const ip = `${base}.${i}`; if (ip !== a.address) hosts.push(ip); }
    return { self: a.address, base, hosts };
  }
  return null;
}

function tryPort(ip, port) {
  return new Promise(resolve => {
    const s = net.connect({ host: ip, port });
    const done = (open) => { s.destroy(); resolve(open); };
    s.setTimeout(CONNECT_MS, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** A NetBIOS node-status query (NBSTAT for "*"): the PC's own name, or null. */
function nbName(ip) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const id = crypto.randomBytes(2);
    const name = Buffer.alloc(34); name[0] = 0x20;
    const raw = Buffer.alloc(16); raw[0] = 0x2a;   // "*" padded with NULs
    for (let i = 0; i < 16; i++) { name[1 + i * 2] = 0x41 + (raw[i] >> 4); name[2 + i * 2] = 0x41 + (raw[i] & 0x0f); }
    const q = Buffer.concat([id, Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), name, Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01])]);
    const t = setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 800);
    sock.on('error', () => { clearTimeout(t); try { sock.close(); } catch {} resolve(null); });
    sock.on('message', (m) => {
      clearTimeout(t); try { sock.close(); } catch {}
      try {
        if (m.length < 57 || m[0] !== id[0] || m[1] !== id[1]) return resolve(null);
        let o = 12; while (o < m.length && m[o] !== 0) o += m[o] + 1; o += 1;   // the answer's name
        o += 2 + 2 + 4 + 2;                                                     // type, class, ttl, length
        const n = m[o]; o += 1;
        for (let i = 0; i < n && o + 18 <= m.length; i++, o += 18) {
          const label = m.slice(o, o + 15).toString('latin1').replace(/[\x00 ]+$/, ''); const suffix = m[o + 15]; const group = (m[o + 16] & 0x80) !== 0;
          if (suffix === 0x00 && !group && label) return resolve(label);   // the workstation's own (unique) name
        }
        resolve(null);
      } catch { resolve(null); }
    });
    sock.send(q, NBNS_PORT, ip, () => {});
  });
}

function arpTable() {
  const out = new Map();
  try {
    for (const line of fs.readFileSync(process.env.BA_TEST_ARP_FILE || '/proc/net/arp', 'utf8').split('\n').slice(1)) {
      const c = line.trim().split(/\s+/); if (c.length >= 4 && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(c[3]) && c[3] !== '00:00:00:00:00:00') out.set(c[0], c[3].toLowerCase());
    }
  } catch {}
  return out;
}

/** Everything that answered: the PCs [{ ip, name, mac, ports }] and the Shelly plugs [{ ip, gen, model, app, id, mac,
 *  login, name }], the box's own address left out. */
async function scan() {
  const ln = localNet();
  if (!ln) return { network: null, found: [], plugs: [], note: 'this box is not on a private network' };
  const found = [], web = [];
  const queue = ln.hosts.slice();
  const worker = async () => {
    while (queue.length) {
      const ip = queue.shift(); const open = [];
      for (const p of PORTS) if (await tryPort(ip, p)) open.push(p);
      if (open.length) found.push({ ip, ports: open });
      else if (await tryPort(ip, PLUG_PORT)) web.push(ip);   // not a PC: is it a plug?
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length || 1) }, worker));
  const arp = arpTable();
  for (const f of found) {   // every port tried is one a Windows PC answers on, so every answer is asked its name
    f.name = await nbName(f.ip);
    f.mac = arp.get(f.ip) || null;
  }
  found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  // the plugs: each web answer asked GET /shelly - nothing else on the network is touched beyond that one question
  const shelly = require('./shelly');
  const plugs = (await Promise.all(web.map(ip => shelly.info(PLUG_PORT === 80 ? ip : ip + ':' + PLUG_PORT).catch(() => null)))).filter(Boolean);
  for (const p of plugs) if (!p.mac) p.mac = arp.get(p.ip.split(':')[0]) || null;
  plugs.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { network: ln.base ? ln.base + '.0/24' : 'test', self: ln.self, found, plugs };
}

module.exports = { scan, nbName, localNet, arpTable };
