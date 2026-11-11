// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-setup-checklist.js - THE CHECKLIST READS WHERE THE SETTING LIVES (Oct 3 2026).
//
// The owner's setup checklist ticked "Text messaging (Twilio)" from cfg.sms.accountSid. Nothing ever writes
// that key - the Twilio card saves cfg.twilio - so the item never ticked for a facility whose texts were going
// out. This boots the real server and reads the checklist through its own route:
//   C1  no texting keys: the item is not done
//   C2  Twilio's account id and token saved where the card saves them: the item is done
//   C3  MessageBird instead: the item is done (the sender texts through either)
//   C4  a placeholder left in the box (PASTE...) is not a connection
//   C5  an email key saved with NO From address: "Email sending connected" is not done, and the Texts and emails health
//       line is RED saying no email can be sent (every email was dropped with nothing red - the Sep 13 audit's MEDIUM)
//   C6  ...the From address added: the item is done and the line no longer says so
const { spawn } = require('child_process');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OWNER_PW = 'checklist-owner-1';

const UNIT_FILES = ['config.json', 'bookings.db'];
for (const f of UNIT_FILES) { try { fs.unlinkSync(f); } catch {} }
const base = {
  businessName: 'Checklist Test', setup: { completed: true, eulaAccepted: true },
  server: { port: 3001, businessName: 'Checklist Test', adminPassword: OWNER_PW, timezone: 'America/Chicago' },
  booking: { staffedAccess: true, pricePerHalfHour: 30 }, waiver: { mode: 'off' },
  bays: [{ id: 'sc1', name: 'Bay 1', active: true }]
};
fs.writeFileSync('config.json', JSON.stringify(base, null, 2));
// later writes change ONLY the texting keys, on the file as the server left it (it keeps its own password record there)
const write = extra => { const c = JSON.parse(fs.readFileSync('config.json', 'utf8')); delete c.twilio; delete c.messagebird; fs.writeFileSync('config.json', JSON.stringify(Object.assign(c, extra), null, 2)); };

(async () => {
  const B = 'http://localhost:3001';
  const ch = spawn('node', ['server.js'], { stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, { BA_BACKUP_SCAN_ROOTS: '/nonexistent' }) });
  process.on('exit', () => { try { ch.kill('SIGINT'); } catch {} });
  let up = false; for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('stage: the server boots', up);
  if (!up) process.exit(1);
  const item = async () => {
    const r = await fetch(B + '/api/admin/setup-status', { headers: { 'x-admin-password': OWNER_PW } });
    const d = await r.json().catch(() => ({}));
    return (d.items || []).find(i => i.id === 'twilio') || { missing: true, status: r.status };
  };
  const settle = () => sleep(1100);   // the server reads config by mtime; a write from here must be its own second

  let it = await item();
  ok('C1 no texting keys: "Text messaging" is not done', it.done === false, it);
  await settle(); write({ twilio: { accountSid: 'AC' + '1'.repeat(32), authToken: 'tok' + '2'.repeat(29), phoneNumber: '+15005550006' } }); await settle();
  it = await item();
  ok('C2 Twilio\'s account id and token saved where the Twilio card saves them (cfg.twilio): the item is done', it.done === true, it);
  await settle(); write({ messagebird: { apiKey: 'mb-key-123', workspaceId: 'ws', channelId: 'chan' } }); await settle();
  it = await item();
  ok('C3 MessageBird instead: the item is done - the sender texts through either', it.done === true, it);
  await settle(); write({ twilio: { accountSid: 'PASTE_YOUR_SID', authToken: 'x' } }); await settle();
  it = await item();
  ok('C4 a placeholder left in the box (PASTE...) is not a connection', it.done === false, it);

  const resendItem = async () => { const r = await fetch(B + '/api/admin/setup-status', { headers: { 'x-admin-password': OWNER_PW } }); const d = await r.json().catch(() => ({})); return (d.items || []).find(i => i.id === 'resend') || { missing: true }; };
  const msgLine = async () => { const r = await fetch(B + '/api/admin/health?fresh=1', { headers: { 'x-admin-password': OWNER_PW } }); const d = await r.json().catch(() => ({})); return (d.signals || []).find(x => x.key === 'messages') || { missing: true }; };
  const setResend = from => { const c = JSON.parse(fs.readFileSync('config.json', 'utf8')); c.resend = Object.assign({}, c.resend, { apiKey: 're_checklist_battery', fromEmail: from }); fs.writeFileSync('config.json', JSON.stringify(c, null, 2)); };
  await settle(); setResend(''); await settle();
  let ri = await resendItem(), ml = await msgLine();
  ok('C5 an email key with NO From address: "Email sending connected" is not done, and the Texts and emails line is RED saying no email can be sent', ri.done === false && /From address/.test(ri.sub || '') && ml.level === 'red' && /no From address/.test(ml.detail || '') && /Settings > Connections/.test(ml.action || ''), { ri, ml });
  await settle(); setResend('desk@checklist.example'); await settle();
  ri = await resendItem(); ml = await msgLine();
  ok('C6 ...the From address added: the item is done and the line no longer says it', ri.done === true && !/no From address/.test(ml.detail || ''), { ri, ml });

  try { ch.kill('SIGINT'); } catch {}
  await sleep(500);
  for (const f of UNIT_FILES) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\nSETUP CHECKLIST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
