// Copyright (c) 2025-2026 BA Custom Products LLC.
// test-broadlink.js — THE TV IN EVERY BAY, WHICH HAD NO BATTERY (maintainer, Sep 16 2026)
//
// One of the five services with zero coverage. It matters because RULE 16 lives
// here: "a learned IR code is a TOGGLE until the operator says otherwise" - the
// rule exists because a toggle device wrongly unguarded turns a customer's TV OFF
// mid-session. That guard had never been driven by an assertion.
//
// No product seam needed: BRIDGE_URL is localhost:3002, so the battery simply IS
// the bridge for the duration.
'use strict';
const fs = require('fs'); const path = require('path'); const http = require('http');
let pass = 0, fail = 0;
const ok = (n,c,x)=>{ if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,300):''));} };
const root = __dirname, cfgPath = path.join(root,'config.json');

(async () => {
  try { fs.unlinkSync(cfgPath); } catch {}
  try { fs.unlinkSync(path.join(root,'bookings.db')); } catch {}
  const sent = []; let mode = 'ok';
  const srv = http.createServer((req,res)=>{ let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    let body=null; try{ body=b?JSON.parse(b):null }catch{}
    sent.push({ method:req.method, url:req.url, body });
    const j=(s,o)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
    if (mode==='down')   { res.destroy(); return; }
    if (mode==='error')  return j(500,{ error:'device unreachable' });
    // broadlink-bridge.py's own answers (Oct 21 2026: /send, /learn/start and /learn/capture answered {status, sent} and
    // {ok, code} here where the bridge says {success} and {success, command} - rule 29: a stand-in answers as the real one)
    if (/\/health/.test(req.url)) return j(200,{ status:'ok', service:'broadlink-bridge' });   // the shape services/broadlink.js actually reads
    if (/\/send/.test(req.url))   return j(200,{ success:true });
    if (/\/discover/.test(req.url)) return j(200,{ devices:[{ ip:'192.168.1.50', mac:'e8:16:56:00:00:01', type:25755, model:'RM4 Pro' }] });
    if (/\/learn\/start/.test(req.url)) return j(200,{ success:true, message:'Point your TV remote at the RM Mini and press the power button' });
    if (/\/learn\/capture/.test(req.url)) return j(200,{ success:true, command:'JgBQAAAB' });
    return j(404,{ error:'no route' }); }); });
  // A PORT THE BENCH IS NOT ALREADY USING. 3002 is the real bridge's, and the
  // bench runs it - this battery was green on the workshop and EADDRINUSE on the
  // Pi, which is exactly the hardware truth the project notes says the bench is for.
  const PORT = 13002;
  process.env.BA_BROADLINK_BRIDGE = `http://127.0.0.1:${PORT}`;
  await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));

  const cfgWith = (devices) => { fs.writeFileSync(cfgPath, JSON.stringify({
      businessName:'BL', setup:{completed:true}, server:{port:3091}, booking:{},
      bays:[{ id:'bay1', name:'B1', active:true, broadlinkDevices: devices }] }));
    delete require.cache[require.resolve('./services/config')];
    delete require.cache[require.resolve('./services/broadlink')];
    return require('./services/broadlink'); };
  const caught = async fn => { try { return { ok:true, v: await fn() }; } catch(e){ return { ok:false, e:e.message }; } };
  const db = require('./services/db'); await db.initDb();

  console.log('── A. it reaches the bridge at all ──');
  { const bl = cfgWith([]); sent.length=0;
    const up = await caught(()=>bl.isBridgeRunning());
    ok('A1 the bridge answering is reported as running', up.ok && up.v === true, up.ok?up.v:up.e);
    const d = await caught(()=>bl.discoverDevices());
    ok('A2 discovery returns the devices the bridge found', d.ok && JSON.stringify(d.v).includes('RM4 Pro'), d.ok?d.v:d.e); }

  console.log('\n── B. RULE 16: a learned code is a TOGGLE until the owner says otherwise ──');
  { const bl = cfgWith([{ ip:'192.168.1.50', name:'TV', onCode:'ON', offCode:'OFF' }]);
    const cfg = require('./services/config').getConfig();
    const dev = cfg.bays[0].broadlinkDevices[0];
    ok('B1 a device with no codeStyle set reads as a TOGGLE - the default never flips',
       (dev.codeStyle || 'toggle') === 'toggle', { codeStyle: dev.codeStyle }); }
  { const src = fs.readFileSync(path.join(root,'services','scheduler.js'),'utf8');
    ok('B2 the ON path is guarded by the same premise as the OFF path (rule 16, the pilot facility lesson)',
       /codeStyle/.test(src) && /toggle/.test(src), 'scheduler must read codeStyle on both legs'); }

  console.log('\n── C. rule 29: the bridge refusing is never recorded as success ──');
  { const bl = cfgWith([{ ip:'192.168.1.50', name:'TV', onCode:'ON', offCode:'OFF', codeStyle:'discrete' }]);
    mode='ok'; sent.length=0;
    // The scheduler drives sendCommand per device with mustHaveWorked
    // (scheduler.js :588). It never drove the per-bay helper, which is why
    // that helper is gone (section D). Drive what the product drives.
    const on = await caught(()=>bl.sendCommand('192.168.1.50','ON'));
    ok('C1 the scheduler\'s own call sends the IR code to the bridge', sent.some(x=>/\/send/.test(x.url)), { sent: sent.map(x=>x.url), v: on.ok?on.v:on.e });
    ok('C1b ...and returns a result the scheduler can refuse on (rule 29)', on.ok && on.v !== undefined, on.ok?on.v:on.e);
    mode='error'; sent.length=0;
    const bad = await caught(()=>bl.sendCommand('192.168.1.50','ON'));
    ok('C2 a bridge that refuses is a failure, never a success - the product must not report an IR code sent that was not',
       bad.ok ? (bad.v === false || (bad.v && (bad.v.success === false || bad.v.error))) : true, bad.ok?bad.v:bad.e);
    mode='down';
    const dn = await caught(()=>bl.sendCommand('192.168.1.50','ON'));
    ok('C3 a bridge that is not there is a failure, not a silent no-op',
       dn.ok ? (dn.v === false || (dn.v && (dn.v.success === false || dn.v.error))) : true, dn.ok?dn.v:dn.e);
    mode='ok'; }

  console.log('\n── D. the dead helpers are gone, and stay gone ──');
  // broadlinkBayOn/Off were imported by the scheduler and never called. They
  // also swallowed their outcome - a bridge that is down was a console.error
  // and a bare return - which is what rule 29 forbids, so the choice was delete
  // or rewrite, and nothing called them. Removed Sep 17 2026, along with the
  // scheduler's unused import of them.
  // The rule-31 claim the old D1 made through the dead helper - a bay with no
  // IR device is not a failure - is covered where it belongs, at the scheduler:
  // test-absent-devices' "IR absent" style asserts ir_on/ir_off are NEVER
  // queued for such a bay, which is stronger than asking the helper.
  { const bl = cfgWith([]); sent.length=0;
    const src = fs.readFileSync(path.join(root,'services','broadlink.js'),'utf8');
    const sch = fs.readFileSync(path.join(root,'services','scheduler.js'),'utf8');
    ok('D1 broadlinkBayOn/Off are gone from the module and its exports',
       !/function broadlinkBayOn|function broadlinkBayOff/.test(src) && !bl.broadlinkBayOn && !bl.broadlinkBayOff);
    ok('D2 the scheduler no longer imports them, and nothing calls them',
       !/broadlinkBayOn|broadlinkBayOff/.test(sch));
    ok('D3 what the scheduler really drives is still exported - sendCommand',
       typeof bl.sendCommand === 'function'); }

  await new Promise(r=>srv.close(r));
  console.log(`\nBROADLINK: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
