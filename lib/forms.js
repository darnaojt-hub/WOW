'use strict';
/*
 * Form configuration: defaults, sanitizing admin edits, and validating
 * participant submissions. Everything here is pure (no I/O).
 */
const crypto = require('node:crypto');

const QUESTION_TYPES = ['scale', 'short', 'paragraph', 'choice', 'checkbox', 'dropdown', 'section', 'certname'];
const CHOICE_TYPES = ['choice', 'checkbox', 'dropdown'];
const NAME_FORMATS = ['auto', 'as-typed', 'upper', 'title'];
const FONT_WEIGHTS = [400, 500, 600, 700];
const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const newId = () => 'q_' + crypto.randomBytes(5).toString('hex');

/* ---------- small coercion helpers ---------- */
const str = (v, max, def = '') => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').slice(0, max) : def);
const line = (v, max, def = '') => str(v, max, def).replace(/\s*\n\s*/g, ' ');
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const int = (v, min, max, def) => Math.round(num(v, min, max, def));
const hex = (v, def) => (typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : def);

/* ---------- defaults ---------- */
function scale(title) {
  return { id: newId(), type: 'scale', title, help: '', required: true, min: 1, max: 5, minLabel: 'Poor', maxLabel: 'Outstanding' };
}

function certificateDefaults() {
  return {
    enabled: true,
    x: 0.5,
    y: 0.463,
    size: 0.13,
    maxWidth: 0.68,
    color: '#94AC1D',
    font: 'Parisienne',
    weight: 400,
    nameFormat: 'auto',
    fileName: 'Certificate - {name}',
  };
}

/** The standard evaluation used for new forms (mirrors the ministry's Google Form). */
function templateConfig(overrides = {}) {
  return sanitizeConfig({
    title: 'Untitled Evaluation Form',
    description:
      'Thank you for participating! We will deeply appreciate your comments and evaluation to help us improve in future events. Rest assured that the information provided will be kept confidential.\n\n' +
      '**Indicators:**\n5 - Outstanding\n4 - Very Satisfactory\n3 - Satisfactory\n2 - Unsatisfactory\n1 - Poor',
    themeColor: '#5E7A12',
    numberScaleQuestions: true,
    collectEmail: true,
    emailLabel: 'Email',
    emailHelp: '',
    emailDomains: '',
    onePerEmail: true,
    consentText: '',
    questions: [
      scale("Relevance of the activity to the University's Vision, Mission, and Objectives"),
      scale('Objectives of the activity were achieved'),
      scale('Time allotment for the activity'),
      scale('Methods and Procedure of the Activity (Orderliness and Sequencing of the activities)'),
      scale('General rating of the Activity Conducted'),
      scale('Speaker/Facilitator'),
      scale('Organizer (Courtesy, Promptness)'),
      { id: newId(), type: 'paragraph', title: 'Feedbacks/Suggestions (Optional):', help: '', required: false },
      { id: newId(), type: 'paragraph', title: 'Do you have any takeaways after participating in the seminar?', help: '', required: true },
      {
        id: newId(),
        type: 'certname',
        title: 'Name in the Certificate:',
        help: 'Please enter your **full name** exactly as you would like it to appear on your certificate.',
        required: true,
      },
    ],
    confirmTitle: 'Thank you for your evaluation!',
    confirmMessage: 'Your response has been recorded. Here is your certificate — download it or save the link below so you can get it again anytime.',
    closedMessage: 'This form is no longer accepting responses. Please contact the organizers if you need help.',
    certificate: certificateDefaults(),
    ...overrides,
  });
}

/** First-run form, pre-filled for Project 77 using the Google Form's wording. */
function seedConfig() {
  return templateConfig({
    title: '"Project 77: Let Go, Let God" Evaluation Form',
    description:
      'The Christian Campus Ministry sincerely thank you for participating in our fellowship entitled "**Project 77: Let Go, Let God**"! We will deeply appreciate your comments and evaluation to help us improve in the future events. Rest assured that information provided will be kept confidential.\n\n' +
      '**Indicators:**\n5 - Outstanding\n4 - Very Satisfactory\n3 - Satisfactory\n2 - Unsatisfactory\n1 - Poor\n\n' +
      '**IMPORTANT NOTICE:**\nPlease make sure that you enter your BatState-U G-suite Account. Thank you!\n\n' +
      '***DATA PRIVACY CONSENT FORM:***\n' +
      '*In submitting this form, I agree to my details being used for the purposes of the event. The information will only be accessed by necessary university staff. I understand my data will be held securely and will not be distributed to third parties. I have a right to change or access my information. I understand that when this information is no longer required for this purpose, official university procedure will be followed to dispose of my data.*',
  });
}

/* ---------- sanitizing admin edits ---------- */
function sanitizeQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const type = QUESTION_TYPES.includes(q.type) ? q.type : 'short';
  const out = {
    id: typeof q.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : newId(),
    type,
    title: str(q.title, 500),
    help: str(q.help, 2000),
    required: type === 'section' ? false : type === 'certname' ? true : bool(q.required, false),
  };
  if (type === 'scale') {
    out.min = int(q.min, 0, 1, 1);
    out.max = int(q.max, 2, 10, 5);
    out.minLabel = line(q.minLabel, 60);
    out.maxLabel = line(q.maxLabel, 60);
  }
  if (CHOICE_TYPES.includes(type)) {
    const seen = new Set();
    out.options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => line(o, 200).trim())
      .filter((o) => o && !seen.has(o) && seen.add(o))
      .slice(0, 50);
    if (!out.options.length) out.options = ['Option 1'];
  }
  return out;
}

function sanitizeConfig(input) {
  const c = input && typeof input === 'object' ? input : {};
  const certIn = c.certificate && typeof c.certificate === 'object' ? c.certificate : {};
  const d = certificateDefaults();

  const ids = new Set();
  let hasName = false;
  const questions = [];
  for (const raw of (Array.isArray(c.questions) ? c.questions : []).slice(0, 100)) {
    const q = sanitizeQuestion(raw);
    if (!q) continue;
    if (q.type === 'certname') {
      if (hasName) continue;
      hasName = true;
    }
    if (ids.has(q.id)) q.id = newId();
    ids.add(q.id);
    questions.push(q);
  }
  if (!hasName) {
    questions.push({ id: newId(), type: 'certname', title: 'Name in the Certificate:', help: 'Please enter your **full name** exactly as you would like it to appear on your certificate.', required: true });
  }

  return {
    title: line(c.title, 200, 'Untitled Evaluation Form') || 'Untitled Evaluation Form',
    description: str(c.description, 8000),
    themeColor: hex(c.themeColor, '#5E7A12'),
    numberScaleQuestions: bool(c.numberScaleQuestions, true),
    collectEmail: bool(c.collectEmail, true),
    emailLabel: line(c.emailLabel, 200, 'Email') || 'Email',
    emailHelp: str(c.emailHelp, 1000),
    emailDomains: line(c.emailDomains, 500)
      .split(/[\s,;]+/)
      .map((s) => s.replace(/^@/, '').toLowerCase())
      .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
      .join(', '),
    onePerEmail: bool(c.onePerEmail, true),
    consentText: str(c.consentText, 1000),
    questions,
    confirmTitle: line(c.confirmTitle, 200, 'Thank you!') || 'Thank you!',
    confirmMessage: str(c.confirmMessage, 2000),
    closedMessage: str(c.closedMessage, 1000),
    certificate: {
      enabled: bool(certIn.enabled, d.enabled),
      x: num(certIn.x, 0, 1, d.x),
      y: num(certIn.y, 0, 1, d.y),
      size: num(certIn.size, 0.02, 0.4, d.size),
      maxWidth: num(certIn.maxWidth, 0.1, 1, d.maxWidth),
      color: hex(certIn.color, d.color),
      font: typeof certIn.font === 'string' && /^[A-Za-z0-9 ]{1,60}$/.test(certIn.font) ? certIn.font : d.font,
      weight: FONT_WEIGHTS.includes(Number(certIn.weight)) ? Number(certIn.weight) : d.weight,
      nameFormat: NAME_FORMATS.includes(certIn.nameFormat) ? certIn.nameFormat : d.nameFormat,
      fileName: line(certIn.fileName, 120, d.fileName) || d.fileName,
    },
  };
}

/* ---------- names ---------- */
const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|x)$/i;
function titleCase(s) {
  return s
    .toLocaleLowerCase()
    .split(/(\s+|-|')/)
    .map((w) => {
      if (!w || /^(\s+|-|')$/.test(w)) return w;
      if (ROMAN.test(w)) return w.toLocaleUpperCase();
      return w.charAt(0).toLocaleUpperCase() + w.slice(1);
    })
    .join('');
}

function formatName(raw, mode) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (mode === 'as-typed') return name;
  if (mode === 'upper') return name.toLocaleUpperCase();
  if (mode === 'title') return titleCase(name);
  // auto: only fix names typed entirely in CAPS or entirely in lowercase
  const hasLetters = /\p{L}/u.test(name);
  if (hasLetters && (name === name.toLocaleUpperCase() || name === name.toLocaleLowerCase())) return titleCase(name);
  return name;
}

/* ---------- validating submissions ---------- */
function emailAllowed(email, domains) {
  if (!domains) return true;
  const host = email.split('@').pop().toLowerCase();
  return domains.split(/,\s*/).some((d) => host === d);
}

/**
 * @returns {{ errors: Record<string,string>, clean: {email:string|null, certName:string, answers:Record<string,any>} }}
 */
function validateSubmission(config, body) {
  const errors = {};
  const answers = {};
  const input = body && typeof body.answers === 'object' && body.answers ? body.answers : {};
  let email = null;

  if (config.collectEmail) {
    email = typeof body.email === 'string' ? body.email.trim().slice(0, 254) : '';
    if (!email) errors.email = 'This is a required question';
    else if (!EMAIL.test(email)) errors.email = 'Please enter a valid email address';
    else if (!emailAllowed(email, config.emailDomains)) errors.email = `Please use your ${config.emailDomains.split(/,\s*/).map((d) => '@' + d).join(' or ')} account`;
  }

  let certName = '';
  for (const q of config.questions) {
    if (q.type === 'section') continue;
    const v = input[q.id];
    if (q.type === 'certname') {
      const raw = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
      if (!raw) errors[q.id] = 'This is a required question';
      else if (raw.length > 120) errors[q.id] = 'Please keep the name under 120 characters';
      else if (!/\p{L}/u.test(raw)) errors[q.id] = 'Please enter your name';
      else certName = formatName(raw, config.certificate.nameFormat);
      continue;
    }
    let val = null;
    if (q.type === 'scale') {
      const n = Number(v);
      if (v !== undefined && v !== null && v !== '' && Number.isInteger(n) && n >= q.min && n <= q.max) val = n;
    } else if (q.type === 'short' || q.type === 'paragraph') {
      const s = typeof v === 'string' ? v.trim().slice(0, q.type === 'short' ? 500 : 5000) : '';
      if (s) val = s;
    } else if (q.type === 'choice' || q.type === 'dropdown') {
      if (typeof v === 'string' && q.options.includes(v)) val = v;
    } else if (q.type === 'checkbox') {
      const arr = Array.isArray(v) ? v.filter((o) => typeof o === 'string' && q.options.includes(o)) : [];
      if (arr.length) val = [...new Set(arr)];
    }
    if (val === null) {
      if (q.required) errors[q.id] = 'This is a required question';
      continue;
    }
    answers[q.id] = val;
  }

  if (config.consentText && body.consent !== true) errors.consent = 'Please check this box to continue';

  return { errors, clean: { email, certName, answers } };
}

module.exports = { templateConfig, seedConfig, sanitizeConfig, validateSubmission, formatName, newId, EMAIL };
