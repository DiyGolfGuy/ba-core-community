// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/xlsxwriter.js - A SMALL SPREADSHEET WRITER OF OUR OWN (Sep 23 2026)
//
// The yearly report as a workbook an accountant opens straight into Excel,
// Numbers or LibreOffice: one tab per section, a bold frozen header row, money
// as real numbers with a dollar format (so it adds up), every string written
// inline (no shared-string table to get wrong). The file is the Office Open XML
// the spreadsheet programs read, zipped with the archiver the backups use.
'use strict';
const fs = require('fs');
const { ZipArchive } = require('archiver');

const esc = s => String(s == null ? '' : s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')          // not allowed in XML 1.0
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// cell styles (styles.xml cellXfs, in this order)
const STYLE = { text: 0, head: 1, money: 2, int: 3, pct: 4, num: 5, bold: 6, boldMoney: 7 };
// a sheet name Excel accepts: 31 characters, none of []:*?/\ , unique in the book
function sheetName(s, used) {
  let n = String(s || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let k = 2; const base = n; while (used.has(n.toLowerCase())) n = (base.slice(0, 28) + ' ' + k++).slice(0, 31);
  used.add(n.toLowerCase()); return n;
}
// one cell: a value typed by its column (or its own { v, t, bold })
function cell(ref, value, type, rowBold) {
  let v = value, t = type, bold = rowBold;
  if (value && typeof value === 'object' && 'v' in value) { v = value.v; t = value.t || type; bold = bold || !!value.bold; }
  if (v === null || v === undefined || v === '') return '';
  if (t === 'money' || t === 'int' || t === 'pct' || t === 'num') {
    const n = Number(v); if (!Number.isFinite(n)) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    const s = t === 'money' ? (bold ? STYLE.boldMoney : STYLE.money) : STYLE[t];
    return `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${STYLE.bold}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
function sheetXml(sh) {
  const cols = sh.columns;
  const widths = cols.map((c, i) => Math.min(60, Math.max(c.width || 0, String(c.h).length + 2,
    ...sh.rows.slice(0, 500).map(r => { const cells = Array.isArray(r) ? r : r.cells; const x = cells[i]; const v = x && typeof x === 'object' && 'v' in x ? x.v : x; return v == null ? 0 : String(v).length + 2; }))));
  const out = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`, `<sheetData>`];
  out.push(`<row r="1">${cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${STYLE.head}"><is><t xml:space="preserve">${esc(c.h)}</t></is></c>`).join('')}</row>`);
  sh.rows.forEach((r, ri) => {
    const cells = Array.isArray(r) ? r : r.cells; const bold = !Array.isArray(r) && !!r.bold;
    out.push(`<row r="${ri + 2}">${cols.map((c, i) => cell(colName(i) + (ri + 2), cells[i], c.type || 'text', bold)).join('')}</row>`);
  });
  out.push(`</sheetData></worksheet>`);
  return out.join('');
}
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;\\-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0&quot;%&quot;"/><numFmt numFmtId="166" formatCode="#,##0.0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3E3E3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** sheets: [{ name, columns: [{ h, type: text|money|int|pct|num, width }], rows: [[...] | { cells, bold }] }]
 *  money is in DOLLARS here (the caller divides). Resolves to outPath. */
function writeXlsx(sheets, outPath, { title = '', creator = 'BA Booking System' } = {}) {
  const used = new Set();
  const named = sheets.map(s => Object.assign({}, s, { name: sheetName(s.name, used) }));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(creator)}</Application></Properties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES_XML
  };
  named.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    const z = new ZipArchive({ zlib: { level: 9 } });
    out.on('close', () => resolve(outPath)); z.on('error', reject); out.on('error', reject);
    z.pipe(out);
    for (const [name, body] of Object.entries(files)) z.append(Buffer.from(body, 'utf8'), { name });
    z.finalize().catch(reject);
  });
}

module.exports = { writeXlsx, sheetName, colName };
