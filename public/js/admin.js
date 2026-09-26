/* Admin panel: /admin */
(function () {
  'use strict';
  const { h, icon, api, toast, applyTheme, formatName, copyText, fmtDate, autosize } = window.App;
  const root = document.getElementById('app');

  const DEFAULT_THEME = '#5E7A12';
  const TYPE_LABELS = {
    scale: 'Rating scale',
    short: 'Short answer',
    paragraph: 'Paragraph',
    choice: 'Multiple choice',
    checkbox: 'Checkboxes',
    dropdown: 'Dropdown',
    section: 'Section title',
    certname: 'Certificate name',
  };
  const ADDABLE = ['scale', 'short', 'paragraph', 'choice', 'checkbox', 'dropdown', 'section'];
  const THEME_PRESETS = ['#5E7A12', '#2E7D32', '#00695C', '#1565C0', '#283593', '#6A1B9A', '#AD1457', '#C62828', '#8D4B00', '#37474F'];
  const INDICATORS = [
    [4.5, 'Outstanding'],
    [3.5, 'Very Satisfactory'],
    [2.5, 'Satisfactory'],
    [1.5, 'Unsatisfactory'],
    [0, 'Poor'],
  ];

  const S = {
    admin: null,
    form: null, // saved form from server
    draft: null, // { config, slug } being edited
    dirty: false,
    tab: 'questions',
    openQ: null,
    responses: null,
    sampleName: 'Juan A. Dela Cruz',
    hash: '',
    ignoreHash: false,
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const rid = () => 'q_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const formUrl = (slug) => `${location.origin}/f/${slug}`;

  /* ================================================================ */
  /* API wrapper (handles expired sessions)                            */
  /* ================================================================ */
  async function call(method, url, body, opts) {
    try {
      return await api(method, url, body, opts);
    } catch (err) {
      if (err.status === 401 && !url.endsWith('/login')) {
        S.admin = null;
        S.dirty = false;
        updateSavebar();
        renderLogin('Your session ended. Please sign in again.');
      }
      throw err;
    }
  }

  /* ================================================================ */
  /* small UI pieces                                                   */
  /* ================================================================ */
  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  }
  function switchRow(title, desc, checked, onchange) {
    return h(
      'label',
      { class: 'switch-row' },
      h('div', null, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e) => onchange(e.target.checked) }), h('span'))
    );
  }
  function card(title, ...children) {
    return h('section', { class: 'card' }, title ? h('h3', { style: { marginBottom: '12px' } }, title) : null, children);
  }
  function badge(open, short) {
    return h('span', { class: 'badge ' + (open ? 'open' : 'closed') }, open ? (short ? 'Open' : 'Accepting responses') : 'Closed');
  }
  function spinnerBlock(text) {
    return h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), text || 'Loading…');
  }

  function modal({ title, body, actions, onClose }) {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), body, actions ? h('div', { class: 'modal-actions' }, actions) : null);
    back.append(box);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }
    setTimeout(() => { const f = box.querySelector('input:not([readonly]), textarea, select'); if (f) f.focus(); }, 60);
    return { close, box };
  }
  function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { answered = true; m.close(); resolve(v); };
      const m = modal({
        title,
        body: h('p', { class: 'muted', style: { margin: '6px 0 0' } }, message),
        actions: [h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Cancel'), h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', onclick: () => done(true) }, confirmText)],
        onClose: () => { if (!answered) resolve(false); },
      });
    });
  }
  function promptDialog({ title, label, value = '', confirmText = 'Save', hint }) {
    return new Promise((resolve) => {
      let answered = false;
      const input = h('input', { class: 'input', value, maxlength: '120' });
      const done = (v) => { answered = true; m.close(); resolve(v); };
      const form = h('form', { onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } }, field(label, input, hint));
      const m = modal({
        title,
        body: form,
        actions: [h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done(input.value.trim() || null) }, confirmText)],
        onClose: () => { if (!answered) resolve(null); },
      });
    });
  }

  function topbar({ left, title, sub, right }) {
    return h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'topbar-inner' }, left, h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'topbar-title' }, title), sub ? h('div', { class: 'topbar-sub' }, sub) : null), right)
    );
  }
  const brandMark = () => h('div', { class: 'brand-mark' }, icon('award'));

  /* ================================================================ */
  /* save bar                                                          */
  /* ================================================================ */
  const savebar = h(
    'div',
    { class: 'savebar', role: 'region', 'aria-label': 'Unsaved changes' },
    h('span', { class: 'small', style: { opacity: 0.85 } }, 'Unsaved changes'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: discard }, 'Discard'),
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', id: 'save-btn', onclick: save }, 'Save changes')
  );
  document.body.append(savebar);
  function updateSavebar() {
    savebar.classList.toggle('show', S.dirty);
    document.body.classList.toggle('has-savebar', S.dirty);
  }
  function markDirty() {
    if (!S.dirty) {
      S.dirty = true;
      updateSavebar();
    }
  }
  async function save() {
    const btn = savebar.querySelector('#save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await call('PUT', `/api/admin/forms/${S.form.id}`, { config: S.draft.config, slug: S.draft.slug });
      setForm(res);
      toast('Changes saved');
      renderEditor();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  }
  async function discard() {
    if (!(await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved edits to this form will be lost.', confirmText: 'Discard', danger: true }))) return;
    S.draft = { config: clone(S.form.config), slug: S.form.slug };
    S.dirty = false;
    updateSavebar();
    renderEditor();
  }
  function setForm(form) {
    S.form = form;
    S.draft = { config: clone(form.config), slug: form.slug };
    S.dirty = false;
    updateSavebar();
  }
  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ================================================================ */
  /* login & account                                                   */
  /* ================================================================ */
  function renderLogin(message) {
    applyTheme(DEFAULT_THEME);
    const user = h('input', { class: 'input', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const err = h('div', { class: 'notice notice-danger', hidden: !message, role: 'alert' }, message || '');
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
    const form = h(
      'form',
      {
        class: 'card login-card',
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.hidden = true;
          try {
            S.admin = await call('POST', '/api/admin/login', { username: user.value, password: pass.value });
            if (S.admin.mustChange) accountModal(true);
            route();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
            btn.disabled = false;
          }
        },
      },
      h('div', { class: 'row', style: { marginBottom: '18px' } }, brandMark(), h('div', { class: 'topbar-title' }, 'Evaluation & Certificates')),
      h('h1', { style: { fontSize: '26px' } }, 'Admin sign in'),
      h('p', { class: 'muted', style: { margin: '6px 0 18px' } }, 'Manage your evaluation forms, certificates and responses.'),
      err,
      h('div', { style: { marginTop: err.hidden ? '0' : '14px' } }, field('Username', user), field('Password', pass)),
      h('div', { style: { marginTop: '20px' } }, btn)
    );
    root.replaceChildren(h('main', { class: 'login-wrap' }, form));
    setTimeout(() => user.focus(), 50);
  }

  function accountModal(forced) {
    const username = h('input', { class: 'input', value: S.admin.username, autocomplete: 'username', autocapitalize: 'off' });
    const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const confirmPw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'notice notice-danger', hidden: true, role: 'alert', style: { marginTop: '14px' } });
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Update account');
    const m = modal({
      title: forced ? 'Set your own password' : 'Admin account',
      body: h(
        'div',
        null,
        forced ? h('div', { class: 'notice notice-warn', style: { margin: '8px 0 14px' } }, 'You signed in with the default password. Choose a new one so nobody else can open the admin panel.') : h('p', { class: 'muted', style: { margin: '4px 0 14px' } }, 'Change the username or password used to sign in.'),
        field('Username', username),
        field('Current password', current),
        field('New password', next, 'At least 8 characters.'),
        field('Confirm new password', confirmPw),
        err
      ),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, forced ? 'Later' : 'Cancel'), saveBtn],
    });
    saveBtn.addEventListener('click', async () => {
      err.hidden = true;
      if (next.value !== confirmPw.value) {
        err.textContent = 'The new passwords don’t match.';
        err.hidden = false;
        return;
      }
      saveBtn.disabled = true;
      try {
        S.admin = await call('POST', '/api/admin/account', { username: username.value, currentPassword: current.value, newPassword: next.value });
        m.close();
        toast('Account updated');
        if (!S.form) renderList();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  async function logout() {
    if (S.dirty && !(await confirmDialog({ title: 'Sign out?', message: 'You have unsaved changes that will be lost.', confirmText: 'Sign out', danger: true }))) return;
    await api('POST', '/api/admin/logout', {}).catch(() => {});
    S.admin = null;
    S.form = null;
    S.dirty = false;
    updateSavebar();
    renderLogin();
  }

  /* ================================================================ */
  /* share                                                             */
  /* ================================================================ */
  let qrLib = null;
  function loadQrLib() {
    if (!qrLib) {
      qrLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => (window.QRCode ? resolve(window.QRCode) : reject(new Error('QR library missing')));
        s.onerror = () => { qrLib = null; reject(new Error('offline')); };
        document.head.append(s);
      });
    }
    return qrLib;
  }
  function shareModal(form) {
    const url = formUrl(form.slug);
    const qrEl = h('div', { class: 'qr-box' }, h('div', { class: 'spinner' }));
    const dlQr = h('button', { class: 'btn btn-sm', type: 'button', disabled: true }, icon('download'), 'Download QR');
    loadQrLib()
      .then((QR) => {
        qrEl.replaceChildren();
        new QR(qrEl, { text: url, width: 600, height: 600, correctLevel: QR.CorrectLevel.M });
        dlQr.disabled = false;
      })
      .catch(() => qrEl.replaceChildren(h('div', { class: 'small muted', style: { textAlign: 'center' } }, 'QR code needs an internet connection.')));
    dlQr.addEventListener('click', () => {
      const c = qrEl.querySelector('canvas');
      if (c) c.toBlob((b) => Cert.download(b, `${form.slug}-qr.png`));
    });
    const input = h('input', { class: 'input', readOnly: true, value: url, onfocus: (e) => e.target.select() });
    const m = modal({
      title: 'Share form',
      body: h(
        'div',
        null,
        h('p', { class: 'muted small', style: { margin: '4px 0 12px' } }, 'Send this link to participants (Messenger, email, group chats) or show the QR code at the venue.'),
        !form.isOpen ? h('div', { class: 'notice notice-warn', style: { marginBottom: '12px' } }, 'This form is closed. People who open the link will see your “closed” message.') : null,
        S.dirty && S.draft.slug !== S.form.slug ? h('div', { class: 'notice notice-warn', style: { marginBottom: '12px' } }, 'You changed the link — save your changes to use the new one.') : null,
        h('div', { class: 'linkbox', style: { marginTop: 0 } }, input, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { await copyText(url); toast('Link copied'); } }, icon('copy'), 'Copy')),
        qrEl,
        h(
          'div',
          { class: 'row row-wrap', style: { marginTop: '12px', justifyContent: 'center' } },
          dlQr,
          h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open form'),
          navigator.share ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => navigator.share({ title: form.config ? form.config.title : 'Evaluation form', url }).catch(() => {}) }, icon('share'), 'Share…') : null
        )
      ),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Done')],
    });
  }

  /* ================================================================ */
  /* routing                                                           */
  /* ================================================================ */
  window.addEventListener('hashchange', async () => {
    if (S.ignoreHash) {
      S.ignoreHash = false;
      return;
    }
    const m = /^#\/form\/(\d+)/.exec(location.hash);
    const leaving = S.dirty && S.form && (!m || Number(m[1]) !== S.form.id);
    if (leaving && !(await confirmDialog({ title: 'Leave without saving?', message: 'You have unsaved changes to this form.', confirmText: 'Leave', danger: true }))) {
      S.ignoreHash = true;
      location.hash = S.hash;
      return;
    }
    if (leaving) {
      S.dirty = false;
      updateSavebar();
    }
    route();
  });

  function route() {
    if (!S.admin) return renderLogin();
    S.hash = location.hash;
    const m = /^#\/form\/(\d+)(?:\/(\w+))?/.exec(location.hash);
    if (m) openEditor(Number(m[1]), m[2]);
    else {
      S.form = null;
      renderList();
    }
  }
  const go = (hash) => { location.hash = hash; };

  /* ================================================================ */
  /* forms list                                                        */
  /* ================================================================ */
  async function renderList() {
    applyTheme(DEFAULT_THEME);
    document.title = 'Admin — Evaluation Forms';
    const list = h('div', { class: 'form-list' }, spinnerBlock('Loading forms…'));
    const newBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: createForm }, icon('plus'), 'New form');
    root.replaceChildren(
      topbar({
        left: brandMark(),
        title: 'Evaluation & Certificates',
        sub: `Signed in as ${S.admin.username}`,
        right: h('div', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'icon-btn', type: 'button', title: 'Account', 'aria-label': 'Account settings', onclick: () => accountModal(false) }, icon('user')), h('button', { class: 'icon-btn', type: 'button', title: 'Sign out', 'aria-label': 'Sign out', onclick: logout }, icon('logout'))),
      }),
      h(
        'main',
        { class: 'page page-wide stack' },
        S.admin.mustChange ? h('div', { class: 'notice notice-warn row row-wrap' }, h('span', { class: 'spacer' }, 'You are still using the default admin password.'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => accountModal(true) }, icon('lock'), 'Change password')) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('h1', { class: 'spacer' }, 'Your forms'), newBtn),
        list
      )
    );
    let forms;
    try {
      forms = await call('GET', '/api/admin/forms');
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(h('div', { class: 'notice notice-danger' }, err.message));
      return;
    }
    if (!forms.length) {
      list.replaceChildren(h('div', { class: 'card center-msg' }, icon('file', 32), h('div', null, 'No forms yet. Create one to get a shareable link.'), h('button', { class: 'btn btn-primary', type: 'button', onclick: createForm }, icon('plus'), 'New form')));
      return;
    }
    list.replaceChildren(
      ...forms.map((f) =>
        h(
          'article',
          { class: 'card form-item' },
          h('div', { class: 'swatch', style: { background: f.themeColor } }),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('h3', null, h('a', { href: `#/form/${f.id}/questions`, style: { color: 'inherit', textDecoration: 'none' } }, f.title)),
            h('div', { class: 'meta' }, badge(f.isOpen), h('span', null, `${f.responseCount} response${f.responseCount === 1 ? '' : 's'}`), h('span', null, `Updated ${fmtDate(f.updatedAt, false)}`)),
            h(
              'div',
              { class: 'actions' },
              h('a', { class: 'btn btn-primary btn-sm', href: `#/form/${f.id}/questions` }, icon('edit'), 'Edit'),
              h('a', { class: 'btn btn-sm', href: `#/form/${f.id}/responses` }, icon('list'), 'Responses'),
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => shareModal(f) }, icon('share'), 'Share'),
              h('span', { class: 'spacer' }),
              h('button', { class: 'icon-btn', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate ${f.title}`, onclick: () => duplicateForm(f.id) }, icon('copy')),
              h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': `Delete ${f.title}`, onclick: () => deleteForm(f) }, icon('trash'))
            )
          )
        )
      )
    );
  }

  async function createForm() {
    try {
      const form = await call('POST', '/api/admin/forms', {});
      setForm(form);
      go(`#/form/${form.id}/questions`);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }
  async function duplicateForm(id) {
    if (S.dirty) {
      toast('Save or discard your changes first.', 'error');
      return;
    }
    try {
      const form = await call('POST', `/api/admin/forms/${id}/duplicate`, {});
      toast('Form duplicated (responses are not copied)');
      if (S.form) {
        setForm(form);
        go(`#/form/${form.id}/questions`);
      } else renderList();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }
  async function deleteForm(f) {
    const title = f.title || (f.config && f.config.title);
    const ok = await confirmDialog({
      title: 'Delete this form?',
      message: `“${title}” and all of its responses will be permanently deleted. Certificate links for this form will stop working.`,
      confirmText: 'Delete form',
      danger: true,
    });
    if (!ok) return;
    try {
      await call('DELETE', `/api/admin/forms/${f.id}`);
      toast('Form deleted');
      S.form = null;
      S.dirty = false;
      updateSavebar();
      if (location.hash.startsWith('#/form/')) go('#/');
      else renderList();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  /* ================================================================ */
  /* editor shell                                                      */
  /* ================================================================ */
  async function openEditor(id, tab) {
    if (!S.form || S.form.id !== id) {
      root.replaceChildren(spinnerBlock('Loading form…'));
      try {
        setForm(await call('GET', `/api/admin/forms/${id}`));
      } catch (err) {
        if (err.status !== 401) root.replaceChildren(h('main', { class: 'page' }, h('div', { class: 'notice notice-danger' }, err.message), h('p', null, h('a', { href: '#/' }, '← Back to forms'))));
        return;
      }
      S.responses = null;
      S.openQ = null;
    }
    S.tab = ['questions', 'certificate', 'responses', 'settings'].includes(tab) ? tab : 'questions';
    renderEditor();
  }

  let contentEl = null;
  function renderEditor() {
    const f = S.form;
    applyTheme(S.draft.config.themeColor);
    document.title = `${S.draft.config.title} — Admin`;
    const tabs = [
      ['questions', 'Questions'],
      ['certificate', 'Certificate'],
      ['responses', 'Responses', f.responseCount],
      ['settings', 'Settings'],
    ];
    contentEl = h('main', { class: 'page page-wide stack' });
    root.replaceChildren(
      h(
        'div',
        { class: 'topbar' },
        h(
          'div',
          { class: 'topbar-inner' },
          h('a', { class: 'icon-btn', href: '#/', title: 'All forms', 'aria-label': 'Back to all forms' }, icon('back')),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'topbar-title', id: 'editor-title' }, S.draft.config.title), h('div', { class: 'topbar-sub' }, badge(f.isOpen, true))),
          h('a', { class: 'icon-btn', href: `/f/${f.slug}?preview=1`, target: '_blank', rel: 'noopener', title: 'Preview form', 'aria-label': 'Preview form', onclick: () => { if (S.dirty) toast('Save your changes to see them in the preview.'); } }, icon('eye')),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => shareModal(S.form) }, icon('share'), 'Share')
        ),
        h(
          'nav',
          { class: 'tabs', role: 'tablist' },
          tabs.map(([key, label, count]) =>
            h('a', { class: 'tab', role: 'tab', href: `#/form/${f.id}/${key}`, 'aria-selected': String(S.tab === key) }, label, count !== undefined ? h('span', { class: 'count' }, String(count)) : null)
          )
        )
      ),
      contentEl
    );
    if (S.tab === 'questions') renderQuestionsTab(contentEl);
    else if (S.tab === 'certificate') renderCertificateTab(contentEl);
    else if (S.tab === 'responses') renderResponsesTab(contentEl);
    else renderSettingsTab(contentEl);
    const active = root.querySelector('.tab[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const setEditorTitle = () => {
    const t = document.getElementById('editor-title');
    if (t) t.textContent = S.draft.config.title || 'Untitled form';
  };

  /* ---------- uploads ---------- */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, style: { display: 'none' } });
      input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }
  async function uploadFile(kind, accept) {
    const file = await pickFile(accept);
    if (!file) return false;
    if (file.size > 15 * 1024 * 1024) {
      toast('That file is larger than 15 MB. Please use a smaller one.', 'error');
      return false;
    }
    toast('Uploading…');
    try {
      const res = await call('PUT', `/api/admin/forms/${S.form.id}/files/${kind}`, file, {
        raw: true,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      });
      S.form.files = res.files;
      toast('Uploaded');
      return true;
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
      return false;
    }
  }
  async function removeFile(kind, what) {
    if (!(await confirmDialog({ title: `Remove ${what}?`, message: `The ${what} will be removed from this form right away.`, confirmText: 'Remove', danger: true }))) return false;
    try {
      const res = await call('DELETE', `/api/admin/forms/${S.form.id}/files/${kind}`);
      S.form.files = res.files;
      toast('Removed');
      return true;
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
      return false;
    }
  }
  function uploadTile({ kind, meta, title, emptyText, accept, wide, onChange }) {
    const url = Cert.fileUrl(S.form.id, kind, meta);
    const thumb = kind === 'font' ? h('div', { class: 'thumb', style: { display: 'grid', placeItems: 'center', aspectRatio: '1', width: '56px' } }, icon('type', 26)) : h('div', { class: 'thumb' + (wide ? ' wide' : ''), style: url ? { backgroundImage: `url("${url}")` } : {} });
    const info = meta
      ? h('div', { class: 'info' }, h('b', null, meta.name || title), meta.width ? h('span', { class: 'muted tiny' }, `${meta.width} × ${meta.height} px`) : null)
      : h('div', { class: 'info' }, h('b', null, title), h('span', { class: 'muted tiny' }, emptyText));
    return h(
      'div',
      { class: 'upload-tile' },
      thumb,
      info,
      h(
        'div',
        { class: 'row', style: { gap: '4px' } },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await uploadFile(kind, accept)) onChange(); } }, icon('upload'), meta ? 'Replace' : 'Upload'),
        meta ? h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove', 'aria-label': `Remove ${title}`, onclick: async () => { if (await removeFile(kind, title.toLowerCase())) onChange(); } }, icon('trash')) : null
      )
    );
  }

  /* ================================================================ */
  /* Questions tab                                                     */
  /* ================================================================ */
  function renderQuestionsTab(el) {
    const c = S.draft.config;
    const title = h('input', { class: 'input', value: c.title, maxlength: '200', oninput: (e) => { c.title = e.target.value; setEditorTitle(); markDirty(); } });
    const desc = autosize(h('textarea', { class: 'textarea', rows: 5, value: c.description, maxlength: '8000', oninput: (e) => { c.description = e.target.value; markDirty(); } }));
    const list = h('div', { class: 'stack', id: 'qlist' });

    el.replaceChildren(
      h(
        'section',
        { class: 'card card-head' },
        field('Form title', title),
        field('Description', desc, 'Formatting: **bold**, *italic*, ***bold italic***. Leave an empty line between paragraphs.'),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Header image (optional)'),
          uploadTile({ kind: 'banner', meta: S.form.files.banner, title: 'Header image', emptyText: 'Wide image shown above the title (about 4:1).', accept: 'image/png,image/jpeg,image/webp', wide: true, onChange: () => renderQuestionsTab(el) })
        )
      ),
      h(
        'div',
        { class: 'card row', style: { padding: '14px 16px' } },
        icon('user'),
        h('div', { class: 'spacer small' }, c.collectEmail ? h('span', null, h('b', null, 'Email'), ' is collected first', c.emailDomains ? ` (only ${c.emailDomains})` : '', c.onePerEmail ? ' · one response per email' : '') : h('span', { class: 'muted' }, 'Email is not collected')),
        h('a', { class: 'btn btn-sm', href: `#/form/${S.form.id}/settings` }, 'Change')
      ),
      h('div', { class: 'section-title' }, 'Questions'),
      list,
      h('div', { class: 'card' }, h('div', { class: 'small muted', style: { marginBottom: '10px', fontWeight: 600 } }, 'Add a question'), h('div', { class: 'add-q' }, ADDABLE.map((t) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addQuestion(t) }, icon('plus'), TYPE_LABELS[t]))))
    );
    renderQList();
  }

  function renderQList() {
    const list = document.getElementById('qlist');
    if (!list) return;
    const qs = S.draft.config.questions;
    let n = 0;
    const numbers = qs.map((q) => (q.type === 'scale' && S.draft.config.numberScaleQuestions ? ++n : null));
    list.replaceChildren(...qs.map((q, i) => qEditor(q, i, numbers[i])));
  }

  function newQuestion(type) {
    const q = { id: rid(), type, title: '', help: '', required: type === 'scale' };
    if (type === 'scale') Object.assign(q, { min: 1, max: 5, minLabel: 'Poor', maxLabel: 'Outstanding' });
    if (['choice', 'checkbox', 'dropdown'].includes(type)) q.options = ['Option 1', 'Option 2'];
    return q;
  }
  function addQuestion(type) {
    const qs = S.draft.config.questions;
    const q = newQuestion(type);
    const nameIdx = qs.findIndex((x) => x.type === 'certname');
    // keep the certificate-name question last if it is last
    if (nameIdx === qs.length - 1) qs.splice(nameIdx, 0, q);
    else qs.push(q);
    S.openQ = q.id;
    markDirty();
    renderQList();
    focusQuestion(q.id);
  }
  function focusQuestion(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-qid="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ta = el.querySelector('.qe-title');
      if (ta) setTimeout(() => ta.focus({ preventScroll: true }), 300);
    });
  }
  function changeType(q, type) {
    q.type = type;
    if (type === 'scale' && q.min === undefined) Object.assign(q, { min: 1, max: 5, minLabel: 'Poor', maxLabel: 'Outstanding' });
    if (['choice', 'checkbox', 'dropdown'].includes(type) && !(q.options && q.options.length)) q.options = ['Option 1', 'Option 2'];
    if (type === 'section') q.required = false;
    markDirty();
    renderQList();
  }

  function qEditor(q, i, number) {
    const qs = S.draft.config.questions;
    const open = S.openQ === q.id;
    const headTitle = h('b', null, q.title || (q.type === 'section' ? 'Untitled section' : 'Untitled question'));
    const toggle = () => {
      S.openQ = open ? null : q.id;
      renderQList();
      if (!open) focusQuestion(q.id);
    };
    const head = h(
      'div',
      { class: 'qe-head', role: 'button', tabindex: '0', 'aria-expanded': String(open), onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
      h('span', { class: 'num' }, number ? `${number}.` : q.type === 'certname' ? icon('award', 18) : q.type === 'section' ? icon('type', 18) : '•'),
      h('div', { class: 'tt' }, headTitle, h('span', null, h('span', { class: 'type-pill' }, TYPE_LABELS[q.type]), q.required && q.type !== 'certname' ? 'Required' : q.type === 'certname' ? 'Required · printed on the certificate' : '')),
      h('span', { class: 'chev' }, icon('down'))
    );
    const cardEl = h('article', { class: 'card qe' + (open ? ' open' : ''), dataset: { qid: q.id } }, head);
    if (!open) return cardEl;

    const body = h('div', { class: 'qe-body' });
    if (q.type !== 'certname') {
      body.append(field('Type', h('select', { class: 'select', value: q.type, onchange: (e) => changeType(q, e.target.value) }, ADDABLE.map((t) => h('option', { value: t }, TYPE_LABELS[t])))));
    } else {
      body.append(h('div', { class: 'notice notice-info', style: { marginTop: '14px' } }, 'What participants type here is printed on their certificate. You can edit the wording, but this question can’t be removed.'));
    }
    body.append(
      field(
        q.type === 'section' ? 'Section title' : 'Question',
        autosize(h('textarea', { class: 'textarea qe-title', rows: 1, style: { minHeight: '50px' }, value: q.title, maxlength: '500', oninput: (e) => { q.title = e.target.value; headTitle.textContent = q.title || 'Untitled question'; markDirty(); } }))
      ),
      field('Description (optional)', autosize(h('textarea', { class: 'textarea', rows: 1, style: { minHeight: '50px' }, value: q.help, maxlength: '2000', placeholder: 'Extra instructions shown under the question', oninput: (e) => { q.help = e.target.value; markDirty(); } })))
    );

    if (q.type === 'scale') {
      const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
      body.append(
        h(
          'div',
          { class: 'grid-2', style: { marginTop: '14px' } },
          field('From', h('select', { class: 'select', value: String(q.min), onchange: (e) => { q.min = Number(e.target.value); markDirty(); } }, range(0, 1).map((v) => h('option', { value: String(v) }, String(v))))),
          field('To', h('select', { class: 'select', value: String(q.max), onchange: (e) => { q.max = Number(e.target.value); markDirty(); } }, range(2, 10).map((v) => h('option', { value: String(v) }, String(v)))))
        ),
        h(
          'div',
          { class: 'grid-2' },
          field('Label for the lowest', h('input', { class: 'input', value: q.minLabel, maxlength: '60', placeholder: 'e.g. Poor', oninput: (e) => { q.minLabel = e.target.value; markDirty(); } })),
          field('Label for the highest', h('input', { class: 'input', value: q.maxLabel, maxlength: '60', placeholder: 'e.g. Outstanding', oninput: (e) => { q.maxLabel = e.target.value; markDirty(); } }))
        )
      );
    }
    if (['choice', 'checkbox', 'dropdown'].includes(q.type)) {
      body.append(
        field(
          'Options',
          autosize(h('textarea', { class: 'textarea', rows: 3, value: (q.options || []).join('\n'), oninput: (e) => { q.options = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markDirty(); } })),
          'One option per line.'
        )
      );
    }

    const canUp = i > 0;
    const canDown = i < qs.length - 1;
    const move = (dir) => {
      const j = i + dir;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      markDirty();
      renderQList();
      focusQuestion(q.id);
    };
    const foot = h(
      'div',
      { class: 'qe-foot' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: !canUp, onclick: () => move(-1) }, icon('up')),
      h('button', { class: 'icon-btn', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: !canDown, onclick: () => move(1) }, icon('down')),
      q.type !== 'certname'
        ? h('button', {
            class: 'icon-btn',
            type: 'button',
            title: 'Duplicate',
            'aria-label': 'Duplicate question',
            onclick: () => {
              const copy = { ...clone(q), id: rid() };
              qs.splice(i + 1, 0, copy);
              S.openQ = copy.id;
              markDirty();
              renderQList();
              focusQuestion(copy.id);
            },
          }, icon('copy'))
        : null,
      q.type !== 'certname'
        ? h('button', {
            class: 'icon-btn danger',
            type: 'button',
            title: 'Delete',
            'aria-label': 'Delete question',
            onclick: async () => {
              const ok = await confirmDialog({ title: 'Delete this question?', message: 'Answers already collected for it will no longer show in the summary or CSV export.', confirmText: 'Delete', danger: true });
              if (!ok) return;
              qs.splice(qs.indexOf(q), 1);
              S.openQ = null;
              markDirty();
              renderQList();
            },
          }, icon('trash'))
        : null,
      q.type !== 'section' && q.type !== 'certname'
        ? h('label', { class: 'req-toggle' }, 'Required', h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: q.required, onchange: (e) => { q.required = e.target.checked; markDirty(); renderQList(); } }), h('span')))
        : null
    );
    body.append(foot);
    cardEl.append(body);
    return cardEl;
  }

  /* ================================================================ */
  /* Certificate tab                                                   */
  /* ================================================================ */
  function renderCertificateTab(el) {
    const c = S.draft.config.certificate;
    const files = S.form.files;
    const bgUrl = Cert.fileUrl(S.form.id, 'cert', files.cert);
    const fontUrl = Cert.fileUrl(S.form.id, 'font', files.font);
    const rerender = () => renderCertificateTab(el);

    /* ---- preview ---- */
    const canvas = h('canvas', { role: 'img', 'aria-label': 'Certificate preview. Drag the name to move it.' });
    const stage = h('div', { class: 'designer-canvas' });
    let img = null;
    let family = null;
    let box = null;
    let drag = null;
    let snapped = false;

    function redraw() {
      if (!img || !family) return;
      const ctx = canvas.getContext('2d');
      box = Cert.draw(ctx, img, canvas.width, canvas.height, formatName(S.sampleName, c.nameFormat), c, family);
      if (!box) return;
      const lw = Math.max(1, canvas.width / 600);
      ctx.save();
      ctx.lineWidth = lw;
      ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.strokeStyle = drag ? 'rgba(20, 90, 200, .9)' : 'rgba(30, 38, 22, .35)';
      const pad = canvas.width * 0.008;
      ctx.strokeRect(box.left - pad, box.top - pad, box.right - box.left + pad * 2, box.bottom - box.top + pad * 2);
      if (drag && snapped) {
        ctx.strokeStyle = 'rgba(20, 90, 200, .9)';
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, 0);
        ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.stroke();
      }
      ctx.restore();
    }
    const refreshFont = async () => {
      family = await Cert.ensureFont(c, fontUrl);
      redraw();
    };

    if (bgUrl) {
      stage.append(spinnerBlock('Loading certificate…'));
      Cert.loadImage(bgUrl)
        .then((i) => {
          img = i;
          const W = Math.min(i.naturalWidth, 1600);
          canvas.width = W;
          canvas.height = Math.round((W * i.naturalHeight) / i.naturalWidth);
          stage.replaceChildren(canvas);
          return refreshFont();
        })
        .catch((e) => stage.replaceChildren(h('div', { class: 'designer-empty' }, e.message)));
    } else {
      stage.append(
        h(
          'div',
          { class: 'designer-empty' },
          h('div', null, icon('image', 36), h('p', { style: { margin: '10px 0 14px' } }, 'Upload your certificate design without the participant’s name (PNG or JPG, landscape, 2000 px wide or more).'), h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { if (await uploadFile('cert', 'image/png,image/jpeg,image/webp')) rerender(); } }, icon('upload'), 'Upload certificate'))
        )
      );
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!box) return;
      const p = pos(e);
      const pad = canvas.width * 0.03;
      if (p.x < box.left - pad || p.x > box.right + pad || p.y < box.top - pad || p.y > box.bottom + pad) return;
      drag = { dx: p.x - c.x * canvas.width, dy: p.y - c.y * canvas.height };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
      e.preventDefault();
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pos(e);
      let nx = (p.x - drag.dx) / canvas.width;
      const ny = (p.y - drag.dy) / canvas.height;
      snapped = Math.abs(nx - 0.5) < 0.012;
      if (snapped) nx = 0.5;
      c.x = Math.min(1, Math.max(0, nx));
      c.y = Math.min(1, Math.max(0, ny));
      syncPosition();
      markDirty();
      redraw();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      snapped = false;
      canvas.classList.remove('dragging');
      redraw();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* ---- controls ---- */
    function rangeField(label, { min, max, step, get, set, fmt }) {
      const val = h('span', { class: 'val' }, fmt(get()));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
      input.addEventListener('input', () => { set(Number(input.value)); val.textContent = fmt(Number(input.value)); markDirty(); redraw(); });
      const wrap = h('div', { class: 'field' }, h('div', { class: 'range-row' }, h('span', { class: 'field-label', style: { margin: 0 } }, label), val, input));
      wrap.sync = () => { input.value = String(get()); val.textContent = fmt(get()); };
      return wrap;
    }
    const pct = (v) => `${v.toFixed(1)}%`;
    const xField = rangeField('Horizontal position', { min: 0, max: 100, step: 0.1, get: () => c.x * 100, set: (v) => (c.x = v / 100), fmt: pct });
    const yField = rangeField('Vertical position', { min: 0, max: 100, step: 0.1, get: () => c.y * 100, set: (v) => (c.y = v / 100), fmt: pct });
    function syncPosition() { xField.sync(); yField.sync(); }

    const weights = Cert.weightsFor(c.font);
    const weightSel = h(
      'select',
      { class: 'select', value: String(Cert.nearestWeight(c.font, c.weight)), onchange: (e) => { c.weight = Number(e.target.value); markDirty(); refreshFont(); } },
      weights.map((w) => h('option', { value: String(w) }, { 400: 'Regular', 500: 'Medium', 600: 'Semi-bold', 700: 'Bold' }[w]))
    );
    const cats = ['Script', 'Serif', 'Sans-serif'];
    const fontSel = h(
      'select',
      {
        class: 'select',
        value: c.font === Cert.CUSTOM && !files.font ? 'Parisienne' : c.font,
        onchange: (e) => {
          c.font = e.target.value;
          c.weight = Cert.nearestWeight(c.font, c.weight);
          markDirty();
          rerender();
        },
      },
      files.font ? h('optgroup', { label: 'Uploaded' }, h('option', { value: Cert.CUSTOM }, `Your font (${files.font.name || 'uploaded'})`)) : null,
      cats.map((cat) => h('optgroup', { label: cat }, Cert.FONTS.filter((f) => f.cat === cat).map((f) => h('option', { value: f.family }, f.family))))
    );
    const colorText = h('input', { class: 'input', value: c.color, maxlength: '7', style: { maxWidth: '130px' }, 'aria-label': 'Color hex code' });
    const colorPick = h('input', { type: 'color', value: c.color, 'aria-label': 'Name color' });
    colorPick.addEventListener('input', () => { c.color = colorPick.value.toUpperCase(); colorText.value = c.color; markDirty(); redraw(); });
    colorText.addEventListener('input', () => {
      const v = colorText.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) { c.color = v.toUpperCase(); colorPick.value = v; markDirty(); redraw(); }
    });
    const sample = h('input', { class: 'input', value: S.sampleName, maxlength: '120', oninput: (e) => { S.sampleName = e.target.value; redraw(); } });

    const previewCard = h(
      'section',
      { class: 'card sticky' },
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('h3', { class: 'spacer' }, 'Preview'), files.cert ? h('span', { class: 'tiny muted' }, 'Drag the name to move it') : null),
      stage,
      h('div', { style: { marginTop: '14px' } }, field('Try a name', sample, 'Test a long name to check that it still fits.')),
      files.cert
        ? h(
            'div',
            { class: 'row row-wrap', style: { marginTop: '14px' } },
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => testDownload('jpg') }, icon('download'), 'Test image'),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => testDownload('pdf') }, icon('file'), 'Test PDF')
          )
        : null
    );

    async function testDownload(kind) {
      try {
        const name = formatName(S.sampleName, c.nameFormat);
        const out = await Cert.render({ bgUrl, cert: c, name, fontUrl });
        const fname = Cert.fileName(c.fileName, name, S.draft.config.title, kind);
        if (kind === 'jpg') Cert.download(await Cert.toBlob(out, 'image/jpeg', 0.94), fname);
        else Cert.download(Cert.buildPdf([await Cert.canvasToPdfPage(out, 0.94)]), fname);
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    const controls = h(
      'div',
      { class: 'stack' },
      card(
        null,
        switchRow('Give a certificate after submitting', 'Participants see and download their certificate right after they submit.', c.enabled, (v) => { c.enabled = v; markDirty(); }),
        h('div', { class: 'field', style: { marginTop: '10px' } }, h('span', { class: 'field-label' }, 'Certificate design'), uploadTile({ kind: 'cert', meta: files.cert, title: 'Certificate design', emptyText: 'Blank design without a name.', accept: 'image/png,image/jpeg,image/webp', onChange: rerender })),
        files.cert && files.cert.width && files.cert.width < 1500 ? h('div', { class: 'notice notice-warn small', style: { marginTop: '10px' } }, 'This image is small and may look blurry when printed. 2000 px wide or more is best.') : null
      ),
      card(
        'Name style',
        field('Font', fontSel),
        weights.length > 1 ? field('Weight', weightSel) : null,
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), h('div', { class: 'color-row' }, colorPick, colorText)),
        rangeField('Size', { min: 2, max: 30, step: 0.1, get: () => c.size * 100, set: (v) => (c.size = v / 100), fmt: pct }),
        rangeField('Maximum width (long names shrink to fit)', { min: 20, max: 100, step: 1, get: () => c.maxWidth * 100, set: (v) => (c.maxWidth = v / 100), fmt: (v) => `${Math.round(v)}%` }),
        field(
          'Name capitalization',
          h(
            'select',
            { class: 'select', value: c.nameFormat, onchange: (e) => { c.nameFormat = e.target.value; markDirty(); redraw(); } },
            h('option', { value: 'auto' }, 'Auto-fix ALL CAPS or all lowercase (recommended)'),
            h('option', { value: 'as-typed' }, 'Exactly as typed'),
            h('option', { value: 'title' }, 'Always Title Case'),
            h('option', { value: 'upper' }, 'ALL CAPITALS')
          )
        ),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Custom font (optional)'), uploadTile({ kind: 'font', meta: files.font, title: 'Font file', emptyText: 'Use the exact font from your design (.ttf, .otf, .woff).', accept: '.ttf,.otf,.woff,.woff2,font/*', onChange: () => { if (S.form.files.font) { c.font = Cert.CUSTOM; markDirty(); } else if (c.font === Cert.CUSTOM) { c.font = 'Parisienne'; markDirty(); } rerender(); } }))
      ),
      card(
        'Position',
        xField,
        yField,
        h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' }, onclick: () => { c.x = 0.5; syncPosition(); markDirty(); redraw(); } }, 'Center horizontally')
      ),
      card('Download file name', field('File name', h('input', { class: 'input', value: c.fileName, maxlength: '120', oninput: (e) => { c.fileName = e.target.value; markDirty(); } }), 'Use {name} for the participant’s name and {title} for the form title.'))
    );

    el.replaceChildren(h('div', { class: 'designer-layout' }, previewCard, controls));
  }

  /* ================================================================ */
  /* Responses tab                                                     */
  /* ================================================================ */
  const interpret = (m) => (INDICATORS.find(([min]) => m >= min) || INDICATORS[INDICATORS.length - 1])[1];
  const answerText = (v) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

  async function renderResponsesTab(el) {
    el.replaceChildren(spinnerBlock('Loading responses…'));
    try {
      S.responses = (await call('GET', `/api/admin/forms/${S.form.id}/responses`)).responses;
    } catch (err) {
      if (err.status !== 401) el.replaceChildren(h('div', { class: 'notice notice-danger' }, err.message));
      return;
    }
    S.form.responseCount = S.responses.length;
    const countEl = root.querySelector('.tab[aria-selected="true"] .count');
    if (countEl) countEl.textContent = String(S.responses.length);
    const rs = S.responses;
    const cfg = S.form.config;
    const scaleQs = cfg.questions.filter((q) => q.type === 'scale');

    if (!rs.length) {
      el.replaceChildren(
        h(
          'div',
          { class: 'card center-msg' },
          icon('list', 32),
          h('div', null, S.form.isOpen ? 'No responses yet. Share the form link to start collecting.' : 'No responses yet. This form is closed — open it in Settings to collect responses.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => shareModal(S.form) }, icon('share'), 'Share form')
        )
      );
      return;
    }

    /* stats */
    let num = 0;
    const qStats = scaleQs.map((q) => {
      const vals = rs.map((r) => r.answers[q.id]).filter((v) => typeof v === 'number');
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const dist = {};
      for (let v = q.min; v <= q.max; v++) dist[v] = 0;
      vals.forEach((v) => (dist[v] = (dist[v] || 0) + 1));
      return { q, n: vals.length, mean, dist, number: cfg.numberScaleQuestions ? ++num : null, fivePoint: q.min === 1 && q.max === 5 };
    });
    const withMean = qStats.filter((s) => s.mean !== null);
    const overall = withMean.length ? withMean.reduce((a, s) => a + s.mean, 0) / withMean.length : null;
    const allFive = withMean.length && withMean.every((s) => s.fivePoint);

    const statsRow = h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, String(rs.length)), h('div', { class: 'l' }, `Response${rs.length === 1 ? '' : 's'} · latest ${fmtDate(rs[0].createdAt)}`)),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, overall !== null ? overall.toFixed(2) : '—'), h('div', { class: 'l' }, 'Overall mean rating')),
      h('div', { class: 'stat' }, h('div', { class: 'v', style: { fontSize: '19px', paddingTop: '4px' } }, overall !== null && allFive ? interpret(overall) : '—'), h('div', { class: 'l' }, 'Overall interpretation'))
    );

    const pdfBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => downloadAllCertificates(rs) }, icon('award'), 'All certificates (PDF)');
    const toolbar = h(
      'div',
      { class: 'row row-wrap' },
      h('a', { class: 'btn btn-primary btn-sm', href: `/api/admin/forms/${S.form.id}/responses.csv`, download: '' }, icon('download'), 'Export CSV (Excel)'),
      S.form.files.cert ? pdfBtn : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => renderResponsesTab(el) }, icon('refresh'), 'Refresh'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: clearAll }, icon('trash'), 'Delete all')
    );

    const summary = qStats.length
      ? card(
          'Ratings summary',
          allFive ? h('p', { class: 'tiny muted', style: { margin: '-6px 0 14px' } }, 'Interpretation: 4.50–5.00 Outstanding · 3.50–4.49 Very Satisfactory · 2.50–3.49 Satisfactory · 1.50–2.49 Unsatisfactory · 1.00–1.49 Poor') : null,
          qStats.map((s) =>
            h(
              'div',
              { class: 'qstat' },
              h(
                'div',
                { class: 'top' },
                h('b', null, s.number ? `${s.number}. ` : '', s.q.title),
                h('div', { class: 'mean' }, h('div', { class: 'm' }, s.mean !== null ? s.mean.toFixed(2) : '—'), h('div', { class: 'vi' }, s.mean !== null && s.fivePoint ? interpret(s.mean) : `${s.n} answers`))
              ),
              h(
                'div',
                { class: 'dist' },
                Object.keys(s.dist)
                  .map(Number)
                  .sort((a, b) => b - a)
                  .map((v) => {
                    const count = s.dist[v];
                    const p = s.n ? (count / s.n) * 100 : 0;
                    return h('div', { class: 'dist-row' }, h('span', null, String(v)), h('div', { class: 'dist-bar' }, h('i', { style: { width: `${p}%` } })), h('span', null, `${count} · ${Math.round(p)}%`));
                  })
              )
            )
          )
        )
      : null;

    const choiceQs = cfg.questions.filter((q) => ['choice', 'checkbox', 'dropdown'].includes(q.type));
    const choiceSummary = choiceQs.length
      ? card(
          'Choice questions',
          choiceQs.map((q) => {
            const counts = Object.fromEntries(q.options.map((o) => [o, 0]));
            let answered = 0;
            rs.forEach((r) => {
              const v = r.answers[q.id];
              if (v === undefined) return;
              answered++;
              (Array.isArray(v) ? v : [v]).forEach((o) => { if (o in counts) counts[o]++; });
            });
            return h(
              'div',
              { class: 'qstat' },
              h('div', { class: 'top' }, h('b', null, q.title), h('div', { class: 'mean' }, h('div', { class: 'vi' }, `${answered} answers`))),
              h('div', { class: 'dist' }, q.options.map((o) => {
                const p = answered ? (counts[o] / answered) * 100 : 0;
                return h('div', { class: 'dist-row', style: { gridTemplateColumns: 'minmax(0,1.2fr) 1fr 64px' } }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, o), h('div', { class: 'dist-bar' }, h('i', { style: { width: `${p}%` } })), h('span', null, `${counts[o]} · ${Math.round(p)}%`));
              }))
            );
          })
        )
      : null;

    /* individual responses */
    const listEl = h('div', { class: 'stack' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or email', 'aria-label': 'Search responses' });
    let shown = 30;
    const drawList = () => {
      const qv = search.value.trim().toLowerCase();
      const filtered = qv ? rs.filter((r) => r.certName.toLowerCase().includes(qv) || (r.email || '').toLowerCase().includes(qv)) : rs;
      listEl.replaceChildren(
        ...filtered.slice(0, shown).map((r) => responseCard(r, () => renderResponsesTab(el))),
        filtered.length > shown ? h('button', { class: 'btn btn-block', type: 'button', onclick: () => { shown += 50; drawList(); } }, `Show more (${filtered.length - shown} left)`) : null,
        !filtered.length ? h('div', { class: 'card center-msg' }, 'No matching responses.') : null
      );
    };
    search.addEventListener('input', () => { shown = 30; drawList(); });
    drawList();

    el.replaceChildren(statsRow, toolbar, summary, choiceSummary, h('div', { class: 'section-title' }, 'Individual responses'), h('div', { class: 'search' }, icon('search'), search), listEl);

    async function clearAll() {
      const ok = await confirmDialog({ title: `Delete all ${rs.length} responses?`, message: 'This permanently deletes every response to this form, and their certificate links will stop working. Export a CSV first if you need a copy.', confirmText: 'Delete all', danger: true });
      if (!ok) return;
      try {
        await call('DELETE', `/api/admin/forms/${S.form.id}/responses`);
        toast('All responses deleted');
        renderResponsesTab(el);
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'error');
      }
    }
  }

  function responseCard(r, reload) {
    const cfg = S.form.config;
    const answers = h('div', { class: 'resp-answers', hidden: true });
    let n = 0;
    for (const q of cfg.questions) {
      if (q.type === 'section' || q.type === 'certname') continue;
      const label = q.type === 'scale' && cfg.numberScaleQuestions ? `${++n}. ${q.title}` : q.title;
      answers.append(h('div', { class: 'qa' }, h('b', null, label), h('div', null, answerText(r.answers[q.id]))));
    }
    const toggleBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { answers.hidden = !answers.hidden; toggleBtn.lastChild.textContent = answers.hidden ? 'Answers' : 'Hide answers'; } }, icon('eye'), h('span', null, 'Answers'));
    const certUrl = `${location.origin}/c/${r.token}`;
    return h(
      'article',
      { class: 'card resp-item' },
      h('div', { class: 'who' }, h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'n' }, r.certName), r.email ? h('div', { class: 'e' }, r.email) : null), h('div', { class: 'tiny muted', style: { whiteSpace: 'nowrap' } }, fmtDate(r.createdAt))),
      answers,
      h(
        'div',
        { class: 'resp-actions' },
        toggleBtn,
        S.form.files.cert ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => downloadOne(r) }, icon('download'), 'Certificate') : null,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await copyText(certUrl); toast('Certificate link copied'); } }, icon('link'), 'Copy link'),
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          title: 'Fix name',
          'aria-label': `Edit name for ${r.certName}`,
          onclick: async () => {
            const name = await promptDialog({ title: 'Edit certificate name', label: 'Name on the certificate', value: r.certName, hint: 'Their certificate link will show the corrected name.' });
            if (!name || name === r.certName) return;
            try {
              await call('PATCH', `/api/admin/responses/${r.id}`, { certName: name });
              toast('Name updated');
              reload();
            } catch (err) {
              if (err.status !== 401) toast(err.message, 'error');
            }
          },
        }, icon('edit')),
        h('button', {
          class: 'icon-btn danger',
          type: 'button',
          title: 'Delete response',
          'aria-label': `Delete response from ${r.certName}`,
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Delete this response?', message: `The response from ${r.certName} will be deleted and their certificate link will stop working.`, confirmText: 'Delete', danger: true }))) return;
            try {
              await call('DELETE', `/api/admin/responses/${r.id}`);
              toast('Response deleted');
              reload();
            } catch (err) {
              if (err.status !== 401) toast(err.message, 'error');
            }
          },
        }, icon('trash'))
      )
    );
  }

  async function downloadOne(r) {
    const c = S.form.config.certificate;
    try {
      const canvas = await Cert.render({ bgUrl: Cert.fileUrl(S.form.id, 'cert', S.form.files.cert), cert: c, name: r.certName, fontUrl: Cert.fileUrl(S.form.id, 'font', S.form.files.font) });
      Cert.download(await Cert.toBlob(canvas, 'image/jpeg', 0.94), Cert.fileName(c.fileName, r.certName, S.form.config.title, 'jpg'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function downloadAllCertificates(rs) {
    const c = S.form.config.certificate;
    let cancelled = false;
    const bar = h('i');
    const label = h('div', { class: 'small muted' }, 'Preparing…');
    const m = modal({
      title: 'Creating certificates PDF',
      body: h('div', null, h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, `One page per participant (${rs.length} total), sorted A–Z. Keep this tab open.`), h('div', { class: 'progress' }, bar), label),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => { cancelled = true; m.close(); } }, 'Cancel')],
      onClose: () => { cancelled = true; },
    });
    try {
      const img = await Cert.loadImage(Cert.fileUrl(S.form.id, 'cert', S.form.files.cert));
      const family = await Cert.ensureFont(c, Cert.fileUrl(S.form.id, 'font', S.form.files.font));
      const W = Math.min(img.naturalWidth, 1754); // ~150 dpi on A4 landscape
      const H = Math.round((W * img.naturalHeight) / img.naturalWidth);
      const canvas = h('canvas', { width: W, height: H });
      const ctx = canvas.getContext('2d');
      const sorted = [...rs].sort((a, b) => a.certName.localeCompare(b.certName));
      const pages = [];
      for (let i = 0; i < sorted.length; i++) {
        if (cancelled) return;
        Cert.draw(ctx, img, W, H, sorted[i].certName, c, family);
        pages.push(await Cert.canvasToPdfPage(canvas, 0.86));
        bar.style.width = `${((i + 1) / sorted.length) * 100}%`;
        label.textContent = `${i + 1} of ${sorted.length}`;
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return;
      Cert.download(Cert.buildPdf(pages), Cert.fileName('{title} - certificates', '', S.form.config.title, 'pdf'));
      m.close();
      toast('PDF ready');
    } catch (e) {
      m.close();
      toast(e.message || 'Could not create the PDF.', 'error');
    }
  }

  /* ================================================================ */
  /* Settings tab                                                      */
  /* ================================================================ */
  function renderSettingsTab(el) {
    const c = S.draft.config;
    const f = S.form;

    const slugInput = h('input', {
      value: S.draft.slug,
      maxlength: '60',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': 'Form link',
      oninput: (e) => { S.draft.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'); markDirty(); },
      onblur: (e) => { S.draft.slug = S.draft.slug.replace(/^-+|-+$/g, ''); e.target.value = S.draft.slug; },
    });

    async function setOpen(v) {
      try {
        const res = await call('PUT', `/api/admin/forms/${f.id}`, { isOpen: v });
        S.form.isOpen = res.isOpen;
        toast(v ? 'Form is now accepting responses' : 'Form closed');
        const sub = root.querySelector('.topbar-sub');
        if (sub) sub.replaceChildren(badge(res.isOpen, true));
      } catch (err) {
        if (err.status !== 401) toast(err.message, 'error');
      }
    }

    const colorText = h('input', { class: 'input', value: c.themeColor, maxlength: '7', style: { maxWidth: '130px' }, 'aria-label': 'Theme color hex code' });
    const colorPick = h('input', { type: 'color', value: c.themeColor, 'aria-label': 'Theme color' });
    const setTheme = (v) => { c.themeColor = v.toUpperCase(); colorPick.value = v; colorText.value = c.themeColor; applyTheme(c.themeColor); markDirty(); };
    colorPick.addEventListener('input', () => setTheme(colorPick.value));
    colorText.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(colorText.value.trim())) setTheme(colorText.value.trim()); });

    el.replaceChildren(
      card(
        'Sharing',
        switchRow('Accepting responses', 'Turn off to close the form. Certificate links keep working.', f.isOpen, setOpen),
        h(
          'div',
          { class: 'field', style: { marginTop: '12px' } },
          h('span', { class: 'field-label' }, 'Form link'),
          h('div', { class: 'field-inline' }, h('span', { class: 'prefix' }, `${location.host}/f/`), slugInput),
          h('span', { class: 'field-hint' }, 'Letters, numbers and dashes. Changing it breaks the old link.')
        ),
        h('div', { class: 'row row-wrap', style: { marginTop: '14px' } }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => shareModal(S.form) }, icon('qr'), 'Link & QR code'), h('a', { class: 'btn btn-sm', href: `/f/${f.slug}?preview=1`, target: '_blank', rel: 'noopener' }, icon('eye'), 'Preview'))
      ),
      card(
        'Email',
        switchRow('Collect email addresses', 'Asked first, like Google Forms.', c.collectEmail, (v) => { c.collectEmail = v; markDirty(); renderSettingsTab(el); }),
        c.collectEmail
          ? h(
              'div',
              null,
              switchRow('Limit to one response per email', 'Stops duplicate submissions and duplicate certificates.', c.onePerEmail, (v) => { c.onePerEmail = v; markDirty(); }),
              h(
                'div',
                { style: { marginTop: '8px' } },
                field('Question label', h('input', { class: 'input', value: c.emailLabel, maxlength: '200', oninput: (e) => { c.emailLabel = e.target.value; markDirty(); } })),
                field('Allowed email domains (optional)', h('input', { class: 'input', value: c.emailDomains, placeholder: 'e.g. g.batstate-u.edu.ph', autocapitalize: 'off', spellcheck: 'false', oninput: (e) => { c.emailDomains = e.target.value; markDirty(); } }), 'Only emails ending with these domains are accepted. Separate several with commas. Leave empty to accept any email.'),
                field('Help text (optional)', h('input', { class: 'input', value: c.emailHelp, maxlength: '1000', oninput: (e) => { c.emailHelp = e.target.value; markDirty(); } }))
              )
            )
          : null
      ),
      card(
        'Consent checkbox',
        field('Checkbox text (optional)', autosize(h('textarea', { class: 'textarea', rows: 2, value: c.consentText, maxlength: '1000', placeholder: 'e.g. I agree to the Data Privacy Consent above.', oninput: (e) => { c.consentText = e.target.value; markDirty(); } })), 'If filled in, participants must tick this box before submitting.')
      ),
      card(
        'Appearance',
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Theme color'), h('div', { class: 'color-row' }, colorPick, colorText)),
        h('div', { class: 'row row-wrap', style: { marginTop: '10px', gap: '8px' } }, THEME_PRESETS.map((p) => h('button', { type: 'button', title: p, 'aria-label': `Use color ${p}`, onclick: () => setTheme(p), style: { width: '32px', height: '32px', borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px var(--line-strong)', background: p } }))),
        h('div', { style: { marginTop: '10px' } }, switchRow('Number the rating questions', 'Shows 1., 2., 3.… before each rating question.', c.numberScaleQuestions, (v) => { c.numberScaleQuestions = v; markDirty(); }))
      ),
      card(
        'After submitting',
        field('Thank-you title', h('input', { class: 'input', value: c.confirmTitle, maxlength: '200', oninput: (e) => { c.confirmTitle = e.target.value; markDirty(); } })),
        field('Thank-you message', autosize(h('textarea', { class: 'textarea', rows: 3, value: c.confirmMessage, maxlength: '2000', oninput: (e) => { c.confirmMessage = e.target.value; markDirty(); } })))
      ),
      card('When the form is closed', field('Message', autosize(h('textarea', { class: 'textarea', rows: 2, value: c.closedMessage, maxlength: '1000', oninput: (e) => { c.closedMessage = e.target.value; markDirty(); } })))),
      card(
        'Manage',
        h(
          'div',
          { class: 'row row-wrap' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => duplicateForm(f.id) }, icon('copy'), 'Duplicate for a new event'),
          h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => deleteForm(S.form) }, icon('trash'), 'Delete form')
        ),
        h('p', { class: 'tiny muted', style: { margin: '10px 0 0' } }, 'Duplicating copies the questions, certificate design and settings — not the responses.')
      )
    );
  }

  /* ================================================================ */
  /* boot                                                              */
  /* ================================================================ */
  (async () => {
    try {
      const s = await api('GET', '/api/admin/session');
      if (s.signedIn) S.admin = { username: s.username, mustChange: s.mustChange };
    } catch {
      /* treat as signed out */
    }
    route();
  })();
})();
