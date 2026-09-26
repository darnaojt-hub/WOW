'use strict';
/*
 * SQLite storage using Node's built-in driver (node:sqlite, Node >= 22.13).
 * One file holds everything: forms, uploaded images/fonts, responses, admin login.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { seedConfig, sanitizeConfig, templateConfig } = require('./forms');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  config TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  name TEXT,
  width INTEGER,
  height INTEGER,
  data BLOB NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (form_id, kind)
);
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  email TEXT,
  email_norm TEXT,
  cert_name TEXT NOT NULL,
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS responses_by_form ON responses(form_id, id);
CREATE INDEX IF NOT EXISTS responses_by_email ON responses(form_id, email_norm);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);

const now = () => new Date().toISOString();
const toBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ---------------- passwords & sessions ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function ensureAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM admins').get();
  if (row.n > 0) return null;
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const fromEnv = Boolean(process.env.ADMIN_PASSWORD);
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO admins (id, username, pass_hash, must_change) VALUES (1, ?, ?, ?)').run(username, hashPassword(password), fromEnv ? 0 : 1);
  return { username, usedDefault: !fromEnv };
}

const SESSION_DAYS = 14;
function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), adminId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return { token, maxAge: SESSION_DAYS * 86400 };
}
function getSessionAdmin(token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db
    .prepare('SELECT a.id, a.username, a.must_change FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(sha256(token), Date.now());
  return row ? { id: row.id, username: row.username, mustChange: Boolean(row.must_change) } : null;
}
function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}
function findAdmin(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim()) || null;
}
function getAdmin(id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id) || null;
}
function updateAdminCredentials(id, username, password, keepToken) {
  db.prepare('UPDATE admins SET username = ?, pass_hash = ?, must_change = 0 WHERE id = ?').run(username, hashPassword(password), id);
  // sign out every other session
  db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').run(id, sha256(keepToken || ''));
}

/* ---------------- forms ---------------- */
function rowToForm(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    isOpen: Boolean(row.is_open),
    config: sanitizeConfig(JSON.parse(row.config)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugify(s) {
  return (
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'form'
  );
}
function uniqueSlug(base, exceptId = 0) {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; db.prepare('SELECT id FROM forms WHERE slug = ? AND id != ?').get(slug, exceptId); i++) slug = `${root}-${i}`;
  return slug;
}

function listForms() {
  return db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS response_count,
              (SELECT MAX(created_at) FROM responses r WHERE r.form_id = f.id) AS last_response
       FROM forms f ORDER BY f.updated_at DESC`
    )
    .all()
    .map((row) => ({ ...rowToForm(row), responseCount: row.response_count, lastResponse: row.last_response }));
}
const getForm = (id) => rowToForm(db.prepare('SELECT * FROM forms WHERE id = ?').get(id));
const getFormBySlug = (slug) => rowToForm(db.prepare('SELECT * FROM forms WHERE slug = ?').get(slug));

function createForm(config, slugBase) {
  const clean = sanitizeConfig(config);
  const slug = uniqueSlug(slugBase || clean.title);
  const t = now();
  const info = db.prepare('INSERT INTO forms (slug, config, is_open, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(slug, JSON.stringify(clean), t, t);
  return getForm(Number(info.lastInsertRowid));
}

function updateForm(id, { config, slug, isOpen }) {
  const form = getForm(id);
  if (!form) return null;
  const next = {
    config: config !== undefined ? sanitizeConfig(config) : form.config,
    slug: slug !== undefined ? slugify(slug) : form.slug,
    isOpen: isOpen !== undefined ? Boolean(isOpen) : form.isOpen,
  };
  if (next.slug !== form.slug && db.prepare('SELECT id FROM forms WHERE slug = ? AND id != ?').get(next.slug, id)) {
    const err = new Error('That link is already used by another form. Try a different one.');
    err.status = 409;
    throw err;
  }
  db.prepare('UPDATE forms SET config = ?, slug = ?, is_open = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next.config), next.slug, next.isOpen ? 1 : 0, now(), id);
  return getForm(id);
}

function duplicateForm(id) {
  const form = getForm(id);
  if (!form) return null;
  const config = { ...form.config, title: `${form.config.title} (copy)` };
  const copy = createForm(config, form.slug + '-copy');
  db.prepare(
    'INSERT INTO files (form_id, kind, mime, name, width, height, data, version) SELECT ?, kind, mime, name, width, height, data, version FROM files WHERE form_id = ?'
  ).run(copy.id, id);
  return copy;
}

function deleteForm(id) {
  db.prepare('DELETE FROM forms WHERE id = ?').run(id);
}

/* ---------------- files (certificate background, banner, custom font) ---------------- */
function fileVersions(formId) {
  const out = { cert: null, banner: null, font: null };
  for (const r of db.prepare('SELECT kind, version, name, width, height FROM files WHERE form_id = ?').all(formId)) {
    out[r.kind] = { v: r.version, name: r.name, width: r.width, height: r.height };
  }
  return out;
}
function getFile(formId, kind) {
  const r = db.prepare('SELECT * FROM files WHERE form_id = ? AND kind = ?').get(formId, kind);
  return r ? { ...r, data: toBuffer(r.data) } : null;
}
function putFile(formId, kind, { mime, name, width, height, data }) {
  const version = crypto.randomBytes(6).toString('hex');
  db.prepare(
    `INSERT INTO files (form_id, kind, mime, name, width, height, data, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (form_id, kind) DO UPDATE SET mime = excluded.mime, name = excluded.name, width = excluded.width,
       height = excluded.height, data = excluded.data, version = excluded.version`
  ).run(formId, kind, mime, name || null, width || null, height || null, data, version);
  db.prepare('UPDATE forms SET updated_at = ? WHERE id = ?').run(now(), formId);
  return version;
}
function deleteFile(formId, kind) {
  db.prepare('DELETE FROM files WHERE form_id = ? AND kind = ?').run(formId, kind);
}

/* ---------------- responses ---------------- */
function rowToResponse(r) {
  return { id: r.id, token: r.token, email: r.email, certName: r.cert_name, answers: JSON.parse(r.answers), createdAt: r.created_at };
}
function countResponses(formId) {
  return db.prepare('SELECT COUNT(*) AS n FROM responses WHERE form_id = ?').get(formId).n;
}
function emailUsed(formId, email) {
  return Boolean(db.prepare('SELECT id FROM responses WHERE form_id = ? AND email_norm = ?').get(formId, String(email).toLowerCase()));
}
function addResponse(formId, { email, certName, answers }) {
  const token = crypto.randomBytes(12).toString('base64url');
  const createdAt = now();
  const info = db
    .prepare('INSERT INTO responses (form_id, token, email, email_norm, cert_name, answers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(formId, token, email || null, email ? email.toLowerCase() : null, certName, JSON.stringify(answers), createdAt);
  return { id: Number(info.lastInsertRowid), token, createdAt };
}
function listResponses(formId) {
  return db.prepare('SELECT * FROM responses WHERE form_id = ? ORDER BY id DESC').all(formId).map(rowToResponse);
}
function getResponseByToken(token) {
  const r = db.prepare('SELECT * FROM responses WHERE token = ?').get(String(token));
  return r ? { ...rowToResponse(r), formId: r.form_id } : null;
}
function getResponse(id) {
  const r = db.prepare('SELECT * FROM responses WHERE id = ?').get(id);
  return r ? { ...rowToResponse(r), formId: r.form_id } : null;
}
function renameResponse(id, certName) {
  db.prepare('UPDATE responses SET cert_name = ? WHERE id = ?').run(certName, id);
}
function deleteResponse(id) {
  db.prepare('DELETE FROM responses WHERE id = ?').run(id);
}
function clearResponses(formId) {
  db.prepare('DELETE FROM responses WHERE form_id = ?').run(formId);
}

/* ---------------- first run ---------------- */
function seed() {
  const created = ensureAdmin();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM forms').get();
  if (n === 0) {
    const form = createForm(seedConfig(), 'project-77-evaluation');
    const certPath = path.join(__dirname, '..', 'seed', 'certificate.jpg');
    if (fs.existsSync(certPath)) {
      putFile(form.id, 'cert', { mime: 'image/jpeg', name: 'certificate.jpg', width: 2000, height: 1414, data: fs.readFileSync(certPath) });
    }
  }
  return created;
}

module.exports = {
  DB_PATH,
  seed,
  verifyPassword,
  createSession,
  getSessionAdmin,
  deleteSession,
  findAdmin,
  getAdmin,
  updateAdminCredentials,
  listForms,
  getForm,
  getFormBySlug,
  createForm,
  updateForm,
  duplicateForm,
  deleteForm,
  templateConfig,
  fileVersions,
  getFile,
  putFile,
  deleteFile,
  emailUsed,
  countResponses,
  addResponse,
  listResponses,
  getResponse,
  getResponseByToken,
  renameResponse,
  deleteResponse,
  clearResponses,
  slugify,
};
