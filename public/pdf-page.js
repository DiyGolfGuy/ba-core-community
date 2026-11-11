// Copyright (c) 2025-2026 BA Custom Products LLC.
// pdf-page.js - a PDF PAGE (W45, Sep 10 2026): the owner uploads a document
// (a menu, a league flyer, a price sheet) and it renders INLINE with the
// vendored pdf.js - on the unit, no CDN. Every page is drawn to a canvas
// sized to the column; on a phone the same viewer plus the Open / Download
// buttons the markup already carries. If rendering fails the buttons remain.
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';

const host = document.getElementById('pdfPage');
const pagesEl = document.getElementById('pdfPages');
const status = document.getElementById('pdfStatus');
if (host && pagesEl) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const src = host.getAttribute('data-src');
  const say = t => { if (status) status.textContent = t; };
  (async () => {
    try {
      say('Loading the document...');
      const doc = await pdfjsLib.getDocument({ url: src, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
      const width = Math.min(pagesEl.clientWidth || 800, 1000);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.style.width = Math.floor(vp.width / dpr) + 'px'; canvas.style.height = Math.floor(vp.height / dpr) + 'px';
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Page ' + n + ' of ' + doc.numPages);
        pagesEl.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
      say(doc.numPages === 1 ? '1 page' : doc.numPages + ' pages');
      host.setAttribute('data-rendered', String(doc.numPages));
    } catch (e) {
      say('The document could not be shown here - use Open or Download.');
      host.setAttribute('data-rendered', 'error');
    }
  })();
}
