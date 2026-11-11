// Copyright (c) 2025-2026 BA Custom Products LLC.
// Licensed under the PolyForm Shield License 1.0.0. See LICENSE.txt.
// services/pdfwriter.js - A SMALL PDF WRITER OF OUR OWN (maintainer, Sep 23 2026)
//
// "Build your own small PDF writer rather than adding a library." The yearly
// report is text and tables on plain pages, so this writes exactly that and
// nothing more: PDF 1.4, US Letter, the two standard fonts every PDF reader
// carries (Helvetica and Helvetica-Bold - nothing embedded, nothing to go
// missing in twenty years), text that wraps, tables that break across pages
// with their header repeated, thin rules, and "Page n of N" at the foot.
// Characters outside Latin-1 are spelled in plain ASCII (an em dash becomes a
// hyphen) so nothing is ever drawn as a blank box.
'use strict';
const zlib = require('zlib');

// Advance widths (1/1000 em) of codes 32..126, from the standard Adobe metrics.
const WIDTHS = {
  regular: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
            1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
            333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  bold:    [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
            975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
            333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584]
};
const TRANSLIT = { '—': '-', '–': '-', '‒': '-', '−': '-', '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"',
  '…': '...', '•': '-', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-' };

// Plain text the fonts can draw: Latin-1, everything else spelled in ASCII.
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c === 9) out += ' ';
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (c === 10 || c === 13) out += ' ';
    else out += '?';
  }
  return out;
}
function charWidth(c, bold) {
  const t = bold ? WIDTHS.bold : WIDTHS.regular;
  if (c >= 32 && c <= 126) return t[c - 32];
  if (c === 160) return 278;
  return bold ? 611 : 556;                 // accented Latin-1 letters: close to their base letters
}
function widthOf(s, size, bold) {
  let w = 0; const t = clean(s);
  for (let i = 0; i < t.length; i++) w += charWidth(t.charCodeAt(i), bold);
  return w * size / 1000;
}
// A PDF literal string, 7-bit clean (Latin-1 letters as octal escapes).
function lit(s) {
  const t = clean(s); let out = '(';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 40 || c === 41 || c === 92) out += '\\' + t[i];
    else if (c >= 32 && c <= 126) out += t[i];
    else out += '\\' + c.toString(8).padStart(3, '0');
  }
  return out + ')';
}
const n2 = v => (Math.round(v * 100) / 100).toString();

class PdfDoc {
  constructor({ title = '', author = '', size = [612, 792], margin = 50, footer = '' } = {}) {
    this.title = title; this.author = author; this.W = size[0]; this.H = size[1]; this.m = margin;
    this.footerText = footer; this.pages = []; this.page();
  }
  get width() { return this.W - 2 * this.m; }
  page() { this.cur = []; this.pages.push(this.cur); this.y = this.H - this.m; return this; }
  // room for h points, or a new page
  ensure(h) { if (this.y - h < this.m + 24) { this.page(); return true; } return false; }
  text(x, y, s, { size = 10, bold = false, gray = 0 } = {}) {
    this.cur.push(`BT ${n2(gray)} g /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(x)} ${n2(y)} Td ${lit(s)} Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6 } = {}) { this.cur.push(`${n2(gray)} G ${n2(width)} w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`); return this; }
  rect(x, y, w, h, { gray = 0.93 } = {}) { this.cur.push(`${n2(gray)} g ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`); return this; }
  // lines of text no wider than maxW
  wrap(s, maxW, size = 10, bold = false) {
    const text = clean(s); const indent = (text.match(/^ +/) || [''])[0];      // a leading indent is kept on the first line
    const words = text.slice(indent.length).split(/ +/); const lines = []; let cur = indent;
    for (let w of words) {
      while (widthOf(w, size, bold) > maxW && w.length > 1) {             // a word longer than the line is cut
        let k = w.length; while (k > 1 && widthOf(w.slice(0, k), size, bold) > maxW) k--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      const next = cur.trim() ? cur + ' ' + w : cur + w;
      if (widthOf(next, size, bold) <= maxW) cur = next; else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur.trim() || !lines.length) lines.push(cur);
    return lines;
  }
  // one line cut to fit, with "..."
  fit(s, maxW, size, bold) {
    let t = clean(s); if (widthOf(t, size, bold) <= maxW) return t;
    while (t.length > 1 && widthOf(t + '...', size, bold) > maxW) t = t.slice(0, -1);
    return t + '...';
  }
  heading(s, level = 1) {
    const size = level === 1 ? 18 : level === 2 ? 13 : 11;
    const gap = level === 1 ? 6 : 14;
    this.ensure(size + gap + 30);
    this.y -= gap + size;
    this.text(this.m, this.y, s, { size, bold: true });
    this.y -= level === 1 ? 8 : 5;
    if (level <= 2) { this.line(this.m, this.y, this.W - this.m, this.y, { width: level === 1 ? 1 : 0.5, gray: level === 1 ? 0.2 : 0.7 }); this.y -= 6; }
    return this;
  }
  para(s, { size = 9.5, gray = 0.15, bold = false, gap = 4 } = {}) {
    const lead = size * 1.35;
    for (const ln of this.wrap(s, this.width, size, bold)) { this.ensure(lead); this.y -= lead; this.text(this.m, this.y, ln, { size, gray, bold }); }
    this.y -= gap; return this;
  }
  space(h) { this.y -= h; return this; }
  // cols: [{ h, w (a share of the width), align: 'left'|'right' }]; rows: arrays of display strings.
  // A row may be { cells, bold: true } for a total line. Cells and headers WRAP
  // onto as many lines as they need - nothing in a report is cut short.
  table(cols, rows, { size = 8.5, zebra = true } = {}) {
    const total = cols.reduce((t, c) => t + (c.w || 1), 0);
    const widths = cols.map(c => this.width * (c.w || 1) / total);
    const lineH = size * 1.22, pad = 3, vpad = size * 0.32;
    const layout = (cells, bold) => cols.map((c, i) => this.wrap(cells[i] == null ? '' : String(cells[i]), widths[i] - 2 * pad, size, bold));
    const drawRow = (lines, bold, shade) => {
      const n = Math.max(1, ...lines.map(l => l.length));
      const h = n * lineH + 2 * vpad;
      const top = this.y;
      if (shade !== null) this.rect(this.m, top - h, this.width, h, { gray: shade });
      let x = this.m;
      cols.forEach((c, i) => {
        lines[i].forEach((t, k) => {
          const base = top - vpad - size * 0.9 - k * lineH;
          const tx = c.align === 'right' ? x + widths[i] - pad - widthOf(t, size, bold) : x + pad;
          this.text(tx, base, t, { size, bold });
        });
        x += widths[i];
      });
      this.y -= h;
      return h;
    };
    const headLines = layout(cols.map(c => c.h), true);
    const headH = Math.max(1, ...headLines.map(l => l.length)) * lineH + 2 * vpad;
    const head = () => { this.ensure(headH + lineH + 2 * vpad); drawRow(headLines, true, 0.85); };
    head();
    rows.forEach((row, r) => {
      const cells = Array.isArray(row) ? row : row.cells; const bold = !Array.isArray(row) && !!row.bold;
      const lines = layout(cells, bold);
      const h = Math.max(1, ...lines.map(l => l.length)) * lineH + 2 * vpad;
      if (this.ensure(h)) head();
      const top = this.y;
      drawRow(lines, bold, zebra && r % 2 === 1 ? 0.965 : null);
      if (bold) this.line(this.m, top, this.W - this.m, top, { width: 0.6, gray: 0.3 });
    });
    if (!rows.length) { this.ensure(lineH + 2 * vpad); this.y -= lineH + 2 * vpad; this.text(this.m + pad, this.y + vpad + size * 0.3, 'Nothing in this period.', { size, gray: 0.45 }); }
    this.y -= 8; return this;
  }
  // The finished file.
  toBuffer() {
    const objs = [];                                   // [number, body (Buffer)]
    const add = body => { objs.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objs.length; };
    const CAT = add(''), PAGES = add(''), F1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      F2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const d = new Date(); const pd = 'D:' + d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    const INFO = add(`<< /Title ${lit(this.title)} /Author ${lit(this.author)} /Producer (BA Booking System) /CreationDate (${pd}) >>`);
    const kids = []; const N = this.pages.length;
    this.pages.forEach((ops, i) => {
      const foot = [];
      if (this.footerText) foot.push(`BT 0.45 g /F1 7.5 Tf ${n2(this.m)} ${n2(this.m - 18)} Td ${lit(this.footerText)} Tj ET`);
      const pg = `Page ${i + 1} of ${N}`;
      foot.push(`BT 0.45 g /F1 7.5 Tf ${n2(this.W - this.m - widthOf(pg, 7.5, false))} ${n2(this.m - 18)} Td ${lit(pg)} Tj ET`);
      const raw = Buffer.from(ops.concat(foot).join('\n'), 'latin1');
      const z = zlib.deflateSync(raw);
      const content = add(Buffer.concat([Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream', 'latin1')]));
      kids.push(add(`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[CAT - 1] = Buffer.from(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`, 'latin1');
    objs[PAGES - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`, 'latin1');
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let off = parts[0].length; const xref = [];
    objs.forEach((body, i) => {
      xref.push(off);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b); off += b.length;
    });
    const xs = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f '].concat(xref.map(o => String(o).padStart(10, '0') + ' 00000 n ')).join('\n') + '\n';
    parts.push(Buffer.from(xs + `trailer\n<< /Size ${objs.length + 1} /Root ${CAT} 0 R /Info ${INFO} 0 R >>\nstartxref\n${off}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
}

module.exports = { PdfDoc, widthOf, clean };
