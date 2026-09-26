/* Participant form: /f/<link> */
(function () {
  'use strict';
  const { h, icon, rich, api, toast, applyTheme, formatName, store, debounce, autosize } = window.App;

  const root = document.getElementById('app');
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const DRAFT_KEY = `evalform:draft:${slug}`;
  const DONE_KEY = `evalform:done:${slug}`;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let data = null;
  let cfg = null;
  let state = { email: '', answers: {}, consent: false };
  let cards = {};

  const saveDraft = debounce(() => { if (!preview) store.set(DRAFT_KEY, state); }, 400);

  /* ---------------- helpers ---------------- */
  function banner() {
    const b = data.files && data.files.banner;
    return b ? h('div', { class: 'banner' }, h('img', { src: Cert.fileUrl(data.id, 'banner', b), alt: '' })) : null;
  }
  function messageCard(title, msg, iconName) {
    return h(
      'section',
      { class: 'card card-head' },
      iconName ? h('div', { class: 'success-icon', style: { background: 'var(--brand-soft)', color: 'var(--brand-strong)', marginBottom: '14px' } }, icon(iconName)) : null,
      h('h1', null, title),
      msg ? rich(msg, 'head-desc') : null
    );
  }
  function setError(id, msg) {
    const c = cards[id];
    if (!c) return;
    c.el.classList.toggle('has-error', Boolean(msg));
    c.err.hidden = !msg;
    c.err.querySelector('span').textContent = msg || '';
  }
  function qCard(id, { title, help, required, body, number, cls }) {
    const err = h('div', { class: 'q-error', hidden: true, role: 'alert' }, icon('alert', 18), h('span'));
    const titleId = `t-${id}`;
    const el = h(
      'section',
      { class: 'card q' + (cls ? ' ' + cls : ''), id: `q-${id}`, role: 'group', 'aria-labelledby': titleId },
      h('div', { class: 'q-title', id: titleId }, number ? `${number}. ` : '', title || 'Untitled question', required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null),
      help ? rich(help, 'q-help') : null,
      h('div', { class: 'q-body' }, body),
      err
    );
    cards[id] = { el, err };
    return el;
  }
  const onAnswer = (id, value) => {
    state.answers[id] = value;
    setError(id, null);
    saveDraft();
  };

  /* ---------------- question bodies ---------------- */
  function scaleBody(q) {
    const opts = [];
    for (let v = q.min; v <= q.max; v++) {
      const id = `s-${q.id}-${v}`;
      const aria = v === q.min && q.minLabel ? `${v} (${q.minLabel})` : v === q.max && q.maxLabel ? `${v} (${q.maxLabel})` : String(v);
      opts.push(
        h(
          'div',
          { class: 'scale-opt' },
          h('input', { type: 'radio', name: `s-${q.id}`, id, value: String(v), checked: state.answers[q.id] === v, 'aria-label': aria, onchange: () => onAnswer(q.id, v) }),
          h('label', { for: id }, String(v), h('span', { class: 'dot' }))
        )
      );
    }
    return [
      h('div', { class: 'scale', style: `--n:${q.max - q.min + 1}` }, opts),
      q.minLabel || q.maxLabel ? h('div', { class: 'scale-labels', 'aria-hidden': 'true' }, h('span', null, q.minLabel), h('span', null, q.maxLabel)) : null,
    ];
  }
  function textBody(q) {
    const common = { 'aria-labelledby': `t-${q.id}`, value: state.answers[q.id] || '', oninput: (e) => onAnswer(q.id, e.target.value) };
    if (q.type === 'short') return h('input', { class: 'input', type: 'text', maxlength: '500', placeholder: 'Your answer', ...common });
    return autosize(h('textarea', { class: 'textarea', rows: 3, maxlength: '5000', placeholder: 'Your answer', ...common }));
  }
  function choiceBody(q) {
    if (q.type === 'dropdown') {
      return h(
        'select',
        { class: 'select', 'aria-labelledby': `t-${q.id}`, value: state.answers[q.id] || '', onchange: (e) => onAnswer(q.id, e.target.value || undefined) },
        h('option', { value: '' }, 'Choose'),
        q.options.map((o) => h('option', { value: o }, o))
      );
    }
    const multi = q.type === 'checkbox';
    const current = state.answers[q.id];
    return h(
      'div',
      { class: 'choices' },
      q.options.map((o) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: multi ? 'checkbox' : 'radio',
            name: `c-${q.id}`,
            value: o,
            checked: multi ? Array.isArray(current) && current.includes(o) : current === o,
            onchange: (e) => {
              if (!multi) return onAnswer(q.id, o);
              const set = new Set(Array.isArray(state.answers[q.id]) ? state.answers[q.id] : []);
              e.target.checked ? set.add(o) : set.delete(o);
              onAnswer(q.id, q.options.filter((x) => set.has(x)));
            },
          }),
          h('span', null, o)
        )
      )
    );
  }
  function nameBody(q) {
    const certOn = cfg.certificate.enabled && data.files.cert;
    const strong = h('strong', null, '');
    const previewRow = certOn ? h('div', { class: 'name-preview', hidden: true }, h('span', null, 'On your certificate:'), strong) : null;
    const update = (v) => {
      if (!previewRow) return;
      const name = formatName(v, cfg.certificate.nameFormat);
      strong.textContent = name;
      previewRow.hidden = !name;
    };
    if (certOn) {
      Cert.ensureFont(cfg.certificate, Cert.fileUrl(data.id, 'font', data.files.font)).then((family) => (strong.style.fontFamily = family));
    }
    const input = h('input', {
      class: 'input',
      type: 'text',
      maxlength: '120',
      autocomplete: 'name',
      autocapitalize: 'words',
      placeholder: 'e.g. Juan A. Dela Cruz',
      'aria-labelledby': `t-${q.id}`,
      value: state.answers[q.id] || '',
      oninput: (e) => { onAnswer(q.id, e.target.value); update(e.target.value); },
    });
    update(input.value);
    return [input, previewRow];
  }

  /* ---------------- views ---------------- */
  function renderForm() {
    cards = {};
    const doneToken = !preview && store.get(DONE_KEY);
    const children = [];
    if (preview) children.push(h('div', { class: 'notice notice-warn' }, h('b', null, 'Preview mode. '), 'Submissions here are not saved — use this to check the form and the certificate.'));
    if (doneToken) {
      children.push(
        h('div', { class: 'notice notice-info row' }, icon('award'), h('span', { class: 'spacer' }, 'You already submitted this form on this device.'), h('a', { href: `/c/${encodeURIComponent(doneToken)}`, style: { fontWeight: '600' } }, 'View certificate'))
      );
    }
    children.push(banner());
    const anyRequired = cfg.collectEmail || cfg.questions.some((q) => q.required) || cfg.consentText;
    children.push(
      h('section', { class: 'card card-head' }, h('h1', null, cfg.title), cfg.description ? rich(cfg.description, 'head-desc') : null, anyRequired ? h('div', { class: 'req-note' }, '* Indicates required question') : null)
    );

    if (cfg.collectEmail) {
      const domains = cfg.emailDomains ? cfg.emailDomains.split(/,\s*/) : [];
      const help = cfg.emailHelp || (domains.length ? `Use your ${domains.map((d) => '@' + d).join(' or ')} email.` : '');
      children.push(
        qCard('email', {
          title: cfg.emailLabel,
          help,
          required: true,
          body: h('input', {
            class: 'input',
            type: 'email',
            inputmode: 'email',
            autocomplete: 'email',
            autocapitalize: 'off',
            spellcheck: 'false',
            maxlength: '254',
            placeholder: domains.length ? `yourname@${domains[0]}` : 'Your email',
            'aria-labelledby': 't-email',
            value: state.email,
            oninput: (e) => { state.email = e.target.value; setError('email', null); saveDraft(); },
          }),
        })
      );
    }

    let num = 0;
    for (const q of cfg.questions) {
      if (q.type === 'section') {
        children.push(h('section', { class: 'card section-card' }, h('h2', null, q.title), q.help ? rich(q.help, 'q-help') : null));
        continue;
      }
      const number = q.type === 'scale' && cfg.numberScaleQuestions ? ++num : null;
      const body = q.type === 'scale' ? scaleBody(q) : q.type === 'certname' ? nameBody(q) : ['short', 'paragraph'].includes(q.type) ? textBody(q) : choiceBody(q);
      children.push(qCard(q.id, { title: q.title, help: q.help, required: q.required, body, number }));
    }

    if (cfg.consentText) {
      children.push(
        qCard('consent', {
          title: 'Consent',
          required: true,
          body: h(
            'label',
            { class: 'choice', style: { alignItems: 'flex-start' } },
            h('input', { type: 'checkbox', checked: state.consent, style: { marginTop: '3px' }, onchange: (e) => { state.consent = e.target.checked; setError('consent', null); saveDraft(); } }),
            rich(cfg.consentText)
          ),
        })
      );
    }

    const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit', style: { minWidth: '140px' } }, 'Submit');
    const clearBtn = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: () => {
        if (!confirm('Clear all your answers on this form?')) return;
        state = { email: '', answers: {}, consent: false };
        store.del(DRAFT_KEY);
        renderForm();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    }, 'Clear form');
    children.push(h('div', { class: 'submit-row' }, submitBtn, clearBtn));

    const formEl = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(submitBtn); } }, children);
    root.replaceChildren(formEl);
  }

  function clientErrors() {
    const errors = {};
    if (cfg.collectEmail) {
      const e = state.email.trim();
      const domains = cfg.emailDomains ? cfg.emailDomains.split(/,\s*/) : [];
      if (!e) errors.email = 'This is a required question';
      else if (!EMAIL_RE.test(e)) errors.email = 'Please enter a valid email address';
      else if (domains.length && !domains.includes(e.split('@').pop().toLowerCase())) errors.email = `Please use your ${domains.map((d) => '@' + d).join(' or ')} account`;
    }
    for (const q of cfg.questions) {
      if (!q.required || q.type === 'section') continue;
      const v = state.answers[q.id];
      const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
      if (empty) errors[q.id] = 'This is a required question';
    }
    if (cfg.consentText && !state.consent) errors.consent = 'Please check this box to continue';
    return errors;
  }

  function showErrors(errors) {
    Object.keys(cards).forEach((id) => setError(id, errors[id] || null));
    const firstId = Object.keys(cards).find((id) => errors[id]);
    if (firstId) {
      const el = cards[firstId].el;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = el.querySelector('input, textarea, select');
      if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 350);
    }
    return Boolean(firstId);
  }

  async function submit(btn) {
    if (showErrors(clientErrors())) return;
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner', style: { width: '18px', height: '18px', borderWidth: '2px', borderColor: 'rgba(255,255,255,.35)', borderTopColor: '#fff' } }), 'Submitting…');
    try {
      const res = await api('POST', `/api/public/forms/${encodeURIComponent(slug)}/responses${preview ? '?preview=1' : ''}`, {
        email: state.email.trim(),
        answers: state.answers,
        consent: state.consent,
      });
      store.del(DRAFT_KEY);
      if (res.token) store.set(DONE_KEY, res.token);
      renderDone(res);
    } catch (err) {
      btn.disabled = false;
      btn.replaceChildren('Submit');
      if (err.data && err.data.errors) {
        showErrors(err.data.errors);
        toast(err.message, 'error');
      } else toast(err.message, 'error');
    }
  }

  function renderDone(res) {
    const certOn = cfg.certificate.enabled && data.files.cert;
    root.replaceChildren(
      h(
        'div',
        { class: 'stack' },
        banner(),
        h(
          'section',
          { class: 'card card-head' },
          h('div', { class: 'success-icon' }, icon('check')),
          h('h1', { style: { marginTop: '14px' } }, cfg.confirmTitle),
          cfg.confirmMessage ? rich(cfg.confirmMessage, 'head-desc') : null,
          res.preview ? h('div', { class: 'notice notice-warn', style: { marginTop: '14px' } }, 'Preview mode — this response was not saved.') : null
        ),
        certOn
          ? CertResult.certificateCard({ formId: data.id, files: data.files, cert: cfg.certificate, title: cfg.title, name: res.certName, token: res.token })
          : null,
        !cfg.onePerEmail || res.preview ? h('p', { class: 'small', style: { textAlign: 'center' } }, h('a', { href: location.pathname + location.search }, 'Submit another response')) : null
      )
    );
    window.scrollTo({ top: 0 });
  }

  /* ---------------- boot ---------------- */
  async function init() {
    try {
      data = await api('GET', `/api/public/forms/${encodeURIComponent(slug)}${preview ? '?preview=1' : ''}`);
    } catch (err) {
      root.replaceChildren(messageCard(err.status === 404 ? 'Form not found' : 'Could not load the form', err.message, 'alert'));
      return;
    }
    cfg = data.config;
    applyTheme(cfg.themeColor);
    document.title = cfg.title;
    if (!data.open && !data.preview) {
      root.replaceChildren(h('div', { class: 'stack' }, banner(), messageCard(cfg.title, cfg.closedMessage || 'This form is no longer accepting responses.', 'lock')));
      return;
    }
    const draft = !preview && store.get(DRAFT_KEY);
    if (draft && typeof draft === 'object') {
      state = { email: typeof draft.email === 'string' ? draft.email : '', answers: draft.answers && typeof draft.answers === 'object' ? draft.answers : {}, consent: Boolean(draft.consent) };
    }
    renderForm();
  }
  init();
})();
