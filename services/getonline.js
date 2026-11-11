// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/getonline.js - GETTING THE BOX ONLINE: "Connect my box" and the domain check the chat reads (BA Core 2 AI,
// Oct 21 2026)
//
// maintainer: "if they have a domain it gets pointed at the box. that is the way i think we need to do this. as much on the
// customer as possible and as easy as possible for them to do it ... make sure the AI can do all of that and really guide
// them in a meaningfull way from real documents and tests." The owner's own Cloudflare account and domain (ways 2 and 3 of
// docs/internal/PLAN-ORDER-TO-BOX-2026-10-21.md, and way 1 after its handover); the box makes its own connection.
//
// CONNECT MY BOX - cloudflared's own steps, run by the box as itself (no new root rights):
//   1. `cloudflared tunnel login`, its home this box's tunnel/signin: it prints Cloudflare's sign-in link and waits (ten
//      tries of a minute each) while the owner signs in, picks the domain and taps Authorize; Cloudflare hands it cert.pem.
//   2. `cloudflared tunnel create --credentials-file <file> <name>`: the box's own tunnel and its credentials.
//   3. `cloudflared tunnel route dns <id> <address>` for each address: the record pointing it at the tunnel. A record
//      already there is never replaced unless the owner said so (--overwrite-dns) - it may be their current website.
//   4. tunnel/config.yml: the tunnel, its credentials file, and each address to this box's own port.
//   5. cert.pem DELETED. It "allows users to create, delete, and manage all tunnels for the account"; the credentials file
//      "only allows the user to run that specific tunnel, and do nothing else" (Cloudflare's tunnel permissions page).
//   6. The tunnel service restarted with the one command the app may run for it (rule 19), then the address asked from
//      outside. The box's image runs that service from tunnel/config.yml (a call for the image, confirmed with maintainer first).
// The messages read here are cloudflared's own (github.com/cloudflare/cloudflared, master, read Oct 21 2026):
// cmd/cloudflared/tunnel/login.go, token/transfer.go, subcommand_context.go, subcommands.go, cfapi/hostname.go and
// credentials/origin_cert.go.
//
// THE DOMAIN CHECK asks Cloudflare's public resolver (DNS over HTTPS) about the OWNER's domain: its nameservers (on
// Cloudflare yet?), its email records (do they come across?), DNSSEC at the registry (off before the nameservers change),
// and where the address points now. None of it goes to BA.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { getConfig } = require('./config');

const APP_DIR = process.env.BA_APP_DIR || path.join(__dirname, '..');
const DIR = path.join(APP_DIR, 'tunnel');                 // the box's own: never in a pack, never in git (.gitignore)
const SIGNIN_HOME = path.join(DIR, 'signin');              // cloudflared's home while it signs in - cert.pem lands here
const CERT = path.join(SIGNIN_HOME, '.cloudflared', 'cert.pem');
const CONFIG = path.join(DIR, 'config.yml');
const STATE = path.join(DIR, 'state.json');
const BIN = () => process.env.BA_CLOUDFLARED || 'cloudflared';
const SUDO = () => process.env.BA_TEST_SUDO || 'sudo';
const SYSTEMCTL = () => process.env.BA_TEST_SYSTEMCTL || 'systemctl';
const DOH = () => process.env.BA_TEST_DOH_URL || 'https://cloudflare-dns.com/dns-query';
const LINK_WAIT_MS = 30000;                                // the sign-in link is printed at once
const LOGIN_WAIT_MS = 12 * 60000;                          // cloudflared asks ten times, a minute each, then gives up
const PROBE_TRIES = Number(process.env.BA_TEST_PROBE_TRIES) || 12, PROBE_GAP_MS = Number(process.env.BA_TEST_PROBE_GAP_MS) || 10000;
// an address a site can answer at: labels of letters, digits and hyphens, a name ending in letters
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const adminLog = (ev, d) => { try { require('./db').adminLog(ev, d); } catch {} };

function readState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch { return {}; } }
function writeState(s) { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(STATE + '.tmp', STATE); }
const lastLine = (t) => String(t || '').split('\n').map(l => l.replace(/^\S+\s+(INF|ERR|WRN|DBG)\s+/, '').trim()).filter(Boolean).pop() || '';

/** cloudflared, run as the box with its sign-in home; { code, out, missing } - never throws. */
function run(args, timeout = 120000) {
  return new Promise(resolve => {
    execFile(BIN(), args, { env: Object.assign({}, process.env, { HOME: SIGNIN_HOME, TUNNEL_ORIGIN_CERT: CERT }), timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '') + String(stderr || ''), missing: !!(err && err.code === 'ENOENT') });
    });
  });
}
function sh(cmd, args, timeout = 15000) {
  return new Promise(resolve => execFile(cmd, args, { encoding: 'utf8', timeout }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '') + String(stderr || '') })));
}

/** The box's tunnel service: 'active', 'inactive', 'failed', ... or 'none' when this box has no such service. */
async function serviceState() {
  const u = await sh(SYSTEMCTL(), ['list-unit-files', 'cloudflared.service']);
  if (u.code !== 0 || !/cloudflared\.service/.test(u.out)) return 'none';
  const a = await sh(SYSTEMCTL(), ['is-active', 'cloudflared']);
  return (a.out.trim().split('\n').pop() || 'inactive').trim();
}

/** The address list as the owner gave it, made plain: lower case, no scheme or path. */
function addressesOf(list) {
  return [...new Set((Array.isArray(list) ? list : [list]).map(a => String(a || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')).filter(Boolean))];
}

// ── the job: one connection at a time ─────────────────────────────────────────
let _job = null;   // { stage, url, error, addresses, replace, startedAt, finishedAt, reachable, child }
function publicJob() {
  if (!_job) return null;
  const { stage, url, error, addresses, replace, startedAt, finishedAt, reachable } = _job;
  return { stage, url, error, addresses, replace, startedAt, finishedAt, reachable: reachable === undefined ? null : reachable };
}
function finish(stage, error) {
  _job.stage = stage; _job.error = error || null; _job.finishedAt = new Date().toISOString();
  // the sign-in is never kept past the job, whatever happened (it can manage every tunnel in the owner's account)
  try { fs.rmSync(path.join(SIGNIN_HOME, '.cloudflared'), { recursive: true, force: true }); } catch {}
  if (error) adminLog('ONLINE_CONNECT_FAILED', `${_job.addresses.join(', ')}: ${error}`.slice(0, 300));
}

/** What the box knows of its connection. Nothing secret in it. */
async function status() {
  // the slow questions first, then the state and the job read together - read apart, a connection finishing in between
  // showed its job done beside the state from before it
  const ver = await run(['--version'], 10000), service = await serviceState();
  const st = readState();
  return {
    connected: !!(st.tunnelId && fs.existsSync(CONFIG)), addresses: st.addresses || [], tunnel: st.tunnelId ? st.tunnelId.slice(0, 8) : null,
    connectedAt: st.connectedAt || null, reachable: st.reachable === undefined ? null : st.reachable, checkedAt: st.checkedAt || null,
    program: ver.code === 0 ? ((/(\d{4}\.\d+\.\d+)/.exec(ver.out) || [])[1] || 'present') : null,
    service, job: publicJob()
  };
}

/**
 * Start "Connect my box" for these addresses. Resolves once Cloudflare's sign-in link is known: { started, url } or
 * { error }. The rest runs on its own - the owner signs in, then the box finishes (read it with status()).
 */
async function connect(list, { replace = false } = {}) {
  if (_job && !_job.finishedAt) return { error: `connecting is already under way (${_job.stage}) - finish the sign-in or wait for it to end` };
  const addresses = addressesOf(list);
  if (!addresses.length) return { error: 'say which address the site should answer at - yourgolf.com, or book.yourgolf.com' };
  const bad = addresses.find(a => !HOST_RE.test(a)); if (bad) return { error: `"${bad}" is not an address a site can answer at` };
  const ver = await run(['--version'], 10000);
  if (ver.missing || ver.code !== 0) return { error: 'the connection program (cloudflared) is not installed on this Pi - follow the Cloudflare Tunnel guide (Admin > Guides) to install it and connect your domain' };
  // a sign-in left from an earlier try: cloudflared refuses to sign in over one ("You have an existing certificate at ...")
  try { fs.rmSync(path.join(SIGNIN_HOME, '.cloudflared'), { recursive: true, force: true }); } catch {}
  fs.mkdirSync(path.join(SIGNIN_HOME, '.cloudflared'), { recursive: true, mode: 0o700 });
  _job = { stage: 'starting', url: null, error: null, addresses, replace: !!replace, startedAt: new Date().toISOString(), finishedAt: null };
  const job = _job;
  let out = '';
  const child = spawn(BIN(), ['tunnel', 'login'], { env: Object.assign({}, process.env, { HOME: SIGNIN_HOME }), stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  const backstop = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, LOGIN_WAIT_MS);
  // the link: the line after "Please open the following URL ..." (no browser on the box) or "A browser window should have
  // opened at the following URL:" (token/transfer.go)
  const link = new Promise(resolve => {
    const look = () => {
      const lines = out.split('\n'); const at = lines.findIndex(l => /following URL/i.test(l));
      if (at < 0) return;
      const u = lines.slice(at + 1).map(l => l.trim()).find(l => /^https:\/\/\S+$/.test(l));   // shown to the owner as a button: https only
      if (u) resolve(u);
    };
    child.stdout.on('data', d => { out += d; look(); });
    child.stderr.on('data', d => { out += d; look(); });
    child.on('error', () => resolve(null));
    child.on('exit', () => resolve(null));
    setTimeout(() => resolve(null), LINK_WAIT_MS);
  });
  child.on('exit', (code) => {
    clearTimeout(backstop);
    if (job !== _job || job.finishedAt) return;
    if (code === 0 && fs.existsSync(CERT)) { afterSignin(job).catch(e => { if (!job.finishedAt) finish('failed', String(e && e.message || e).slice(0, 200)); }); return; }
    if (/Failed to fetch resource/.test(out)) return finish('failed', 'the sign-in was not finished in time (about ten minutes) - ask again, and open the link straight away');
    if (/existing certificate/.test(out)) return finish('failed', 'an earlier sign-in was still on the box - ask again');
    finish('failed', 'the sign-in did not finish: ' + (lastLine(out) || 'cloudflared stopped (' + code + ')'));
  });
  const url = await link;
  if (!url) {
    try { child.kill('SIGTERM'); } catch {}
    if (!job.finishedAt) finish('failed', 'the connection program did not show a sign-in link: ' + (lastLine(out) || 'nothing'));
    return { error: job.error };
  }
  job.url = url; job.stage = 'waiting-for-signin';
  return { started: true, url, job: publicJob() };
}

/** After the owner authorized: the tunnel, its records, the config, the certificate gone, the service, the check. */
async function afterSignin(job) {
  job.stage = 'making-the-tunnel';
  const prev = readState();
  const name = 'ba-box-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const credTmp = path.join(DIR, name + '.json');
  const made = await run(['tunnel', 'create', '--credentials-file', credTmp, name]);
  const m = /Created tunnel (\S+) with id ([0-9a-f-]{36})/.exec(made.out);
  if (made.code !== 0 || !m || !fs.existsSync(credTmp)) { try { fs.rmSync(credTmp, { force: true }); } catch {} return finish('failed', 'Cloudflare did not make the tunnel: ' + (lastLine(made.out) || 'no answer')); }
  const id = m[2];
  job.stage = 'pointing-the-address';
  for (const a of job.addresses) {
    const r = await run(['tunnel', 'route', 'dns'].concat(job.replace ? ['--overwrite-dns'] : []).concat([id, a]));
    if (r.code === 0 && /Added CNAME|already configured to route to your tunnel|updated to route to your tunnel/.test(r.out)) continue;
    // nothing half-made is left: the new tunnel goes again (the sign-in is still here to do it), the address says why
    await run(['tunnel', 'delete', id]);
    try { fs.rmSync(credTmp, { force: true }); } catch {}
    const there = /already exists|record with that host/i.test(r.out);
    return finish('failed', there
      ? `${a} already has a record in Cloudflare - it may be your current website. Say "replace it" to put the box there instead, or pick another address such as book.${a.replace(/^www\./, '')}`
      : `Cloudflare did not point ${a} at the box: ${lastLine(r.out) || 'no answer'}`);
  }
  // the box's earlier tunnel, while the sign-in can still remove it
  if (prev.tunnelId && prev.tunnelId !== id) {
    const d = await run(['tunnel', 'delete', '-f', prev.tunnelId]);
    if (d.code !== 0) adminLog('ONLINE_OLD_TUNNEL_KEPT', `the earlier tunnel ${String(prev.tunnelId).slice(0, 8)} could not be removed from the Cloudflare account (${lastLine(d.out).slice(0, 120)}) - delete it on Cloudflare's Tunnels page`);
    try { fs.rmSync(path.join(DIR, prev.tunnelId + '.json'), { force: true }); } catch {}
  }
  const cred = path.join(DIR, id + '.json');
  fs.renameSync(credTmp, cred); fs.chmodSync(cred, 0o600);
  const port = Number((getConfig().server || {}).port) || 3001;
  const yml = [`tunnel: ${id}`, `credentials-file: ${cred}`, 'ingress:']
    .concat(...job.addresses.map(a => [`  - hostname: ${a}`, `    service: http://127.0.0.1:${port}`]), ['  - service: http_status:404', '']).join('\n');
  fs.writeFileSync(CONFIG + '.tmp', yml, { mode: 0o600 }); fs.renameSync(CONFIG + '.tmp', CONFIG);
  writeState({ tunnelId: id, tunnelName: name, addresses: job.addresses, connectedAt: new Date().toISOString(), replaced: job.replace ? job.addresses : [] });
  // the certificate can manage every tunnel in the owner's account: it goes now, before anything else can fail
  try { fs.rmSync(path.join(SIGNIN_HOME, '.cloudflared'), { recursive: true, force: true }); } catch {}
  adminLog('ONLINE_CONNECTED', `${job.addresses.join(', ')} - the box's own tunnel ${id.slice(0, 8)} in the owner's Cloudflare account; the sign-in certificate deleted, only this tunnel's credentials kept`);
  job.stage = 'starting-the-connection';
  if (await serviceState() === 'none') return finish('no-service', 'the connection is made, but this Pi has no cloudflared service this software can restart - finish with the Cloudflare Tunnel guide (Admin > Guides)');
  const rs = await sh(SUDO(), ['-n', '/usr/bin/systemctl', 'restart', 'cloudflared'], 60000);
  if (rs.code !== 0) return finish('failed', 'the connection is made, but its service would not restart: ' + (lastLine(rs.out) || 'no answer'));
  job.stage = 'checking-from-outside';
  job.reachable = await reachable(job.addresses[0]);
  const st = readState(); st.reachable = job.reachable; st.checkedAt = new Date().toISOString(); writeState(st);
  // the website's own address (links, search, the setup checklist's "Website address") - asked once (rule 2): set here when
  // the owner has not set one
  try {
    const { saveConfig } = require('./config'); const cfg = getConfig();
    if (!(cfg.seo && cfg.seo.domain)) { cfg.seo = Object.assign({}, cfg.seo, { domain: 'https://' + job.addresses[0] }); saveConfig(cfg); }
  } catch {}
  finish('done');
}

/** The address asked from outside (through Cloudflare) the way a visitor would: the box's own /api/time. */
async function reachable(address, tries = PROBE_TRIES) {
  const u = process.env.BA_TEST_ONLINE_PROBE ? process.env.BA_TEST_ONLINE_PROBE.replace('{host}', address) : `https://${address}/api/time`;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: 'follow' }); if (r.ok) return true; } catch {}
    if (i < tries - 1) await new Promise(r => setTimeout(r, PROBE_GAP_MS));
  }
  return false;
}
/** "Is my site up yet": the first address asked again from outside, remembered for the card. */
async function checkNow() {
  const st = readState();
  if (!st.addresses || !st.addresses.length) return { error: 'the box is not connected yet - say "connect my box"' };
  st.reachable = await reachable(st.addresses[0], 1); st.checkedAt = new Date().toISOString(); writeState(st);
  return { address: st.addresses[0], reachable: st.reachable, service: await serviceState() };
}
/** Stop waiting for the sign-in. */
function cancel() {
  if (!_job || _job.finishedAt) return { cancelled: false };
  // once signed in the box is making the connection: it finishes (a few seconds), whole or not at all
  if (!['starting', 'waiting-for-signin'].includes(_job.stage)) return { cancelled: false, why: 'signed in already - the box is finishing the connection' };
  try { _job.child && _job.child.kill('SIGTERM'); } catch {}
  finish('cancelled', null);
  return { cancelled: true };
}

// ── the domain check ──────────────────────────────────────────────────────────
const TYPE = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, AAAA: 28, DS: 43 };
async function doh(name, type) {
  const r = await fetch(`${DOH()}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('the lookup answered ' + r.status);
  const j = await r.json();
  return { status: Number(j.Status), answers: (j.Answer || []).filter(a => a && a.type === TYPE[type]).map(a => String(a.data).replace(/\.$/, '')) };
}
/** What the world sees of a domain, in facts and in plain sentences for the chat. Never throws. */
async function checkDomain(given) {
  const [address] = addressesOf(given);
  if (!address || !HOST_RE.test(address)) return { error: `"${given}" is not a domain - say it like yourgolf.com` };
  try {
    // the zone: the address, or the domain above it that holds the nameservers (book.yourgolf.com -> yourgolf.com)
    let zone = address, ns = await doh(zone, 'NS');
    while (!ns.answers.length && zone.split('.').length > 2) { zone = zone.split('.').slice(1).join('.'); ns = await doh(zone, 'NS'); }
    if (ns.status === 3) return { address, zone, registered: false, says: [`${zone} is not registered (or not active) - buy it in Cloudflare, or check the spelling.`] };
    const [mx, ds, a, cname] = await Promise.all([doh(zone, 'MX'), doh(zone, 'DS'), doh(address, 'A'), doh(address, 'CNAME')]);
    const onCloudflare = ns.answers.length > 0 && ns.answers.every(n => /\.ns\.cloudflare\.com$/i.test(n));
    const says = [];
    if (onCloudflare) says.push(`${zone} is on Cloudflare's nameservers (${ns.answers.join(', ')}) - ready for "connect my box".`);
    else says.push(`${zone} uses ${ns.answers.join(', ') || 'no nameservers I can see'} - add it to your Cloudflare account, then change its nameservers at the company you bought it from to the two Cloudflare shows you.`);
    if (ds.answers.length && !onCloudflare) says.push(`DNSSEC is on for ${zone} - turn it off at that company first, or the domain stops answering when the nameservers change.`);
    if (mx.answers.length) says.push(`${zone} receives email (${mx.answers.join(', ')}). When you add it to Cloudflare, check those email records are on Cloudflare's DNS page before you switch.`);
    if (a.answers.length || cname.answers.length) says.push(`${address} points somewhere now (${cname.answers.concat(a.answers).join(', ')}). If that is your current website, the box can take ${address} (replacing it) or a part of it such as book.${zone}.`);
    return { address, zone, registered: true, nameservers: ns.answers, onCloudflare, email: mx.answers, dnssec: ds.answers.length > 0, pointsTo: cname.answers.concat(a.answers), says };
  } catch (e) { return { address, error: 'the lookup could not be made just now (' + String(e && e.message || e).slice(0, 80) + ') - try again in a minute' }; }
}

module.exports = { status, connect, cancel, checkNow, checkDomain, addressesOf, DIR, CONFIG, CERT };
