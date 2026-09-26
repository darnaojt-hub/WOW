/* Certificate rendering: fonts, drawing the name on the background, JPG/PDF export. */
(function () {
  'use strict';

  const FONTS = [
    { family: 'Parisienne', cat: 'Script' },
    { family: 'Great Vibes', cat: 'Script' },
    { family: 'Pinyon Script', cat: 'Script' },
    { family: 'Alex Brush', cat: 'Script' },
    { family: 'Allura', cat: 'Script' },
    { family: 'Italianno', cat: 'Script' },
    { family: 'Sacramento', cat: 'Script' },
    { family: 'Rouge Script', cat: 'Script' },
    { family: 'Petit Formal Script', cat: 'Script' },
    { family: 'Monsieur La Doulaise', cat: 'Script' },
    { family: 'Mrs Saint Delafield', cat: 'Script' },
    { family: 'Tangerine', cat: 'Script', weights: [400, 700] },
    { family: 'Dancing Script', cat: 'Script', weights: [400, 500, 600, 700] },
    { family: 'Cinzel', cat: 'Serif', weights: [400, 500, 600, 700] },
    { family: 'Cinzel Decorative', cat: 'Serif', weights: [400, 700] },
    { family: 'Playfair Display', cat: 'Serif', weights: [400, 500, 600, 700] },
    { family: 'Cormorant Garamond', cat: 'Serif', weights: [400, 500, 600, 700] },
    { family: 'EB Garamond', cat: 'Serif', weights: [400, 500, 600, 700] },
    { family: 'Lora', cat: 'Serif', weights: [400, 500, 600, 700] },
    { family: 'Libre Baskerville', cat: 'Serif', weights: [400, 700] },
    { family: 'Montserrat', cat: 'Sans-serif', weights: [400, 500, 600, 700] },
    { family: 'Poppins', cat: 'Sans-serif', weights: [400, 500, 600, 700] },
  ];
  const CUSTOM = 'Custom';
  const fontDef = (family) => FONTS.find((f) => f.family === family) || FONTS[0];
  const weightsFor = (family) => (family === CUSTOM ? [400] : fontDef(family).weights || [400]);
  const nearestWeight = (family, w) => weightsFor(family).reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));

  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

  const cssLoads = new Map();
  function loadGoogleCss(def) {
    if (cssLoads.has(def.family)) return cssLoads.get(def.family);
    const fam = def.family.replace(/ /g, '+') + (def.weights ? ':wght@' + def.weights.join(';') : '');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
    const p = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
    document.head.append(link);
    cssLoads.set(def.family, p);
    return p;
  }

  const customLoads = new Map();
  const customFamily = (url) => 'CertCustom_' + String(url).replace(/[^A-Za-z0-9]/g, '').slice(-16);
  function loadCustomFont(url) {
    if (!customLoads.has(url)) {
      const face = new FontFace(customFamily(url), `url("${url}")`);
      customLoads.set(url, face.load().then((f) => { document.fonts.add(f); return true; }).catch(() => false));
    }
    return customLoads.get(url);
  }

  /**
   * Make sure the certificate font is ready for <canvas>; returns the CSS font-family to use.
   * @param cert certificate settings
   * @param customUrl URL of an uploaded font (or null)
   */
  async function ensureFont(cert, customUrl) {
    if (cert.font === CUSTOM && customUrl) {
      const ok = await withTimeout(loadCustomFont(customUrl), 8000);
      if (ok) return `"${customFamily(customUrl)}", serif`;
    }
    const def = fontDef(cert.font === CUSTOM ? 'Parisienne' : cert.font);
    const weight = nearestWeight(def.family, cert.weight || 400);
    await withTimeout(loadGoogleCss(def), 6000);
    try {
      await withTimeout(document.fonts.load(`${weight} 80px "${def.family}"`, 'AaBbCcÑñ'), 6000);
    } catch { /* fall back to whatever is available */ }
    return `"${def.family}", ${def.cat === 'Sans-serif' ? 'sans-serif' : def.cat === 'Script' ? 'cursive' : 'serif'}`;
  }

  const images = new Map();
  function loadImage(url) {
    if (!images.has(url)) {
      images.set(
        url,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => resolve(img);
          img.onerror = () => { images.delete(url); reject(new Error('Could not load the certificate image.')); };
          img.src = url;
        })
      );
    }
    return images.get(url);
  }

  /**
   * Draw background + name on a 2D context sized W×H. Returns the name's box (canvas px) or null.
   */
  function draw(ctx, img, W, H, name, cert, family) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    if (!name) return null;
    const weight = cert.font === CUSTOM ? 400 : nearestWeight(cert.font, cert.weight || 400);
    let size = cert.size * H;
    const maxW = cert.maxWidth * W;
    const setFont = () => (ctx.font = `${weight} ${size}px ${family}`);
    setFont();
    const w = ctx.measureText(name).width;
    if (w > maxW) {
      size *= maxW / w;
      setFont();
    }
    // Center on the font's shape (not this particular name) so every name sits on the same baseline.
    const ref = ctx.measureText('Hg');
    const x = cert.x * W;
    const baseline = cert.y * H + (ref.actualBoundingBoxAscent - ref.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = cert.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, x, baseline);
    const m = ctx.measureText(name);
    return {
      left: x - m.actualBoundingBoxLeft,
      right: x + m.actualBoundingBoxRight,
      top: baseline - Math.max(m.actualBoundingBoxAscent, ref.actualBoundingBoxAscent),
      bottom: baseline + Math.max(m.actualBoundingBoxDescent, ref.actualBoundingBoxDescent),
      size,
    };
  }

  /** Render a full certificate to a new canvas. width: output width in px (default: image's own). */
  async function render({ bgUrl, cert, name, fontUrl, width }) {
    const [img, family] = await Promise.all([loadImage(bgUrl), ensureFont(cert, fontUrl)]);
    const W = Math.round(width ? Math.min(width, img.naturalWidth) : img.naturalWidth);
    const H = Math.round((W * img.naturalHeight) / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    draw(ctx, img, W, H, name, cert, family);
    return canvas;
  }

  const toBlob = (canvas, type = 'image/jpeg', q = 0.93) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), type, q));

  /** Build a PDF (one page per certificate) from JPEG bytes — no libraries needed. */
  function buildPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let offset = 0;
    const push = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); offset += b.length; };
    push('%PDF-1.4\n%âãÏÓ\n');
    offsets[1] = offset;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offsets[2] = offset;
    push(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
    pages.forEach((p, i) => {
      const pn = 3 + 3 * i, cn = pn + 1, im = pn + 2;
      const PW = 842; // A4 landscape width in points; height follows the image's shape
      const PH = +((PW * p.h) / p.w).toFixed(2);
      offsets[pn] = offset;
      push(`${pn} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>\nendobj\n`);
      const content = `q\n${PW} 0 0 ${PH} 0 0 cm\n/Im0 Do\nQ\n`;
      offsets[cn] = offset;
      push(`${cn} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
      offsets[im] = offset;
      push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream\nendobj\n');
    });
    const size = 3 + 3 * pages.length;
    const xref = offset;
    let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let k = 1; k < size; k++) table += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    push(table);
    push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  async function canvasToPdfPage(canvas, q = 0.92) {
    const blob = await toBlob(canvas, 'image/jpeg', q);
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function fileName(pattern, name, title, ext) {
    const base = String(pattern || 'Certificate - {name}')
      .replace(/\{name\}/gi, name || '')
      .replace(/\{title\}/gi, title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `${base || 'Certificate'}.${ext}`;
  }

  const fileUrl = (formId, kind, meta) => (meta ? `/files/${formId}/${kind}?v=${meta.v}` : null);

  window.Cert = { FONTS, CUSTOM, weightsFor, nearestWeight, ensureFont, loadImage, draw, render, toBlob, buildPdf, canvasToPdfPage, download, fileName, fileUrl };
})();
