/* Unlock module for private research experiments.
   Each private experiment is a slug directory under /research/ holding
   check.enc + content.enc (+ media *.enc), all AES-256-GCM with a
   PER-EXPERIMENT passphrase (see scripts/encrypt-research.py; crypto
   primitives in exp-crypto.js). The derived key is cached per slug:
     localStorage jsExpK:<slug> (key) / jsExpS:<slug> (salt guard —
     rotating the passphrase re-salts every file and invalidates old keys).

   On ANY page that loads this script it also unhides [data-priv="<slug>"]
   elements (hub cards) whose slug key is cached — private experiments stay
   invisible to browsers that never unlocked them.

   A private experiment page is ~10 lines of glue:
     <script src="../../assets/exp-crypto.js"></script>
     <script src="../../assets/deep.js"></script>
     <script src="../../assets/research-lock.js"></script>
     <script>ResearchLock.init({ slug: 'demo' });</script>
   Inside the decrypted content, media declares itself with
   <video data-enc="film.enc"> / <img data-enc="fig.enc"> — fetched from the
   slug directory and decrypted into blob URLs (tab memory only). */
var ResearchLock = (function () {
  /* the pre-2026-07 /experimental/ area cached un-suffixed keys; retire them */
  try { localStorage.removeItem('jsExpK'); localStorage.removeItem('jsExpS'); } catch (e) {}

  function kKey(slug) { return 'jsExpK:' + slug; }
  function kSalt(slug) { return 'jsExpS:' + slug; }

  function reveal() {
    var els = document.querySelectorAll('[data-priv]');
    for (var i = 0; i < els.length; i++) {
      try {
        if (localStorage.getItem(kKey(els[i].getAttribute('data-priv'))))
          els[i].hidden = false;
      } catch (e) {}
    }
  }
  reveal();

  var MIME = { mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg',
               jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' };

  function init(opts) {
    var slug = opts.slug;
    var $ = function (s) { return document.querySelector(s); };

    function fail(msg) { $('#exp-err').textContent = msg; $('#exp-go').disabled = false; }

    async function cachedKey(check) {
      try {
        var k = localStorage.getItem(kKey(slug)), s = localStorage.getItem(kSalt(slug));
        if (!k || s !== ExpCrypto.b64(check.salt)) return null;
        var key = await ExpCrypto.importKey(ExpCrypto.unb64(k));
        await ExpCrypto.decrypt(key, check);
        return key;
      } catch (e) { return null; }
    }

    async function unlock(key) {
      var content = await ExpCrypto.fetchEnc('content.enc');
      var html = new TextDecoder().decode(await ExpCrypto.decrypt(key, content));
      $('#exp-content').innerHTML = html;
      $('#exp-login').hidden = true;
      $('#exp-shell').hidden = false;
      if (window.DeepDives) DeepDives.wire($('#exp-content'));
      reveal();
      /* media decrypts into blob URLs — they exist only in this tab's memory */
      var media = $('#exp-content').querySelectorAll('[data-enc]');
      for (var i = 0; i < media.length; i++) {
        var name = media[i].getAttribute('data-enc');
        var blob = await ExpCrypto.decrypt(key, await ExpCrypto.fetchEnc(name));
        var ext = name.replace(/\.enc$/, '').split('.').pop().toLowerCase();
        media[i].src = URL.createObjectURL(
          new Blob([blob], { type: MIME[ext] || 'application/octet-stream' }));
      }
    }

    $('#exp-lock') && $('#exp-lock').addEventListener('click', function () {
      try { localStorage.removeItem(kKey(slug)); localStorage.removeItem(kSalt(slug)); } catch (e) {}
      location.reload();
    });

    $('#exp-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      $('#exp-go').disabled = true;
      $('#exp-err').textContent = 'checking…';
      try {
        var check = await ExpCrypto.fetchEnc('check.enc');
        var key = await ExpCrypto.deriveKey($('#exp-pass').value, check.salt);
        await ExpCrypto.decrypt(key, check);           /* throws on a wrong passphrase */
        try {
          localStorage.setItem(kKey(slug), ExpCrypto.b64(await ExpCrypto.exportKey(key)));
          localStorage.setItem(kSalt(slug), ExpCrypto.b64(check.salt));
        } catch (e) { /* private mode — unlock still works for this visit */ }
        $('#exp-err').textContent = '';
        await unlock(key);
      } catch (e) {
        fail('That passphrase doesn’t unlock this content.');
      }
    });

    /* auto-unlock a browser that already holds this slug's key */
    (async function () {
      try {
        var check = await ExpCrypto.fetchEnc('check.enc');
        var key = await cachedKey(check);
        if (key) await unlock(key);
      } catch (e) { /* offline or first visit — the form is there */ }
    })();
  }

  return { init: init, reveal: reveal };
})();
