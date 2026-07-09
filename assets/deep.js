/* Expand/collapse controls for the tiered deep-dive panels.
   A button declares which tier it drives:
     <button data-deep-toggle="learn" data-expand="Expand all learner notes"
             data-collapse="Collapse all learner notes">
   "learn" targets details.deep-learn, "ds" targets details.deep-ds.
   Exposed as window.DeepDives so research-lock.js can re-wire after
   injecting decrypted content. */
var DeepDives = (function () {
  function wire(root) {
    var scope = root || document;
    var btns = [].slice.call(document.querySelectorAll('[data-deep-toggle]'));
    btns.forEach(function (btn) {
      var sel = 'details.deep-' + btn.getAttribute('data-deep-toggle');
      var all = [].slice.call(scope.querySelectorAll(sel));
      if (!all.length) { btn.hidden = true; return; }
      btn.hidden = false;
      function anyClosed() { return all.some(function (d) { return !d.open; }); }
      function label() {
        btn.textContent = btn.getAttribute(anyClosed() ? 'data-expand' : 'data-collapse');
      }
      btn.onclick = function () {
        var open = anyClosed();
        all.forEach(function (d) { d.open = open; });
        label();
      };
      all.forEach(function (d) { d.addEventListener('toggle', label); });
      label();
    });
  }
  wire();
  return { wire: wire };
})();
