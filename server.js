'use strict';
/*
 * Evaluation Form + Certificate app — zero dependencies (Node >= 22.13).
 *   Participant form:  /f/<link>
 *   Certificate link:  /c/<token>
 *   Admin panel:       /admin
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./lib/store');
const { validateSubmission, templateConfig } = require('./lib/forms');
const { sniffImage, sniffFont } = require('./lib/sniff');

const PORT = Number(process.env.PORT) || 3000;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Manila';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON = 1024 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data: blob:",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `File is too large (max ${Math.round(limit / 1048576)} MB).`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

/** Fixed-window rate limiter keyed by string. */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, windowMs).unref();
  const entry = (key) => {
    const t = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < t) hits.set(key, (h = { n: 0, reset: t + windowMs }));
    return h;
  };
  /** Counts this attempt; returns false once the key is over the limit. */
  const take = (key) => ++entry(key).n <= max;
  take.blocked = (key) => entry(key).n >= max; // check without counting
  take.fail = (key) => { entry(key).n++; }; // count only failures
  return take;
}
const loginLimiter = limiter(10, 15 * 60 * 1000);
const submitLimiter = limiter(240, 60 * 1000); // campuses share IPs; keep generous

/* ------------------------------------------------------------------ */
/* static files                                                        */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, relPath) {
  const filePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    ETag: etag,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(filePath).pipe(res);
  return true;
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler, ...opts });
}

function currentAdmin(req) {
  return store.getSessionAdmin(parseCookies(req).sid);
}
function requireAdmin(req) {
  const admin = currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Please sign in again.');
  // CSRF guard: browsers can't add custom headers to cross-site requests without CORS approval
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'admin-app') throw new HttpError(403, 'Forbidden.');
  return admin;
}
function formOr404(id) {
  const form = store.getForm(Number(id));
  if (!form) throw new HttpError(404, 'Form not found.');
  return form;
}
const FILE_KINDS = ['cert', 'banner', 'font'];

function adminFormPayload(form) {
  return { ...form, files: store.fileVersions(form.id), responseCount: store.countResponses(form.id) };
}

/* ---------- public API ---------- */
route('GET', '/api/public/forms/:slug', (req, res, p, url) => {
  const form = store.getFormBySlug(decodeURIComponent(p.slug));
  if (!form) throw new HttpError(404, 'This form does not exist. Please check the link.');
  const preview = url.searchParams.get('preview') === '1' && currentAdmin(req);
  const files = store.fileVersions(form.id);
  const c = form.config;
  if (!form.isOpen && !preview) {
    return sendJSON(res, 200, {
      id: form.id,
      open: false,
      config: { title: c.title, themeColor: c.themeColor, closedMessage: c.closedMessage },
      files: { banner: files.banner },
    });
  }
  sendJSON(res, 200, { id: form.id, slug: form.slug, open: form.isOpen, preview: Boolean(preview), config: c, files });
});

route('POST', '/api/public/forms/:slug/responses', async (req, res, p, url) => {
  if (!submitLimiter(clientIp(req))) throw new HttpError(429, 'Too many submissions from your network. Please wait a minute and try again.');
  const form = store.getFormBySlug(decodeURIComponent(p.slug));
  if (!form) throw new HttpError(404, 'This form does not exist.');
  const preview = url.searchParams.get('preview') === '1' && currentAdmin(req);
  if (!form.isOpen && !preview) throw new HttpError(403, 'This form is no longer accepting responses.');
  const body = await readJSON(req);
  const { errors, clean } = validateSubmission(form.config, body);
  if (!errors.email && clean.email && form.config.onePerEmail && !preview && store.emailUsed(form.id, clean.email)) {
    errors.email = 'This email has already submitted a response. Check your saved certificate link, or contact the organizers.';
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted questions.', { errors });
  if (preview) return sendJSON(res, 200, { ok: true, preview: true, certName: clean.certName, token: null });
  const saved = store.addResponse(form.id, clean);
  sendJSON(res, 201, { ok: true, certName: clean.certName, token: saved.token });
});

route('GET', '/api/public/certificates/:token', (req, res, p) => {
  const r = store.getResponseByToken(decodeURIComponent(p.token));
  if (!r) throw new HttpError(404, 'Certificate not found. Please check the link.');
  const form = store.getForm(r.formId);
  if (!form) throw new HttpError(404, 'Certificate not found.');
  const c = form.config;
  sendJSON(res, 200, {
    name: r.certName,
    issuedAt: r.createdAt,
    form: { id: form.id, slug: form.slug, title: c.title, themeColor: c.themeColor, certificate: c.certificate },
    files: store.fileVersions(form.id),
  });
});

route('GET', '/files/:formId/:kind', (req, res, p) => {
  if (!FILE_KINDS.includes(p.kind)) throw new HttpError(404, 'Not found.');
  const file = store.getFile(Number(p.formId), p.kind);
  if (!file) throw new HttpError(404, 'Not found.');
  const etag = `"${file.version}"`;
  const headers = { ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Type': file.mime, 'Content-Length': file.data.length, 'Access-Control-Allow-Origin': '*' });
  res.end(file.data);
});

/* ---------- admin auth ---------- */
route('POST', '/api/admin/login', async (req, res) => {
  const ip = clientIp(req);
  if (loginLimiter.blocked(ip)) throw new HttpError(429, 'Too many wrong sign-in attempts. Please wait 15 minutes.');
  const { username, password } = await readJSON(req);
  const admin = store.findAdmin(username);
  if (!admin || !store.verifyPassword(password || '', admin.pass_hash)) {
    loginLimiter.fail(ip);
    throw new HttpError(401, 'Wrong username or password.');
  }
  const { token, maxAge } = store.createSession(admin.id);
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
  sendJSON(res, 200, { username: admin.username, mustChange: Boolean(admin.must_change) });
});

route('POST', '/api/admin/logout', (req, res) => {
  store.deleteSession(parseCookies(req).sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/admin/session', (req, res) => {
  const admin = currentAdmin(req);
  sendJSON(res, 200, admin ? { signedIn: true, username: admin.username, mustChange: admin.mustChange } : { signedIn: false });
});

route('POST', '/api/admin/account', async (req, res) => {
  const me = requireAdmin(req);
  const { currentPassword, username, newPassword } = await readJSON(req);
  const admin = store.getAdmin(me.id);
  if (!store.verifyPassword(currentPassword || '', admin.pass_hash)) throw new HttpError(400, 'Your current password is incorrect.');
  const name = String(username || admin.username).trim();
  if (!/^[\w.@-]{3,40}$/.test(name)) throw new HttpError(400, 'Username must be 3–40 letters, numbers, dots, dashes or underscores.');
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  const other = store.findAdmin(name);
  if (other && other.id !== me.id) throw new HttpError(400, 'That username is taken.');
  store.updateAdminCredentials(me.id, name, newPassword, parseCookies(req).sid);
  sendJSON(res, 200, { username: name, mustChange: false });
});

/* ---------- admin forms ---------- */
route('GET', '/api/admin/forms', (req, res) => {
  requireAdmin(req);
  sendJSON(res, 200, store.listForms().map((f) => ({ id: f.id, slug: f.slug, isOpen: f.isOpen, title: f.config.title, themeColor: f.config.themeColor, responseCount: f.responseCount, lastResponse: f.lastResponse, updatedAt: f.updatedAt })));
});

route('POST', '/api/admin/forms', async (req, res) => {
  requireAdmin(req);
  const { title } = await readJSON(req);
  const form = store.createForm(templateConfig(title ? { title: String(title).slice(0, 200) } : {}));
  sendJSON(res, 201, adminFormPayload(form));
});

route('GET', '/api/admin/forms/:id', (req, res, p) => {
  requireAdmin(req);
  sendJSON(res, 200, adminFormPayload(formOr404(p.id)));
});

route('PUT', '/api/admin/forms/:id', async (req, res, p) => {
  requireAdmin(req);
  formOr404(p.id);
  const body = await readJSON(req);
  if (body.slug !== undefined && !store.slugify(body.slug)) throw new HttpError(400, 'Please enter a form link.');
  const form = store.updateForm(Number(p.id), { config: body.config, slug: body.slug, isOpen: body.isOpen });
  sendJSON(res, 200, adminFormPayload(form));
});

route('POST', '/api/admin/forms/:id/duplicate', (req, res, p) => {
  requireAdmin(req);
  formOr404(p.id);
  sendJSON(res, 201, adminFormPayload(store.duplicateForm(Number(p.id))));
});

route('DELETE', '/api/admin/forms/:id', (req, res, p) => {
  requireAdmin(req);
  formOr404(p.id);
  store.deleteForm(Number(p.id));
  sendJSON(res, 200, { ok: true });
});

route('PUT', '/api/admin/forms/:id/files/:kind', async (req, res, p) => {
  requireAdmin(req);
  const form = formOr404(p.id);
  if (!FILE_KINDS.includes(p.kind)) throw new HttpError(404, 'Not found.');
  const data = await readBody(req, MAX_UPLOAD);
  const name = decodeURIComponent(String(req.headers['x-file-name'] || '')).slice(0, 120);
  if (p.kind === 'font') {
    const font = sniffFont(data);
    if (!font) throw new HttpError(400, 'Please upload a font file (.ttf, .otf, .woff or .woff2).');
    store.putFile(form.id, 'font', { mime: font.mime, name, data });
  } else {
    const img = sniffImage(data);
    if (!img) throw new HttpError(400, 'Please upload a PNG, JPG or WebP image.');
    store.putFile(form.id, p.kind, { mime: img.mime, name, width: img.width, height: img.height, data });
  }
  sendJSON(res, 200, { files: store.fileVersions(form.id) });
});

route('DELETE', '/api/admin/forms/:id/files/:kind', (req, res, p) => {
  requireAdmin(req);
  const form = formOr404(p.id);
  store.deleteFile(form.id, p.kind);
  sendJSON(res, 200, { files: store.fileVersions(form.id) });
});

/* ---------- admin responses ---------- */
route('GET', '/api/admin/forms/:id/responses', (req, res, p) => {
  requireAdmin(req);
  const form = formOr404(p.id);
  sendJSON(res, 200, { responses: store.listResponses(form.id) });
});

route('DELETE', '/api/admin/forms/:id/responses', (req, res, p) => {
  requireAdmin(req);
  const form = formOr404(p.id);
  store.clearResponses(form.id);
  sendJSON(res, 200, { ok: true });
});

route('PATCH', '/api/admin/responses/:rid', async (req, res, p) => {
  requireAdmin(req);
  const r = store.getResponse(Number(p.rid));
  if (!r) throw new HttpError(404, 'Response not found.');
  const { certName } = await readJSON(req);
  const name = String(certName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'Name cannot be empty.');
  store.renameResponse(r.id, name);
  sendJSON(res, 200, { ok: true, certName: name });
});

route('DELETE', '/api/admin/responses/:rid', (req, res, p) => {
  requireAdmin(req);
  store.deleteResponse(Number(p.rid));
  sendJSON(res, 200, { ok: true });
});

function csvCell(v) {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function formatStamp(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

route('GET', '/api/admin/forms/:id/responses.csv', (req, res, p) => {
  requireAdmin(req);
  const form = formOr404(p.id);
  const c = form.config;
  const responses = store.listResponses(form.id).reverse();
  const qs = c.questions.filter((q) => q.type !== 'section' && q.type !== 'certname');
  let n = 0;
  const qTitle = (q) => (q.type === 'scale' && c.numberScaleQuestions ? `${++n}. ${q.title}` : q.title);
  const header = ['Timestamp', ...(c.collectEmail || responses.some((r) => r.email) ? ['Email'] : []), ...qs.map(qTitle), 'Name in the Certificate', 'Certificate link'];
  const withEmail = header.includes('Email');
  const base = baseUrl(req);
  const rows = responses.map((r) => [
    formatStamp(r.createdAt),
    ...(withEmail ? [r.email || ''] : []),
    ...qs.map((q) => r.answers[q.id]),
    r.certName,
    `${base}/c/${r.token}`,
  ]);
  const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const fname = `${store.slugify(c.title)}-responses.csv`;
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store' });
  res.end(csv);
});

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */
const PAGES = [
  [/^\/admin\/?$/, 'admin.html'],
  [/^\/f\/[^/]+\/?$/, 'form.html'],
  [/^\/c\/[^/]+\/?$/, 'cert.html'],
];

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/') || pathname.startsWith('/files/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
        await r.handler(req, res, params, url);
        return;
      }
      throw new HttpError(404, 'Not found.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    for (const [re, file] of PAGES) if (re.test(pathname) && serveStatic(req, res, file)) return;
    if (serveStatic(req, res, decodeURIComponent(pathname).replace(/^\/+/, ''))) return;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font:16px system-ui;padding:40px">Page not found.</p>');
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJSON(res, status, { error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message, ...(err.extra || {}) });
    else res.end();
  }
});

const created = store.seed();
server.listen(PORT, () => {
  console.log(`Evaluation app running on http://localhost:${PORT}  (admin: /admin, data: ${store.DB_PATH})`);
  if (created && created.usedDefault) {
    console.log(`First run: admin account "${created.username}" created with the default password "admin123". Sign in and change it right away (or set ADMIN_PASSWORD before first start).`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
