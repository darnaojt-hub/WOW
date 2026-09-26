/* Personal certificate page: /c/<token> */
(function () {
  'use strict';
  const { h, icon, api, applyTheme, fmtDate } = window.App;
  const root = document.getElementById('app');
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

  function fail(title, msg) {
    root.replaceChildren(
      h('section', { class: 'card card-head' }, h('div', { class: 'success-icon', style: { background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: '14px' } }, icon('alert')), h('h1', null, title), h('p', { class: 'muted' }, msg))
    );
  }

  (async () => {
    let d;
    try {
      d = await api('GET', `/api/public/certificates/${encodeURIComponent(token)}`);
    } catch (err) {
      return fail('Certificate not found', err.message);
    }
    applyTheme(d.form.themeColor);
    document.title = `Certificate — ${d.name}`;
    if (!d.form.certificate.enabled || !d.files.cert) {
      return fail('Certificate not available yet', 'The organizers have not published the certificate for this event. Please check back later.');
    }
    root.replaceChildren(
      h(
        'div',
        { class: 'stack' },
        h(
          'section',
          { class: 'card card-head' },
          h('div', { class: 'tiny muted', style: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Certificate'),
          h('h1', { style: { marginTop: '4px' } }, d.name),
          h('p', { class: 'muted', style: { margin: '8px 0 0' } }, d.form.title, h('br'), `Issued ${fmtDate(d.issuedAt, false)}`)
        ),
        CertResult.certificateCard({ formId: d.form.id, files: d.files, cert: d.form.certificate, title: d.form.title, name: d.name, token })
      )
    );
  })();
})();
