// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// test-year-export.js - THE YEAR-END REPORT (maintainer, Sep 23 2026)
//
// "Yearly export: names out by default, optional, encrypted when included.
//  Build your own small PDF writer rather than adding a library."
// One facility with every kind of money, staged on disk in a past year (2025)
// and a real time zone before the unit boots - the same year test-revenue
// proves the definition on - and the report asked for through the owner's
// route. Every figure is read back out of the files the owner gets: the CSVs,
// the workbook parsed by an independent reader (python's zipfile + XML), and
// the PDF opened by the vendored pdf.js.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };
const root = __dirname;
const PORT = 3135;
const B = 'http://127.0.0.1:' + PORT;
const PW = 'year-export-battery-pw';
const H = { 'x-admin-password': PW };
const TZ = 'America/Chicago';
const PASSPHRASE = 'year report phrase 2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function utc(localYmdHm) {
  const [d, t] = localYmdHm.split(' ');
  for (const off of [5, 6]) {
    const guess = new Date(`${d}T${t}:00Z`); guess.setUTCHours(guess.getUTCHours() + off);
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(guess).replace(',', '');
    if (back.replace(/^(\d{4}-\d\d-\d\d) 24:/, '$1 00:') === `${d} ${t}`) return guess.toISOString().slice(0, 19).replace('T', ' ');
  }
  throw new Error('no UTC for ' + localYmdHm);
}

// the money of 2025 (the same shapes test-revenue proves the definition on)
const SESSIONS = [
  ['yx-paid',     'completed', 5000, 350, 'pi_ya', 'ch_ya', '2025-03-02 09:00', '2025-03-09'],
  ['yx-expired',  'expired',   4000, 280, 'pi_yb', '',      '2025-03-02 10:00', '2025-03-10'],
  ['yx-halfkept', 'cancelled', 6000, 420, 'pi_yc', 'ch_yc', '2025-03-03 11:00', '2025-03-20'],
  ['yx-fullref',  'expired',   4000, 280, 'pi_yd', 'ch_yd', '2025-03-04 12:00', '2025-03-04'],
  ['yx-latref',   'cancelled', 2000, 140, 'pi_ye', 'ch_ye', '2025-03-10 13:00', '2025-04-05'],
  ['yx-door',     'completed', 3000, 0,   '',      '',      '2025-03-11 14:00', '2025-03-11'],
];
const REFUNDS = [['re_yc', 'yx-halfkept', 3000, '2025-03-05 09:30'], ['re_yd', 'yx-fullref', 4280, '2025-03-06 09:30'], ['re_ye', 'yx-latref', 2140, '2025-04-02 09:30']];
const COUNTER = [['yp-card', 'card', 2000, 300, '2025-03-11 15:00'], ['yp-cash', 'cash', 1500, 0, '2025-03-12 16:00'], ['yp-check', 'check', 1000, 0, '2025-03-13 17:00'],
  ['yp-credit', 'credit', 800, 0, '2025-03-14 18:00'], ['yp-gift', 'gift', 500, 0, '2025-03-15 19:00'], ['yp-late', 'cash', 700, 0, '2025-03-31 23:30']];
const GIFTS = [['yg-sold', 50.00, true, '2025-03-16 10:00'], ['yg-comp', 25.00, false, '2025-03-16 11:00']];
const DUES = [['in_y1', 5900, 0, '2025-03-17 08:00']];
const MARCH = 5350 + 6420 + 4280 + 2140 + 2000 + 1500 + 1000 + 700 + 5000 + 5900 - 3000 - 4280;
const APRIL = -2140;
const YEAR = MARCH + APRIL;
const ITEMS = 4 + 4 + 1 + 1 + 3;          // sessions charged, counter card/cash/check/late-cash, a gift card sold, a membership payment, three refunds
const NAME_MARK = 'Customer yx-';

(async () => {
  try { const r = await fetch(B + '/api/time'); if (r.ok) { console.log('FAIL  port ' + PORT + ' already answers - an orphaned server is running.'); process.exit(1); } } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    businessName: 'Year Report Club', setup: { completed: true, eulaAccepted: true },
    server: { port: PORT, businessName: 'Year Report Club', adminPassword: PW, timezone: TZ },
    booking: { staffedAccess: true, pricePerHalfHour: 25, openTime: '09:00', closeTime: '21:00' }, waiver: { mode: 'off' },
    pos: { tax: { categories: { food: 8, beverage: 8, sim: 0 } } },
    bays: [{ id: 'yx-b1', name: 'Bay 1', active: true }]
  }, null, 2));
  const stage = { SESSIONS: SESSIONS.map(r => r.concat([utc(r[6])])), REFUNDS: REFUNDS.map(r => r.concat([utc(r[3])])),
    COUNTER: COUNTER.map(r => r.concat([utc(r[4])])), GIFTS: GIFTS.map(r => r.concat([utc(r[3])])), DUES: DUES.map(r => r.concat([utc(r[3])])),
    GIFT_USE: utc('2025-06-10 12:00'), DISC_USE: utc('2025-05-01 12:00'), FOOD: utc('2025-03-11 15:05'), JOIN: utc('2025-02-01 10:00') };
  const seed = spawnSync(process.execPath, ['-e', `
    const db = require('./services/db');
    (async () => {
      await db.initDb();
      require('./services/pos').ensureSchema();
      const S = ${JSON.stringify(stage)};
      for (const r of S.SESSIONS) db.db.prepare("INSERT INTO bookings (id,bay_id,bay_name,name,phone,email,date,start_time,end_time,end_date,duration_minutes,price_cents,tax_cents,status,stripe_payment_intent,stripe_charge_id,created_at) VALUES (?,'yx-b1','Bay 1',?,'+15550000','',?,'10:00','11:00',?,60,?,?,?,?,?,?)")
        .run(r[0], 'Customer ' + r[0], r[7], r[7], r[2], r[3], r[1], r[4], r[5], r[8]);
      for (const r of S.REFUNDS) db.markRefunded(r[1], new Date(r[4].replace(' ', 'T') + 'Z').toISOString(), { id: r[0], amount: r[2] }, 'battery');
      db.db.prepare("INSERT INTO tabs (id, label, status, opened_by) VALUES ('yx-tab','Counter','closed','Staff')").run();
      for (const r of S.COUNTER) db.db.prepare("INSERT INTO tab_payments (id,tab_id,method,amount_cents,tip_cents,employee,created_at) VALUES (?,'yx-tab',?,?,?,'Staff',?)").run(r[0], r[1], r[2], r[3], r[5]);
      db.db.prepare("INSERT INTO tab_items (id,tab_id,name,qty,unit_price_cents,tax_category,kind,status,sent_at) VALUES ('yx-food','yx-tab','Burger',1,1200,'food','menu','sent',?)").run(S.FOOD);
      db.db.prepare("INSERT INTO tab_items (id,tab_id,name,qty,unit_price_cents,tax_category,kind,status,sent_at) VALUES ('yx-void','yx-tab','Fries',1,500,'food','menu','voided',?)").run(S.FOOD);
      for (const r of S.GIFTS) db.db.prepare("INSERT INTO discount_codes (id,code,description,type,value,max_uses,uses_count,active,created_at) VALUES (?,?,?,'gift',?,NULL,0,1,?)").run(r[0], 'GC' + r[0].toUpperCase().replace(/[^A-Z0-9]/g, ''), JSON.stringify({ gift: true, paid: r[2], fromName: 'Giver ' + r[0] }), r[1], r[4]);
      db.db.prepare("INSERT INTO discount_uses (id,code_id,booking_id,phone,discount_cents,used_at) VALUES ('yx-gu','yg-sold','yx-paid','+15550000',1000,?)").run(S.GIFT_USE);
      db.db.prepare("INSERT INTO discount_codes (id,code,description,type,value,max_uses,uses_count,active,created_at) VALUES ('yx-save','SAVE10','','percent',10,NULL,1,1,?)").run(S.JOIN);
      db.db.prepare("INSERT INTO discount_uses (id,code_id,booking_id,phone,discount_cents,used_at) VALUES ('yx-du','yx-save','yx-paid','+15550000',500,?)").run(S.DISC_USE);
      db.db.prepare("INSERT INTO membership_tiers (id,name,discount_type,discount_value,price_monthly,active) VALUES ('yx-tier','Gold','percentage',10,59,1)").run();
      db.db.prepare("INSERT INTO members (id,tier_id,name,phone,pin,status,created_at) VALUES ('m-y1','yx-tier','Member Yx','+15550001','8801','active',?)").run(S.JOIN);
      for (const r of S.DUES) {
        const inv = { id: r[0], status: 'paid', amount_paid: r[1], tax: r[2], status_transitions: { paid_at: Math.floor(new Date(r[4].replace(' ', 'T') + 'Z').getTime() / 1000) } };
        db.recordMembershipPayment(inv, 'm-y1', 'webhook');
      }
      await db.flushed();
      process.exit(0);
    })().catch(e => { console.error(e.stack); process.exit(1); });`], { cwd: root, encoding: 'utf8', timeout: 60000 });
  ok('stage: a year of every kind of money written to disk before the unit starts', seed.status === 0, (seed.stderr || '').slice(-400));

  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { SMS_DRYRUN: '1', EMAIL_DRYRUN: '1', BA_DISABLE_SCHEDULER: '1' }) });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  process.on('exit', () => { try { child.kill('SIGINT'); } catch {} });
  let up = false; for (let i = 0; i < 50; i++) { await sleep(400); try { if ((await fetch(B + '/api/time')).ok) { up = true; break; } } catch {} }
  ok('stage: the unit is up', up, log.slice(-300));
  const tmp = fs.mkdtempSync(path.join(root, '.yearexport-'));
  const fetchFile = async (p, hdr) => { const r = await fetch(B + p, { headers: hdr || H }); const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {} return { s: r.status, buf, j, cd: r.headers.get('content-disposition') || '' }; };
  const unzip = (zipBuf, name) => { const z = path.join(tmp, name + '.zip'); fs.writeFileSync(z, zipBuf); const d = path.join(tmp, name); fs.mkdirSync(d); execFileSync('unzip', ['-q', z, '-d', d]); const top = fs.readdirSync(d)[0]; return path.join(d, top); };
  const csv = (dir, f) => { const t = fs.readFileSync(path.join(dir, 'csv', f), 'utf8').trim().split('\r\n'); const split = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }; const head = split(t[0]); return t.slice(1).map(l => { const v = split(l); const o = {}; head.forEach((h, i) => o[h] = v[i]); return o; }); };
  const cents = s => Math.round(parseFloat(s) * 100);

  console.log('── 1. without names - the default ──');
  // the card's work folder is shared: a backup a previous run's server was killed in
  // the middle of leaves its staging folder there (cleared after a day, like a power
  // cut's). Y23 grades what THIS battery's reports made, never what was already there.
  const workNow = () => { try { return fs.readdirSync(path.join(root, 'backups', '.work')); } catch { return []; } };
  const workBefore = new Set(workNow());
  let r = await fetchFile('/api/admin/records/year-report/2025');
  ok('Y1 the owner\'s route hands out a zip for 2025', r.s === 200 && r.buf.readUInt32LE(0) === 0x04034b50 && /year-report-club-2025-year-end\.zip/.test(r.cd), { s: r.s, cd: r.cd });
  const dir = r.s === 200 ? unzip(r.buf, 'plain') : tmp;
  const files = (() => { try { return fs.readdirSync(dir).concat(fs.readdirSync(path.join(dir, 'csv')).map(f => 'csv/' + f)); } catch { return []; } })();
  ok('Y2 it holds report.pdf, workbook.xlsx, README.txt and fourteen CSVs', ['report.pdf', 'workbook.xlsx', 'README.txt'].every(f => files.includes(f)) && files.filter(f => /^csv\/\d\d-.*\.csv$/.test(f)).length === 14, files);
  const summary = (() => { try { return csv(dir, '01-summary.csv'); } catch { return []; } })();
  const sv = label => { const row = summary.find(x => x.Item === label); return row ? row.Value : null; };
  const yr = (await (await fetch(B + '/api/admin/revenue/summary?start=2025-01-01&end=2025-12-31', { headers: H })).json()).range || {};
  const recs = ((await (await fetch(B + '/api/admin/records/status', { headers: H })).json()).yearly || []).find(x => x.year === 2025) || {};
  ok('Y3 the report\'s revenue is the Revenue tab\'s and the ten-year record\'s - one definition, three surfaces', cents(sv('Revenue - money taken, minus refunds')) === YEAR && yr.revenue_cents === YEAR && recs.revenue_cents === YEAR, { report: sv('Revenue - money taken, minus refunds'), tab: yr.revenue_cents, records: recs.revenue_cents, expected: YEAR });
  ok('Y4 ...with its parts: refunds, expired-unpaid named as not revenue, tips beside it', cents(sv('   Refunds')) === -(3000 + 4280 + 2140) && cents(sv('Not revenue: checkouts that expired unpaid')) === 4280 && cents(sv('Tips (the staff\'s - not revenue)')) === 300 && cents(sv('Take-home after estimated fees')) === yr.take_home_cents, summary.slice(0, 16));
  const months = (() => { try { return csv(dir, '02-months.csv'); } catch { return []; } })();
  const mrow = n => months.find(x => x.Month === n) || {};
  ok('Y5 month by month: March and April as the money moved (a refund lands in its own month), and the Year line adds up', cents(mrow('March').Revenue) === MARCH && cents(mrow('April').Revenue) === APRIL && cents(mrow('Year').Revenue) === YEAR && months.length === 13, months.map(m => [m.Month, m.Revenue]));
  const q = (() => { try { return csv(dir, '03-quarterly-tax.csv'); } catch { return []; } })();
  ok('Y6 quarterly tax: four quarters, Q1 and Q2 revenue match the months', q.length === 4 && cents(q[0].Revenue) === MARCH && cents(q[1].Revenue) === APRIL, q);
  const pays = (() => { try { return csv(dir, '04-payments.csv'); } catch { return []; } })();
  ok(`Y7 every payment and refund: ${ITEMS} lines that add up to the year, each with its booking or reference`, pays.length === ITEMS && pays.reduce((s, p) => s + cents(p.Amount), 0) === YEAR && pays.every(p => p.Reference), { n: pays.length, sum: pays.reduce((s, p) => s + cents(p.Amount), 0) });
  const everything = (() => { let t = ''; for (const f of files) { if (f.endsWith('.csv') || f.endsWith('.txt')) t += fs.readFileSync(path.join(dir, f), 'utf8'); } try { t += execFileSync('unzip', ['-p', path.join(dir, 'workbook.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch {} return t; })();
  ok('Y8 NO customer name anywhere - no Customer column, no name in any CSV, the README or the workbook (gift givers and members included)', pays.length === ITEMS && everything.includes('yx-halfkept') && !pays.some(p => 'Customer' in p) && !everything.includes(NAME_MARK) && !everything.includes('Giver yg-') && !everything.includes('Member Yx'), everything.match(/Customer yx-[a-z]+|Giver yg-[a-z]+|Member Yx/g));
  const gifts = (() => { try { return csv(dir, '10-gift-cards.csv'); } catch { return []; } })();
  const gv = k => (gifts.find(g => g.Item.startsWith(k)) || {}).Money;
  ok('Y9 gift cards: sold $50 (revenue), given free $25 (not), and the balance still on them at the year end ($40 on the sold card after $10 spent, $25 on the free one)', cents(gv('Gift cards sold')) === 5000 && cents(gv('Gift cards given free')) === 2500 && cents(gv('Balance still on sold cards')) === 4000 && cents(gv('Balance still on free cards')) === 2500, gifts);
  const counterPay = (() => { try { return csv(dir, '11-counter-payments.csv'); } catch { return []; } })();
  const sales = (() => { try { return csv(dir, '12-counter-sales.csv'); } catch { return []; } })();
  const ccc = counterPay.find(c => /^Card, cash and check/.test(c['Paid by'])) || {};
  ok('Y10 the counter: card, cash and check are revenue ($52.00 with $3.00 tips); member credit and gift spending are shown as stored value', cents(ccc.Money) === 5200 && cents(ccc.Tips) === 300 && cents((counterPay.find(c => /^Member credit/.test(c['Paid by'])) || {}).Money) === 800 && cents((counterPay.find(c => /^Gift card/.test(c['Paid by'])) || {}).Money) === 500, counterPay);
  ok('Y11 ...sales by tax category: the burger ($12.00, 8% = $0.96); the voided fries are not there', sales.length === 1 && sales[0]['Tax category'] === 'food' && cents(sales[0].Sales) === 1200 && cents(sales[0]['Tax at that rate']) === 96, sales);
  const disc = (() => { try { return csv(dir, '13-discounts.csv'); } catch { return []; } })();
  ok('Y12 discounts given: SAVE10 once, $5.00 - and no gift card among them', disc.length === 1 && disc[0].Code === 'SAVE10' && cents(disc[0]['Taken off']) === 500, disc);
  const tiers = (() => { try { return csv(dir, '08-membership-tiers.csv'); } catch { return []; } })();
  ok('Y13 memberships by tier: Gold - one joined, one payment of $59.00', tiers.length === 1 && tiers[0].Tier === 'Gold' && tiers[0]['Joined in the year'] === '1' && cents(tiers[0]['Payment money']) === 5900, tiers);
  const readme = (() => { try { return fs.readFileSync(path.join(dir, 'README.txt'), 'utf8'); } catch { return ''; } })();
  ok('Y14 the README says what revenue means, names every CSV, and says names were left out', /Money actually taken, minus refunds/.test(readme) && files.filter(f => f.startsWith('csv/')).every(f => readme.includes(f)) && /CUSTOMER NAMES: left out/.test(readme) && /America\/Chicago/.test(readme), readme.slice(0, 300));
  ok('Y14b ...and says counter tax is worked out at the rates set on the day the report is made, so a year when a rate changed is slightly off (maintainer, Sep 24 2026)', /COUNTER TAX BY CATEGORY/.test(readme) && /the day this report was made/.test(readme.replace(/\s+/g, ' ')) && /slightly off/.test(readme), (readme.split('COUNTER TAX')[1] || '').slice(0, 200));

  console.log('\n── 2. the files open in something that is not ours ──');
  // the workbook, read by python's zipfile + XML parser (an independent reader)
  let wb = null;
  try {
    wb = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, json, sys, xml.etree.ElementTree as ET
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist():
    if n.endswith('.xml') or n.endswith('.rels'): ET.fromstring(z.read(n))
wbk = ET.fromstring(z.read('xl/workbook.xml'))
names = [s.get('name') for s in wbk.find('m:sheets', ns)]
def cells(i):
    out = {}
    for c in ET.fromstring(z.read('xl/worksheets/sheet%d.xml' % i)).iter('{%s}c' % ns['m']):
        v = c.find('m:v', ns); t = c.find('m:is/m:t', ns)
        out[c.get('r')] = {'v': v.text if v is not None else (t.text if t is not None else None), 's': c.get('s'), 't': c.get('t')}
    return out
print(json.dumps({'names': names, 'summary': cells(1), 'months': cells(2)}))`, path.join(dir, 'workbook.xlsx')], { encoding: 'utf8' }));
  } catch (e) { wb = { error: String(e.message).slice(0, 300) }; }
  ok('Y15 the workbook is well-formed Office XML with a tab per section (14), read by an independent parser', wb && Array.isArray(wb.names) && wb.names.length === 14 && wb.names[0] === 'Summary', wb && (wb.names || wb.error));
  ok('Y16 ...and its money is a real NUMBER in a dollar format, not text (the revenue cell is ' + YEAR / 100 + ')', wb && wb.summary && wb.summary.B2 && Number(wb.summary.B2.v) === YEAR / 100 && wb.summary.B2.s && wb.summary.B2.t !== 'inlineStr' && Number(wb.months.B4.v) === MARCH / 100, wb && wb.summary && { B2: wb.summary.B2, B4m: wb.months && wb.months.B4 });
  // the PDF, opened by the vendored pdf.js - strictly
  let pdfOk = null;
  try {
    const buf = fs.readFileSync(path.join(dir, 'report.pdf'));
    const s = buf.toString('latin1');
    const sx = parseInt(s.slice(s.lastIndexOf('startxref') + 9).trim(), 10);
    const xrefOk = s.slice(sx, sx + 4) === 'xref' && (() => { const lines = s.slice(sx).split('\n'); const n = parseInt(lines[1].split(' ')[1], 10); for (let i = 1; i < n; i++) { const off = parseInt(lines[2 + i].slice(0, 10), 10); if (!s.slice(off, off + 20).startsWith(i + ' 0 obj')) return false; } return true; })();
    const pdfjs = await import(pathToFileURL(path.join(root, 'public', 'vendor', 'pdfjs', 'pdf.min.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'public', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), stopAtErrors: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0,
      standardFontDataUrl: path.join(root, 'public', 'vendor', 'pdfjs', 'standard_fonts') + path.sep }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(t => t.str).join(' ') + '\n';
    pdfOk = { pages: doc.numPages, xrefOk, text };
  } catch (e) { pdfOk = { error: String(e && e.message || e).slice(0, 300) }; }
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  ok('Y17 the PDF opens strictly in pdf.js, every cross-reference points at its object, and it carries the title, every section and the revenue figure', !!pdfOk && !pdfOk.error && pdfOk.xrefOk && pdfOk.pages >= 2 && /Year Report Club - 2025 year-end report/.test(pdfOk.text) &&
     ['Summary', 'Month by month', 'Quarterly tax', 'Every payment and refund', 'Gift cards', 'Discounts given', 'Notes'].every(t => pdfOk.text.includes(t)) && pdfOk.text.includes(money(YEAR)) && /Page 1 of \d+/.test(pdfOk.text), pdfOk && (pdfOk.error || { pages: pdfOk.pages, xrefOk: pdfOk.xrefOk }));
  ok('Y18 ...and no customer name in the PDF either', !!pdfOk && !!pdfOk.text && !pdfOk.text.includes(NAME_MARK));

  console.log('\n── 3. with names: encrypted, or not at all ──');
  r = await fetchFile('/api/admin/records/year-report/2025?names=1');
  ok('Y19 with no backup passphrase a report WITH names is refused in words - never a plain file of names', r.s === 409 && r.j && r.j.needsPassphrase === true && /passphrase/.test(r.j.error || ''), { s: r.s, j: r.j });
  await fetch(B + '/api/admin/backup/vault/passphrase', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ passphrase: PASSPHRASE }) });
  r = await fetchFile('/api/admin/records/year-report/2025?names=1');
  ok('Y20 with a passphrase the report with names comes down ENCRYPTED (.baenc)', r.s === 200 && r.buf.subarray(0, 6).toString() === 'BAENC1' && /\.baenc"/.test(r.cd), { s: r.s, cd: r.cd });
  let named = null;
  try { const enc = path.join(tmp, 'named.baenc'); fs.writeFileSync(enc, r.buf); require('./services/backupvault').decryptFile(enc, PASSPHRASE, path.join(tmp, 'named-dec.zip')); named = unzip(fs.readFileSync(path.join(tmp, 'named-dec.zip')), 'named'); } catch (e) { named = null; }
  const npays = (() => { try { return csv(named, '04-payments.csv'); } catch { return []; } })();
  ok('Y21 ...it opens with the passphrase, and now carries the Customer column with the names', npays.length === ITEMS && npays.some(p => p.Customer === 'Customer yx-paid') && /CUSTOMER NAMES: included/.test(fs.readFileSync(path.join(named || tmp, 'README.txt'), 'utf8') || ''), npays.slice(0, 2));
  const pc = ((await (await fetch(B + '/api/admin/health?fresh=1', { headers: H })).json()).signals || []).find(x => x.key === 'plaincopy');
  ok('Y22 neither report is an unencrypted copy on the health line (the plain one carries no person; the named one is encrypted)', !!pc && pc.level === 'green', pc);
  { const left = workNow().filter(f => !workBefore.has(f));
    ok('Y23 both were built on the card and cleared away - nothing the reports made is left in the work folder', left.length === 0, { left, alreadyThere: [...workBefore] }); }

  console.log('\n── 4. the year so far, the door, and the screens ──');
  const nowY = new Date().getFullYear();
  r = await fetchFile('/api/admin/records/year-report/' + nowY);
  const cur = r.s === 200 ? unzip(r.buf, 'current') : tmp;
  const curReadme = (() => { try { return fs.readFileSync(path.join(cur, 'README.txt'), 'utf8'); } catch { return ''; } })();
  ok('Y24 the current year comes as the year so far, and says so', r.s === 200 && /The year so far, through \d{4}-\d\d-\d\d/.test(curReadme), curReadme.slice(0, 200));
  r = await fetchFile('/api/admin/records/year-report/2025', {});
  ok('Y25 the report is the owner\'s alone (401 without a login)', r.s === 401, r.s);
  r = await fetchFile('/api/admin/records/year-report/' + (nowY + 1));
  ok('Y26 a year that has not happened is refused (400)', r.s === 400, r.s);
  const st = await (await fetch(B + '/api/admin/records/status', { headers: H })).json();
  ok('Y27 the Records card is offered every year with data, through this one', Array.isArray(st.report_years) && st.report_years.includes(2025) && st.report_years.includes(nowY), st.report_years);
  { const lg = await (await fetch(B + '/api/admin/log?limit=30', { headers: H })).json();
    ok('Y28 each report is in the owner\'s log, saying whether names were in it', (lg.entries || []).some(e => e.event === 'YEAR_REPORT' && /no customer names/.test(e.detail)) && (lg.entries || []).some(e => e.event === 'YEAR_REPORT' && /with customer names, encrypted/.test(e.detail)), (lg.entries || []).filter(e => e.event === 'YEAR_REPORT')); }
  { const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
    ok('Y29 the Records card carries the report (year, the names box, the button) and the Revenue tab points to it', /id="yexYear"/.test(html) && /id="yexNames"/.test(html) && /onclick="yearReport\(\)"/.test(html) && /id="revYearReportHint"[\s\S]{0,300}goYearReport\(event\)/.test(html) && /async function yearReport\(\)/.test(html)); }

  try { child.kill('SIGINT'); } catch {}
  await sleep(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  for (const f of ['config.json', 'bookings.db']) { try { fs.unlinkSync(path.join(root, f)); } catch {} }
  console.log(`\nYEAR EXPORT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
