/* Shared browser helpers: DOM builder, icons, safe mini-markdown, API, theming. */
(function () {
  'use strict';

  /** h('div', {class:'x', onclick: fn}, child, 'text', [more]) — never uses innerHTML for data. */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    let value;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v; // only ever used with trusted, pre-escaped markup
        else if (k === 'value') value = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    if (value !== undefined) el.value = value; // after children so <select> options exist
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    check: ['M20 6 9 17l-5-5'],
    alert: ['circle:12,12,10', 'M12 8v4', 'M12 16h.01'],
    download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    copy: ['rect:9,9,13,13,2', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
    trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    up: ['M18 15l-6-6-6 6'],
    down: ['M6 9l6 6 6-6'],
    plus: ['M12 5v14', 'M5 12h14'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'circle:12,12,3'],
    share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    user: ['circle:12,8,4', 'M4 21a8 8 0 0 1 16 0'],
    search: ['circle:11,11,7', 'M21 21l-4.3-4.3'],
    edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
    x: ['M18 6 6 18', 'M6 6l12 12'],
    back: ['M19 12H5', 'M12 19l-7-7 7-7'],
    external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'],
    award: ['circle:12,8,6', 'M15.48 12.89 17 22l-5-3-5 3 1.52-9.11'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'],
    image: ['rect:3,3,18,18,2', 'circle:9,9,2', 'M21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21'],
    qr: ['rect:3,3,7,7,1', 'rect:14,3,7,7,1', 'rect:3,14,7,7,1', 'M14 14h3v3h-3z', 'M20 14v1', 'M20 18v3h-3', 'M14 20v1'],
    lock: ['rect:3,11,18,11,2', 'M7 11V7a5 5 0 0 1 10 0v4'],
    refresh: ['M21 12a9 9 0 1 1-2.64-6.36L21 8', 'M21 3v5h-5'],
    type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
    star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'],
    list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    settings: ['circle:12,12,3', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, size) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    if (size) { svg.style.width = size + 'px'; svg.style.height = size + 'px'; }
    for (const d of ICONS[name] || []) {
      let el;
      if (d.startsWith('circle:')) {
        const [cx, cy, r] = d.slice(7).split(',');
        el = document.createElementNS(SVGNS, 'circle');
        el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
      } else if (d.startsWith('rect:')) {
        const [x, y, w, hh, rx] = d.slice(5).split(',');
        el = document.createElementNS(SVGNS, 'rect');
        el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', rx || 0);
      } else {
        el = document.createElementNS(SVGNS, 'path');
        el.setAttribute('d', d);
      }
      svg.append(el);
    }
    return svg;
  }

  /* ---------- mini markdown: **bold**, *italic*, ***both***, links, line breaks ---------- */
  const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function emphasis(s) {
    return s
      .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  }
  function inline(raw) {
    return raw
      .split(/(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/g)
      .map((part, i) => (i % 2 ? `<a href="${escHTML(part)}" target="_blank" rel="noopener noreferrer">${escHTML(part)}</a>` : emphasis(escHTML(part))))
      .join('');
  }
  function md(src) {
    const text = String(src || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';
    return text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.split('\n').map(inline).join('<br>')}</p>`)
      .join('');
  }
  function rich(src, cls) {
    return h('div', { class: 'rich' + (cls ? ' ' + cls : ''), html: md(src) });
  }

  /* ---------- API ---------- */
  async function api(method, url, body, opts = {}) {
    const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'admin-app', ...(opts.headers || {}) } };
    if (body !== undefined) {
      if (opts.raw) init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw Object.assign(new Error('Network problem — check your internet connection and try again.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status, data });
    return data;
  }

  /* ---------- toast ---------- */
  let toastEl, toastTimer;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = 'toast' + (kind === 'error' ? ' error' : '')), kind === 'error' ? 4500 : 2600);
  }

  /* ---------- colors & theming ---------- */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = parseInt(m ? m[1] : '5e7a12', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function luminance([r, g, b]) {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function applyTheme(hex) {
    const base = hexToRgb(hex);
    let strong = base;
    for (let i = 0; i < 20 && contrast(strong, [255, 255, 255]) < 5; i++) strong = mix(strong, [0, 0, 0], 0.12);
    const hover = mix(strong, [0, 0, 0], 0.1);
    const ink = contrast(base, [255, 255, 255]) >= 3.2 ? '#ffffff' : '#1e2616';
    const s = document.documentElement.style;
    s.setProperty('--brand', rgbToHex(...base));
    s.setProperty('--brand-strong', rgbToHex(...(contrast(base, [255, 255, 255]) >= 5 ? hover : strong)));
    s.setProperty('--brand-ink', ink);
    s.setProperty('--brand-soft', rgbToHex(...mix(base, [255, 255, 255], 0.88)));
    s.setProperty('--brand-tint', `rgba(${base.join(',')}, 0.1)`);
    s.setProperty('--bg', rgbToHex(...mix(base, [247, 248, 244], 0.93)));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', rgbToHex(...base));
  }

  /* ---------- names (mirrors server lib/forms.js) ---------- */
  const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|x)$/i;
  function titleCase(s) {
    return s.toLocaleLowerCase().split(/(\s+|-|')/).map((w) => {
      if (!w || /^(\s+|-|')$/.test(w)) return w;
      if (ROMAN.test(w)) return w.toLocaleUpperCase();
      return w.charAt(0).toLocaleUpperCase() + w.slice(1);
    }).join('');
  }
  function formatName(raw, mode) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (mode === 'as-typed') return name;
    if (mode === 'upper') return name.toLocaleUpperCase();
    if (mode === 'title') return titleCase(name);
    if (/\p{L}/u.test(name) && (name === name.toLocaleUpperCase() || name === name.toLocaleLowerCase())) return titleCase(name);
    return name;
  }

  /* ---------- misc ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  function fmtDate(iso, withTime = true) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };
  function autosize(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return ta;
  }

  window.App = { h, append, icon, md, rich, escHTML, api, toast, applyTheme, hexToRgb, contrast, formatName, copyText, debounce, fmtDate, store, autosize };
})();
