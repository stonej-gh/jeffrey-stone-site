/* Unlock module for private research experiments - keys are PER SLUG GROUP.

   Each private experiment is a slug directory under /research/ holding
   check.enc + content.enc (+ media *.enc / doc *.md.enc), all AES-256-GCM.
   Keys (2026-07-10): the implementation notebooks have one key; the demo
   canary keeps its own. (The spotter-on-mirror key is retired: spotter is
   plaintext on both surfaces since the mirror went lockstep.) A
   passphrase entered on any private page still ATTEMPTS every sibling slug
   in PRIVATE_SLUGS, but only unlocks the ones whose check.enc verifies with
   it - slugs on a different key just fail quietly and stay locked (each
   slug keeps its own salt, so keys are derived per-slug). Derived keys are
   cached per slug:
     localStorage jsExpK:<slug> (key) / jsExpS:<slug> (salt guard -
     rotating the passphrase re-salts every file and invalidates old keys).

   On ANY page that loads this script it also unhides [data-priv="<slug>"]
   elements (hub cards) whose slug key is cached - private experiments stay
   invisible to browsers that never unlocked them.

   Sibling check.enc files are fetched by ABSOLUTE url derived from this
   script's own src (captured below), so unlock works whether the site is
   served at the apex root or under the mirror's /spacewar-mirror/ subpath.

   A private experiment page is ~10 lines of glue:
     <script src="../../assets/exp-crypto.js"></script>
     <script src="../../assets/md-render.js"></script>   (only if it uses data-md docs)
     <script src="../../assets/deep.js"></script>
     <script src="../../assets/research-lock.js"></script>
     <script>ResearchLock.init({ slug: 'demo' });</script>
   Inside the decrypted content, media declares itself with
   <video data-enc="film.enc"> / <img data-enc="fig.enc"> - fetched from the
   slug directory and decrypted into blob URLs (tab memory only). A rendered,
   downloadable markdown doc declares <div data-md="doc.md.enc"
   data-filename="doc.md"> with a .md-body target and an optional
   a.md-download button inside it. */
var ResearchLock = (function () {
  /* the pre-2026-07 /experimental/ area cached un-suffixed keys; retire them */
  try { localStorage.removeItem('jsExpK'); localStorage.removeItem('jsExpS'); } catch (e) {}

  /* Every private slug a passphrase should be TRIED against. A slug encrypted
     with a different key just fails to verify and is skipped. Order is
     cosmetic. */
  var PRIVATE_SLUGS = ['implementation', 'demo'];

  /* Absolute URL of the /research/ directory, from this script's own location
     (…/assets/research-lock.js -> …/research/). currentScript is only valid
     during initial execution, so capture it now. */
  var SELF = document.currentScript ? document.currentScript.src : '';
  var RESEARCH_ROOT = SELF.replace(/assets\/research-lock\.js.*$/, 'research/');

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

  /* Given a plaintext passphrase, try to unlock every sibling slug: derive its
     key from its own salt, verify against its check.enc, cache on success.
     Best-effort - any slug that 404s or fails to verify is silently skipped.
     Returns after all attempts so a following reveal() sees the fresh keys. */
  async function unlockSiblings(passphrase) {
    for (var i = 0; i < PRIVATE_SLUGS.length; i++) {
      var slug = PRIVATE_SLUGS[i];
      try {
        if (localStorage.getItem(kKey(slug))) continue;   /* already cached */
        var check = await ExpCrypto.fetchEnc(RESEARCH_ROOT + slug + '/check.enc');
        var key = await ExpCrypto.deriveKey(passphrase, check.salt);
        await ExpCrypto.decrypt(key, check);               /* throws if wrong */
        localStorage.setItem(kKey(slug), ExpCrypto.b64(await ExpCrypto.exportKey(key)));
        localStorage.setItem(kSalt(slug), ExpCrypto.b64(check.salt));
      } catch (e) { /* not this passphrase, or plaintext here - skip */ }
    }
  }

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

    /* Decrypt a rendered-markdown doc into its .md-body, then wire download
       (raw .md as a file), copy (raw .md to the clipboard - the VIEW is
       rendered but what you take away is Markdown), and an optional TOC
       (.md-toc nav filled from the rendered h2/h3 headings). */
    async function renderMd(key, el) {
      var name = el.getAttribute('data-md');
      var buf = await ExpCrypto.decrypt(key, await ExpCrypto.fetchEnc(name));
      var text = new TextDecoder().decode(buf);
      var body = el.querySelector('.md-body') || el;
      body.innerHTML = window.MdRender ? MdRender.toHtml(text) : ('<pre>' + text + '</pre>');
      var dl = el.querySelector('a.md-download');
      if (dl) {
        dl.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
        dl.download = el.getAttribute('data-filename') || 'document.md';
      }
      var cp = el.querySelector('button.md-copy');
      if (cp) cp.addEventListener('click', function () {
        var done = function () {
          var old = cp.textContent;
          cp.textContent = 'Copied';
          setTimeout(function () { cp.textContent = old; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(text).then(done, function () { cp.textContent = 'Copy failed'; });
        else cp.textContent = 'Copy failed';
      });
      var toc = el.querySelector('.md-toc');
      if (toc) {
        var hs = body.querySelectorAll('h2, h3');
        if (hs.length < 2) { toc.hidden = true; return; }
        var title = document.createElement('p');
        title.className = 'toc-title';
        title.textContent = 'Contents';
        toc.appendChild(title);
        var used = {};
        for (var i = 0; i < hs.length; i++) {
          var id = hs[i].textContent.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sec';
          while (used[id]) id += '-b';
          used[id] = 1;
          hs[i].id = id;
          var a = document.createElement('a');
          a.href = '#' + id;
          a.textContent = hs[i].textContent;
          a.className = hs[i].tagName === 'H3' ? 'toc-h3' : 'toc-h2';
          toc.appendChild(a);
        }
      }
    }

    async function unlock(key) {
      var content = await ExpCrypto.fetchEnc('content.enc');
      var html = new TextDecoder().decode(await ExpCrypto.decrypt(key, content));
      $('#exp-content').innerHTML = html;
      $('#exp-login').hidden = true;
      $('#exp-shell').hidden = false;
      if (window.DeepDives) DeepDives.wire($('#exp-content'));
      reveal();
      /* media decrypts into blob URLs - they exist only in this tab's memory */
      var media = $('#exp-content').querySelectorAll('[data-enc]');
      for (var i = 0; i < media.length; i++) {
        var name = media[i].getAttribute('data-enc');
        var blob = await ExpCrypto.decrypt(key, await ExpCrypto.fetchEnc(name));
        var ext = name.replace(/\.enc$/, '').split('.').pop().toLowerCase();
        media[i].src = URL.createObjectURL(
          new Blob([blob], { type: MIME[ext] || 'application/octet-stream' }));
      }
      /* rendered + downloadable markdown docs (deployment notebooks) */
      var docs = $('#exp-content').querySelectorAll('[data-md]');
      for (var j = 0; j < docs.length; j++) await renderMd(key, docs[j]);
    }

    $('#exp-lock') && $('#exp-lock').addEventListener('click', function () {
      try { localStorage.removeItem(kKey(slug)); localStorage.removeItem(kSalt(slug)); } catch (e) {}
      location.reload();
    });

    $('#exp-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      $('#exp-go').disabled = true;
      $('#exp-err').textContent = 'checking…';
      var pass = $('#exp-pass').value;
      try {
        var check = await ExpCrypto.fetchEnc('check.enc');
        var key = await ExpCrypto.deriveKey(pass, check.salt);
        await ExpCrypto.decrypt(key, check);           /* throws on a wrong passphrase */
        try {
          localStorage.setItem(kKey(slug), ExpCrypto.b64(await ExpCrypto.exportKey(key)));
          localStorage.setItem(kSalt(slug), ExpCrypto.b64(check.salt));
        } catch (e) { /* private mode - unlock still works for this visit */ }
        $('#exp-err').textContent = '';
        await unlock(key);
        await unlockSiblings(pass);   /* one passphrase opens the whole family */
        reveal();
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
      } catch (e) { /* offline or first visit - the form is there */ }
    })();
  }

  return { init: init, reveal: reveal };
})();
