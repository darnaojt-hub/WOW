/* Certificate card shown after submitting and on the personal certificate page. */
(function () {
  'use strict';
  const { h, icon, toast, copyText } = window.App;

  /**
   * @param {{formId:number, files:object, cert:object, title:string, name:string, token?:string|null, heading?:string}} o
   */
  function certificateCard(o) {
    const bgUrl = Cert.fileUrl(o.formId, 'cert', o.files.cert);
    const fontUrl = Cert.fileUrl(o.formId, 'font', o.files.font);
    const frame = h('div', { class: 'cert-frame' }, h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), 'Preparing your certificate…'));
    const btnImg = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, icon('download'), 'Download image');
    const btnPdf = h('button', { class: 'btn', type: 'button', disabled: true }, icon('file'), 'Download PDF');
    let canvas = null;
    let jpg = null;

    (async () => {
      try {
        canvas = await Cert.render({ bgUrl, cert: o.cert, name: o.name, fontUrl });
        jpg = await Cert.toBlob(canvas, 'image/jpeg', 0.94);
        frame.replaceChildren(h('img', { src: URL.createObjectURL(jpg), alt: `Certificate for ${o.name}`, width: canvas.width, height: canvas.height }));
        btnImg.disabled = false;
        btnPdf.disabled = false;
      } catch (e) {
        frame.replaceChildren(h('div', { class: 'center-msg' }, icon('alert', 28), e.message || 'The certificate could not be loaded. Please refresh the page.'));
      }
    })();

    btnImg.addEventListener('click', () => {
      Cert.download(jpg, Cert.fileName(o.cert.fileName, o.name, o.title, 'jpg'));
    });
    btnPdf.addEventListener('click', async () => {
      btnPdf.disabled = true;
      try {
        const page = await Cert.canvasToPdfPage(canvas, 0.94);
        Cert.download(Cert.buildPdf([page]), Cert.fileName(o.cert.fileName, o.name, o.title, 'pdf'));
      } catch {
        toast('Could not create the PDF. Try “Download image” instead.', 'error');
      } finally {
        btnPdf.disabled = false;
      }
    });

    let linkRow = null;
    if (o.token) {
      const url = `${location.origin}/c/${o.token}`;
      const input = h('input', { class: 'input', readOnly: true, value: url, 'aria-label': 'Your certificate link', onfocus: (e) => e.target.select() });
      linkRow = h(
        'div',
        { style: { marginTop: '18px' } },
        h('div', { class: 'small', style: { fontWeight: '600' } }, 'Your certificate link'),
        h('div', { class: 'tiny muted' }, 'Save this link — you can open it anytime to download your certificate again.'),
        h(
          'div',
          { class: 'linkbox' },
          input,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await copyText(url); toast('Link copied'); } }, icon('copy'), 'Copy')
        )
      );
    }

    return h(
      'section',
      { class: 'card' },
      o.heading ? h('h2', { style: { marginBottom: '14px' } }, o.heading) : null,
      frame,
      h('div', { class: 'cert-actions' }, btnImg, btnPdf),
      h('p', { class: 'tiny muted', style: { margin: '12px 0 0' } }, 'If the download doesn’t start (for example inside Messenger or Facebook), press and hold the certificate to save it, or open this page in Chrome or Safari.'),
      linkRow
    );
  }

  window.CertResult = { certificateCard };
})();
