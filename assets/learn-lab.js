/* /learn/ - the lesson toys, plain canvas, no libraries. Same contract as
   orbits-lab.js: each toy binds to a canvas[data-lab=…] and its own control
   row, and no-ops if the canvas isn't on the page. One shared rAF loop that
   sleeps whenever nothing is moving.

   Unlike the orbit toys these carry labels, so the logical space follows the
   element: 960x540 on a wide screen, 480 wide and taller on a phone, where a
   scaled-down 960 would shrink the type past reading. Every toy lays itself
   out from L = {W, H, narrow}. Bars are horizontal and dragged sideways, so a
   finger moving down the page still scrolls it (touch-action: pan-y). */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var CYAN = '#35e0d5', INK = '#eef4ff', MUTED = 'rgba(128,139,159,0.95)',
      RUST = '#d9825f', VIOLET = '#9a6cf0', GOLD = '#ffc887', BLUE = '#7fb2ff',
      LINE = '#222c3d', PANEL = '#10151f';
  var PALETTE = [CYAN, GOLD, VIOLET, RUST, BLUE];
  var MONO = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
  var MONO_S = '500 11.5px ui-monospace, "SF Mono", Menlo, monospace';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- the arithmetic the lesson is about ---------- */

  // softmax at temperature T: divide, grow (e^s), share. The max is taken
  // out first so e^s cannot overflow; it cancels in the division.
  function softmax(z, T) {
    T = T || 1;
    var m = -Infinity, i, out = [], sum = 0;
    for (i = 0; i < z.length; i++) if (z[i] / T > m) m = z[i] / T;
    for (i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] / T - m); sum += out[i]; }
    for (i = 0; i < z.length; i++) out[i] /= sum;
    return out;
  }
  function argmax(z) {
    var b = 0;
    for (var i = 1; i < z.length; i++) if (z[i] > z[b]) b = i;
    return b;
  }
  /* ---------- shared plumbing ---------- */

  function setupCanvas(canvas, wideH, narrowH) {
    var ctx = canvas.getContext('2d');
    var L = { W: 960, H: wideH, narrow: false };
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = canvas.clientWidth || 960;
      L.narrow = cw < 620;
      L.W = L.narrow ? 480 : 960;
      L.H = L.narrow ? narrowH : wideH;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(cw * dpr * L.H / L.W);
      var s = canvas.width / L.W;
      ctx.setTransform(s, 0, 0, s, 0, 0);
    }
    resize();
    return { ctx: ctx, L: L, resize: resize };
  }
  function pointerPos(canvas, L, e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * L.W, y: (e.clientY - r.top) / r.height * L.H };
  }
  function text(ctx, x, y, txt, color, font, align) {
    ctx.font = font || MONO; ctx.fillStyle = color || MUTED;
    ctx.textAlign = align || 'left'; ctx.fillText(txt, x, y); ctx.textAlign = 'left';
  }
  function rrect(ctx, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  function pct(p) {
    var v = p * 100;
    return (v >= 99.95 ? '100' : v < 0.05 ? '0' : v < 10 ? v.toFixed(1) : v.toFixed(0)) + '%';
  }
  function signed(v) {
    var a = Math.abs(v).toFixed(1);
    return (v >= 0 || a === '0.0' ? '+' : '−') + a;
  }
  function setText(id, s) { var el = document.getElementById(id); if (el) el.textContent = s; }
  function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

  var widgets = [], rafId = null, prevTs = 0;
  function loop(ts) {
    var dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.05) : 0.016;
    prevTs = ts;
    var busy = false;
    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      if (w.visible === false) continue;
      w.step(dt); w.draw();
      if (w.need()) busy = true;
    }
    if (busy) { rafId = requestAnimationFrame(loop); }
    else { rafId = null; prevTs = 0; }
  }
  function wake() { if (!rafId) { prevTs = 0; rafId = requestAnimationFrame(loop); } }
  function register(w) {
    widgets.push(w);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        w.visible = entries[0].isIntersecting;
        if (w.visible) { w.draw(); if (w.need()) wake(); }
      }).observe(w.canvas);
    }
    window.addEventListener('resize', function () { w.resize(); w.draw(); });
    w.draw();
  }

  /* A column of signed score bars the reader drags sideways. rows(): the
     row rectangles for the current layout; the caller draws around them. */
  function ScoreColumn(opts) {
    // opts: scores[], lo, hi, geom() -> {x, w, top, rowH}, onChange()
    var self = this;
    self.scores = opts.scores; self.lo = opts.lo; self.hi = opts.hi;
    self.drag = -1; self.hover = -1;
    self.zeroX = function (g) { return g.x + g.w * (0 - self.lo) / (self.hi - self.lo); };
    self.toX = function (g, s) { return g.x + g.w * (s - self.lo) / (self.hi - self.lo); };
    self.rowAt = function (g, p) {
      var i = Math.floor((p.y - g.top) / g.rowH);
      return (i >= 0 && i < self.scores.length && p.x > g.x - 24 && p.x < g.x + g.w + 24) ? i : -1;
    };
    self.setFrom = function (g, i, p) {
      var s = self.lo + (p.x - g.x) / g.w * (self.hi - self.lo);
      self.scores[i] = Math.round(Math.max(self.lo, Math.min(self.hi, s)) * 10) / 10;
      opts.onChange();
    };
    self.bind = function (canvas, L) {
      canvas.addEventListener('pointerdown', function (e) {
        var p = pointerPos(canvas, L, e), g = opts.geom(), i = self.rowAt(g, p);
        if (i < 0) return;
        self.drag = i;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
        self.setFrom(g, i, p);
      });
      canvas.addEventListener('pointermove', function (e) {
        var p = pointerPos(canvas, L, e), g = opts.geom();
        if (self.drag >= 0) { self.setFrom(g, self.drag, p); return; }
        var h = self.rowAt(g, p);
        if (h !== self.hover) { self.hover = h; canvas.style.cursor = h >= 0 ? 'ew-resize' : ''; opts.onChange(); }
      });
      function up() { if (self.drag >= 0) { self.drag = -1; opts.onChange(); } }
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', function () { if (self.drag < 0 && self.hover >= 0) { self.hover = -1; opts.onChange(); } });
    };
    self.draw = function (ctx, colors) {
      var g = opts.geom(), zx = self.zeroX(g), n = self.scores.length;
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(zx, g.top - 4); ctx.lineTo(zx, g.top + g.rowH * n - 6); ctx.stroke();
      for (var i = 0; i < n; i++) {
        var y = g.top + g.rowH * i, bh = Math.min(30, g.rowH - 22), x = self.toX(g, self.scores[i]);
        var live = (self.drag === i || self.hover === i);
        ctx.globalAlpha = live ? 1 : 0.86;
        ctx.fillStyle = colors[i]; rrect(ctx, zx, y, x - zx, bh, 4); ctx.fill();
        ctx.globalAlpha = 1;
        // the grip: a handle at the bar's end says "drag me"
        ctx.fillStyle = live ? INK : 'rgba(238,244,255,0.72)';
        rrect(ctx, x - 3, y - 4, 6, bh + 8, 3); ctx.fill();
        var right = self.scores[i] >= 0;
        text(ctx, x + (right ? 11 : -11), y + bh / 2 + 4.5, signed(self.scores[i]), INK, MONO, right ? 'left' : 'right');
      }
    };
  }

  /* ---------- the real pilot, one real match: three toys ----------
     PILOT_DATA (assets/learn/pilot-data.js, generated by
     scripts/learn/export-pilot-moments.py) holds the shipped weights and
     every decision of one match. Everything shown is computed here, live,
     by forwardAll(). The three toys share the arena, the timeline and the
     play button, and differ in the panel beside the arena:
       senses  (lesson 1) the nineteen numbers going in
       brain   (lesson 1) every number in the net, 19 -> 64 -> 64 -> 12
       pilot   (lesson 2) the twelve scores coming out, or their shares */
  var SENSES = ['height above the hole', 'speed away from it', 'speed around it',
    'nose against the orbit, sin', 'nose against the orbit, cos',
    'enemy off the nose, sin', 'enemy off the nose, cos', 'enemy alive',
    'room to the wall', 'distance to the enemy', 'closing speed', 'enemy’s height',
    'hits taken', 'hits landed', 'gun cooling down',
    'nearest shot, distance', 'nearest shot, sin', 'nearest shot, cos', 'fuel'];
  var TURN = { '-1': '↻', '0': '•', '1': '↺' };

  // the pilot's forward pass, the same loop as ml-toys orbitduel/netpilot.py
  // (weighted sum plus bias per row, tanh between layers, the last layer raw),
  // keeping every layer: [inputs, hidden 1, hidden 2, scores]
  function forwardAll(layers, x) {
    var all = [x];
    for (var k = 0; k < layers.length; k++) {
      var w = layers[k].w, b = layers[k].b, out = [];
      for (var r = 0; r < w.length; r++) {
        var s = b[r], row = w[r];
        for (var c = 0; c < row.length; c++) s += row[c] * x[c];
        out.push(k === layers.length - 1 ? s : Math.tanh(s));
      }
      all.push(out); x = out;
    }
    return all;
  }
  function moveWords(D, a) {
    var t = D.actions[a][0], parts = [];
    parts.push(t === 0 ? 'hold course' : t > 0 ? 'turn ↺' : 'turn ↻');
    if (D.actions[a][1]) parts.push('burn');
    if (D.actions[a][2]) parts.push('fire');
    return parts.join(' + ');
  }
  // cyan for positive, rust for negative, strength as opacity
  function signColor(v, lim) {
    var a = Math.min(1, Math.abs(v) / lim);
    return (v >= 0 ? 'rgba(53,224,213,' : 'rgba(217,130,95,') + (0.08 + 0.92 * a).toFixed(3) + ')';
  }

  function drawPilotArena(ctx, D, b, idx, small) {
    var M = D.moments, m = M[idx];
    var k = b.w / D.field.w, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    // the lab's y axis points up; flip it so a counter-clockwise turn reads
    // counter-clockwise on the screen
    function X(x) { return cx + x * k; }
    function Y(y) { return cy - y * k; }
    function ship(x, y, ang, color) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath();
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#03050a'; rrect(ctx, b.x, b.y, b.w, b.h, 8); ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke();
    var hr = D.field.hole * k, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, hr * 2.4);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.42, 'rgba(6,8,14,0.96)');
    g.addColorStop(0.72, 'rgba(106,63,176,0.30)'); g.addColorStop(1, 'rgba(106,63,176,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, hr * 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fillStyle = '#05060a'; ctx.fill();
    ctx.strokeStyle = 'rgba(53,224,213,0.25)'; ctx.stroke();
    // the paths so far, so a still frame still reads as flight
    var from = Math.max(0, idx - 45), i;
    for (var who = 0; who < 2; who++) {
      ctx.beginPath();
      for (i = from; i <= idx; i++) {
        var q = who ? M[i].o : M[i].s;
        if (i === from) ctx.moveTo(X(q[0]), Y(q[1])); else ctx.lineTo(X(q[0]), Y(q[1]));
      }
      ctx.strokeStyle = who ? 'rgba(217,130,95,0.35)' : 'rgba(53,224,213,0.35)';
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (i = 0; i < m.lz.length; i++) {
      ctx.beginPath(); ctx.arc(X(m.lz[i][0]), Y(m.lz[i][1]), 2.6, 0, TAU);
      ctx.fillStyle = m.lz[i][2] === 0 ? CYAN : RUST; ctx.fill();
    }
    if (m.o[3]) ship(X(m.o[0]), Y(m.o[1]), -m.o[2], RUST);
    ship(X(m.s[0]), Y(m.s[1]), -m.s[2], CYAN);
    text(ctx, b.x + 12, b.y + 22, 'THE PILOT', CYAN, MONO_S);
    text(ctx, b.x + b.w - 12, b.y + 22, small ? 'OPPONENT' : 'SCRIPTED OPPONENT, LEVEL ' + D.match.level, RUST, MONO_S, 'right');
    if (!small) {
      text(ctx, b.x + 12, b.y + 38, 'hits taken ' + m.dmg[0] + ' of 5', MUTED, MONO_S);
      text(ctx, b.x + b.w - 12, b.y + 38, 'hits taken ' + m.dmg[1] + ' of 5', MUTED, MONO_S, 'right');
      text(ctx, b.x + 12, b.y + b.h - 12, 'decision ' + (idx + 1) + ' of ' + M.length + ', fifteen a second', MUTED, MONO_S);
    }
  }

  /* opts: lab, wideH, narrowH, ids {time, play}, arena(L) -> box, small,
     panel(ctx, L, box, st), readout(st), tap(p, L, box) */
  function pilotToy(opts) {
    var canvas = document.querySelector('canvas[data-lab="' + opts.lab + '"]');
    var D = window.PILOT_DATA;
    if (!canvas || !D) return null;
    var c = setupCanvas(canvas, opts.wideH, opts.narrowH), ctx = c.ctx, L = c.L;
    var M = D.moments, N = M.length;
    var st = { D: D, idx: 0, all: null, z: null, a: 0 };
    var acc = 0, playing = false, cache = {};
    var slider = document.getElementById(opts.ids.time);
    var playBtn = document.getElementById(opts.ids.play);
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      st.all = cache[st.idx] || (cache[st.idx] = forwardAll(D.model.layers, M[st.idx].obs));
      st.z = st.all[st.all.length - 1]; st.a = argmax(st.z);
      var b = opts.arena(L);
      drawPilotArena(ctx, D, b, st.idx, !!opts.small);
      opts.panel(ctx, L, b, st);
      if (opts.readout) opts.readout(st);
      if (slider && +slider.value !== st.idx) slider.value = st.idx;
    }
    function setPlaying(v) {
      playing = v;
      if (playBtn) playBtn.textContent = v ? 'Pause' : (st.idx >= N - 1 ? 'Replay' : 'Play');
      if (v) wake();
    }
    if (slider) {
      var first = +slider.value;      // a toy may open partway through the match
      slider.max = N - 1; slider.value = Math.min(first, N - 1); st.idx = +slider.value;
      slider.addEventListener('input', function () { st.idx = +slider.value; setPlaying(false); draw(); });
    }
    if (playBtn) playBtn.addEventListener('click', function () {
      if (!playing && st.idx >= N - 1) st.idx = 0;
      setPlaying(!playing); draw();
    });
    if (opts.tap) canvas.addEventListener('click', function (e) {
      if (opts.tap(pointerPos(canvas, L, e), L, opts.arena(L), st)) draw();
    });
    register({
      canvas: canvas, resize: c.resize, draw: draw,
      need: function () { return playing; },
      step: function (dt) {
        if (!playing) return;
        // half speed: fifteen decisions a second is too fast to read bars by
        acc += dt * D.match.hz * 0.5;
        while (acc >= 1) { acc -= 1; st.idx++; }
        if (st.idx >= N - 1) { st.idx = N - 1; setPlaying(false); }
      }
    });
    return { draw: draw, st: st };
  }
  function arenaLeft(w) {
    return function (L) {
      var D = window.PILOT_DATA, r = D.field.h / D.field.w;
      if (L.narrow) return { x: 12, y: 12, w: 456, h: 456 * r };
      return { x: 18, y: (L.H - w * r) / 2, w: w, h: w * r };
    };
  }

  /* lesson 2, toy 1: the twelve scores */
  (function scoresToy() {
    var shares = false, modeBtn = document.getElementById('pilot-mode');
    var toy = pilotToy({
      lab: 'pilot', wideH: 500, narrowH: 640, ids: { time: 'pilot-time', play: 'pilot-play' },
      arena: arenaLeft(566),
      panel: function (ctx, L, b, st) {
        var D = st.D, z = st.z, a = st.a, px, py, pw, rowH;
        if (L.narrow) { px = 12; py = b.y + b.h + 34; pw = 456; rowH = 26; }
        else { px = b.x + b.w + 26; py = 56; pw = L.W - px - 18; rowH = 36; }
        var p = softmax(z, 1), labW = 92, bx = px + labW, bw = pw - labW - 50;
        text(ctx, px, py - 16, shares ? 'TWELVE SHARES (SOFTMAX)' : 'TWELVE SCORES', INK, MONO_S);
        var lim = 0, i;
        for (i = 0; i < 12; i++) lim = Math.max(lim, Math.abs(z[i]));
        lim = Math.max(6, Math.ceil(lim));
        var zx = shares ? bx : bx + bw / 2;
        ctx.strokeStyle = LINE; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(zx, py - 4); ctx.lineTo(zx, py + rowH * 12 - 6); ctx.stroke();
        for (i = 0; i < 12; i++) {
          var y = py + rowH * i, bh = rowH - 10, t = D.actions[i], win = i === a;
          // the move as three glyphs: turn, engine, gun
          text(ctx, px, y + bh / 2 + 4.5, TURN[t[0]], win ? INK : MUTED, MONO);
          text(ctx, px + 20, y + bh / 2 + 4.5, t[1] ? 'burn' : '', win ? GOLD : 'rgba(255,200,135,0.6)', MONO_S);
          text(ctx, px + 54, y + bh / 2 + 4.5, t[2] ? 'fire' : '', win ? RUST : 'rgba(217,130,95,0.7)', MONO_S);
          var len = shares ? p[i] * bw : z[i] / lim * bw / 2;
          ctx.fillStyle = win ? CYAN : 'rgba(128,139,159,0.5)';
          rrect(ctx, zx, y, len, bh, 3); ctx.fill();
          // a negative bar's number sits in the empty half, right of the axis
          var tx = (shares || z[i] >= 0) ? zx + len + 8 : zx + 8;
          text(ctx, tx, y + bh / 2 + 4.5, shares ? pct(p[i]) : signed(z[i]), win ? INK : MUTED, MONO_S);
        }
      },
      readout: function (st) {
        var p = softmax(st.z, 1), s = st.z.slice().sort(function (u, v) { return v - u; });
        setText('pilot-move', moveWords(st.D, st.a));
        setText('pilot-lead', shares ? pct(p[st.a]) : (s[0] - s[1]).toFixed(1));
        setText('pilot-lead-k', shares ? 'TOP SHARE' : 'LEAD OVER SECOND');
      }
    });
    if (toy && modeBtn) modeBtn.addEventListener('click', function () {
      shares = !shares; modeBtn.textContent = shares ? 'Show scores' : 'Show shares'; toy.draw();
    });
  })();

  /* lesson 1, toy 1: the nineteen numbers going in */
  pilotToy({
    lab: 'senses', wideH: 520, narrowH: 730, ids: { time: 'senses-time', play: 'senses-play' },
    arena: arenaLeft(500),
    panel: function (ctx, L, b, st) {
      var x = st.all[0], px, py, pw, rowH, i;
      if (L.narrow) { px = 12; py = b.y + b.h + 34; pw = 456; rowH = 22; }
      else { px = b.x + b.w + 24; py = 34; pw = L.W - px - 16; rowH = 25; }
      var labW = L.narrow ? 196 : 200, bx = px + labW, bw = pw - labW - 46, zx = bx + bw / 2;
      text(ctx, px, py - 14, 'NINETEEN NUMBERS IN', INK, MONO_S);
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(zx, py - 2); ctx.lineTo(zx, py + rowH * 19 - 6); ctx.stroke();
      for (i = 0; i < 19; i++) {
        var y = py + rowH * i, bh = rowH - 9, v = x[i];
        text(ctx, px, y + bh / 2 + 4, SENSES[i], MUTED, MONO_S);
        ctx.fillStyle = v >= 0 ? CYAN : RUST;
        rrect(ctx, zx, y, Math.max(-1, Math.min(1, v / 1.5)) * bw / 2 || 0.5, bh, 3); ctx.fill();
        text(ctx, bx + bw + 6, y + bh / 2 + 4, (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), INK, MONO_S);
      }
    }
  });

  /* lesson 1, toy 4: every number in the net. Tap a cell to see what it reads. */
  (function brainToy() {
    var sel = { layer: 1, i: 0 }, cells = [];
    function layout(L, b) {
      // four columns: 19 inputs, 8x8, 8x8, 12 scores
      var g = {};
      if (L.narrow) { g.c = 17; g.top = b.y + b.h + 44; g.x0 = 14; g.gap = 34; }
      else { g.c = 21; g.top = 50; g.x0 = b.x + b.w + 30; g.gap = (L.W - g.x0 - 18 - 18 * g.c) / 3; }
      g.x = [g.x0, g.x0 + g.c + g.gap, g.x0 + 9 * g.c + 2 * g.gap, g.x0 + 17 * g.c + 3 * g.gap];
      return g;
    }
    function cellRect(g, layer, i) {
      var c = g.c;
      if (layer === 0) return { x: g.x[0], y: g.top + i * c, s: c - 2 };
      if (layer === 3) return { x: g.x[3], y: g.top + i * c * 1.55, s: c - 2 };
      return { x: g.x[layer] + (i % 8) * c, y: g.top + Math.floor(i / 8) * c + (19 * c - 8 * c) / 2, s: c - 2 };
    }
    pilotToy({
      lab: 'brain', wideH: 520, narrowH: 720, ids: { time: 'brain-time', play: 'brain-play' },
      small: true,
      arena: function (L) {
        var D = window.PILOT_DATA, r = D.field.h / D.field.w;
        if (L.narrow) return { x: 12, y: 12, w: 456, h: 456 * r };
        return { x: 18, y: 50, w: 372, h: 372 * r };
      },
      panel: function (ctx, L, b, st) {
        var g = layout(L, b), all = st.all, D = st.D, k, i, r;
        var names = ['19 IN', '64', '64', '12 OUT'], lims = [1.5, 1, 1, 8];
        cells = [];
        // the wires into the chosen cell: one per number it reads, colored
        // by the weight on it
        if (sel.layer > 0) {
          var w = D.model.layers[sel.layer - 1].w[sel.i], to = cellRect(g, sel.layer, sel.i), wmax = 0;
          for (i = 0; i < w.length; i++) wmax = Math.max(wmax, Math.abs(w[i]));
          for (i = 0; i < w.length; i++) {
            var fr = cellRect(g, sel.layer - 1, i);
            ctx.strokeStyle = signColor(w[i], wmax); ctx.lineWidth = 0.4 + 2.2 * Math.abs(w[i]) / wmax;
            ctx.beginPath(); ctx.moveTo(fr.x + fr.s, fr.y + fr.s / 2); ctx.lineTo(to.x, to.y + to.s / 2); ctx.stroke();
          }
        }
        for (k = 0; k < 4; k++) {
          text(ctx, g.x[k] + (k === 0 || k === 3 ? g.c / 2 - 1 : 4 * g.c - 1), g.top - 14, names[k], INK, MONO_S, 'center');
          for (i = 0; i < all[k].length; i++) {
            r = cellRect(g, k, i);
            ctx.fillStyle = '#0b1019'; rrect(ctx, r.x, r.y, r.s, r.s, 3); ctx.fill();
            ctx.fillStyle = signColor(all[k][i], lims[k]); rrect(ctx, r.x, r.y, r.s, r.s, 3); ctx.fill();
            if (k === sel.layer && i === sel.i) { ctx.strokeStyle = INK; ctx.lineWidth = 2; rrect(ctx, r.x - 1, r.y - 1, r.s + 2, r.s + 2, 4); ctx.stroke(); }
            if (k === 3 && i === st.a) { ctx.strokeStyle = GOLD; ctx.lineWidth = 2; rrect(ctx, r.x - 3, r.y - 3, r.s + 6, r.s + 6, 5); ctx.stroke(); }
            cells.push({ k: k, i: i, x: r.x, y: r.y, s: r.s });
          }
        }
        // what the chosen cell is doing, in words
        var tx = L.narrow ? 14 : 18, ty = L.narrow ? g.top + 19 * g.c + 22 : b.y + b.h + 40, lh = 19;
        var v = all[sel.layer][sel.i];
        if (sel.layer === 0) {
          text(ctx, tx, ty, 'INPUT ' + (sel.i + 1) + ' OF 19', INK, MONO_S);
          text(ctx, tx, ty + lh, SENSES[sel.i], MUTED, MONO_S);
          text(ctx, tx, ty + lh * 2, 'value ' + signed(v) + ', straight from the game', MUTED, MONO_S);
        } else {
          var lay = D.model.layers[sel.layer - 1], sum = lay.b[sel.i], src = all[sel.layer - 1];
          for (i = 0; i < src.length; i++) sum += lay.w[sel.i][i] * src[i];
          text(ctx, tx, ty, sel.layer === 3 ? 'SCORE ' + (sel.i + 1) + ' OF 12: ' + moveWords(D, sel.i).toUpperCase()
            : 'NEURON ' + (sel.i + 1) + ' OF 64, LAYER ' + sel.layer, INK, MONO_S);
          text(ctx, tx, ty + lh, src.length + ' weights × ' + src.length + ' numbers, added up', MUTED, MONO_S);
          text(ctx, tx, ty + lh * 2, 'plus its bias = ' + signed(sum), MUTED, MONO_S);
          text(ctx, tx, ty + lh * 3, sel.layer === 3 ? 'no squash on the last layer' : 'squashed by tanh = ' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), CYAN, MONO_S);
        }
      },
      tap: function (p) {
        for (var n = 0; n < cells.length; n++) {
          var q = cells[n];
          if (p.x >= q.x - 1 && p.x <= q.x + q.s + 1 && p.y >= q.y - 1 && p.y <= q.y + q.s + 1) { sel = { layer: q.k, i: q.i }; return true; }
        }
        return false;
      },
      readout: function (st) { setText('brain-move', moveWords(st.D, st.a)); }
    });
  })();

  /* ---------- toy 2: grow, then share ---------- */
  var NAMES = ['basil', 'mint', 'rosemary', 'thyme', 'sage'];

  (function grow() {
    var canvas = document.querySelector('canvas[data-lab="softmax"]');
    if (!canvas) return;
    var c = setupCanvas(canvas, 470, 430), ctx = c.ctx, L = c.L;
    var START = [2.0, 1.0, 0.0, -1.0, -2.0];
    var scores = START.slice();
    function cols() {
      // label | score (draggable) | grown e^s | share
      var W = L.W, pad = L.narrow ? 10 : 24;
      var lab = L.narrow ? 70 : 118, gap = L.narrow ? 14 : 34;
      var rest = W - pad * 2 - lab - gap * 2;
      var sw = rest * 0.42, gw = rest * 0.25, hw = rest * 0.33;
      return { pad: pad, lab: lab, sx: pad + lab, sw: sw, gx: pad + lab + sw + gap, gw: gw,
               hx: pad + lab + sw + gap + gw + gap, hw: hw, top: 74, rowH: (L.H - 74 - 14) / 5 };
    }
    var col = new ScoreColumn({
      scores: scores, lo: -4, hi: 6,
      geom: function () { var k = cols(); return { x: k.sx + 30, w: k.sw - 60, top: k.top, rowH: k.rowH }; },
      onChange: function () { draw(); }
    });
    col.bind(canvas, L);
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var k = cols(), p = softmax(scores, 1), i, e = [], emax = 0;
      for (i = 0; i < 5; i++) { e[i] = Math.exp(scores[i]); emax = Math.max(emax, e[i]); }
      text(ctx, k.sx, 30, '1  SCORE', INK, MONO_S);
      text(ctx, k.sx, 48, 'drag me', MUTED, MONO_S);
      text(ctx, k.gx, 30, '2  GROW', INK, MONO_S);
      text(ctx, k.gx, 48, L.narrow ? 'e^score' : 'e to the score', MUTED, MONO_S);
      text(ctx, k.hx, 30, '3  SHARE', INK, MONO_S);
      text(ctx, k.hx, 48, L.narrow ? '÷ total' : 'divide by the total', MUTED, MONO_S);
      col.draw(ctx, PALETTE);
      for (i = 0; i < 5; i++) {
        var y = k.top + k.rowH * i, bh = Math.min(30, k.rowH - 22), mid = y + bh / 2 + 4.5;
        text(ctx, k.pad, mid, NAMES[i], PALETTE[i], MONO);
        // grown: bars against the tallest, the number is the truth
        ctx.globalAlpha = 0.55; ctx.fillStyle = PALETTE[i];
        rrect(ctx, k.gx, y, Math.max(2, (k.gw - 54) * e[i] / emax), bh, 4); ctx.fill(); ctx.globalAlpha = 1;
        text(ctx, k.gx + Math.max(2, (k.gw - 54) * e[i] / emax) + 8, mid,
          e[i] >= 100 ? e[i].toFixed(0) : e[i] >= 10 ? e[i].toFixed(1) : e[i].toFixed(2), MUTED, MONO_S);
        // share
        ctx.fillStyle = 'rgba(128,139,159,0.13)'; rrect(ctx, k.hx, y, k.hw - 52, bh, 4); ctx.fill();
        ctx.fillStyle = PALETTE[i]; rrect(ctx, k.hx, y, Math.max(2, (k.hw - 52) * p[i]), bh, 4); ctx.fill();
        text(ctx, k.hx + k.hw - 44, mid, pct(p[i]), INK, MONO);
      }
      var s = scores.slice().sort(function (u, v) { return v - u; });
      setText('sm-lead', (s[0] - s[1]).toFixed(1));
      var odds = Math.exp(s[0] - s[1]);
      setText('sm-odds', (odds >= 100 ? odds.toFixed(0) : odds.toFixed(1)) + ' to 1');
    }
    on('sm-plus', function () { for (var i = 0; i < 5; i++) scores[i] = Math.min(6, Math.round((scores[i] + 1) * 10) / 10); draw(); });
    on('sm-minus', function () { for (var i = 0; i < 5; i++) scores[i] = Math.max(-4, Math.round((scores[i] - 1) * 10) / 10); draw(); });
    on('sm-reset', function () { for (var i = 0; i < 5; i++) scores[i] = START[i]; draw(); });
    register({ canvas: canvas, resize: c.resize, draw: draw, step: function () {}, need: function () { return false; } });
  })();

  /* ---------- toy 3: temperature, and a hundred draws ---------- */
  (function temperature() {
    var canvas = document.querySelector('canvas[data-lab="temp"]');
    if (!canvas) return;
    var c = setupCanvas(canvas, 430, 430), ctx = c.ctx, L = c.L;
    var scores = [2.0, 1.0, 0.0, -1.0, -2.0];
    var slider = document.getElementById('temp-t');
    var T = 1, tally = [0, 0, 0, 0, 0], drawn = 0, pending = 0, acc = 0, seed = 7;
    function rnd() { // mulberry32: the same hundred draws every visit
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function readT() {
      // the slider is logarithmic: its middle is T = 1
      T = slider ? Math.pow(10, +slider.value) : 1;
      setText('temp-read', T < 1 ? T.toFixed(2) : T.toFixed(1));
    }
    function one() {
      var p = softmax(scores, T), u = rnd(), i = 0, s = p[0];
      while (u > s && i < 4) { i++; s += p[i]; }
      tally[i]++; drawn++;
    }
    function clear() { tally = [0, 0, 0, 0, 0]; drawn = 0; pending = 0; }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var p = softmax(scores, T), pad = L.narrow ? 10 : 24, lab = L.narrow ? 70 : 118;
      var top = 74, rowH = (L.H - top - 14) / 5, i, j;
      var hx = pad + lab + (L.narrow ? 44 : 60), hw = L.narrow ? 120 : 250;
      var dx = hx + hw + (L.narrow ? 54 : 78), dw = L.W - dx - pad;
      text(ctx, pad + lab, 30, 'SCORE', INK, MONO_S);
      text(ctx, hx, 30, 'SHARE AT T = ' + (T < 1 ? T.toFixed(2) : T.toFixed(1)), INK, MONO_S);
      text(ctx, hx, 48, 'score ÷ T, then softmax', MUTED, MONO_S);
      text(ctx, dx, 30, drawn ? drawn + ' DRAWS' : 'DRAWS', INK, MONO_S);
      text(ctx, dx, 48, 'one dot each', MUTED, MONO_S);
      var per = L.narrow ? 13 : 25, dot = Math.min(4.2, dw / per / 2 - 1);
      for (i = 0; i < 5; i++) {
        var y = top + rowH * i, bh = Math.min(30, rowH - 22), mid = y + bh / 2 + 4.5;
        text(ctx, pad, mid, NAMES[i], PALETTE[i], MONO);
        text(ctx, pad + lab, mid, signed(scores[i]), MUTED, MONO);
        ctx.fillStyle = 'rgba(128,139,159,0.13)'; rrect(ctx, hx, y, hw, bh, 4); ctx.fill();
        ctx.fillStyle = PALETTE[i]; rrect(ctx, hx, y, Math.max(2, hw * p[i]), bh, 4); ctx.fill();
        text(ctx, hx + hw + 8, mid, pct(p[i]), INK, MONO);
        ctx.fillStyle = PALETTE[i];
        for (j = 0; j < tally[i]; j++) {
          var cx = dx + (j % per) * (dw / per) + dot, cy = y + 4 + Math.floor(j / per) * (dot * 2 + 3);
          ctx.beginPath(); ctx.arc(cx, cy, dot, 0, TAU); ctx.fill();
        }
      }
    }
    if (slider) slider.addEventListener('input', function () { readT(); clear(); draw(); });
    on('temp-draw', function () {
      clear(); seed = 7; pending = 100;
      if (reduce) { while (pending-- > 0) one(); pending = 0; draw(); } else wake();
    });
    on('temp-clear', function () { clear(); draw(); });
    readT();
    register({
      canvas: canvas, resize: c.resize, draw: draw,
      need: function () { return pending > 0; },
      step: function (dt) {
        if (pending <= 0) return;
        acc += dt * 60;
        while (acc >= 1 && pending > 0) { acc -= 1; one(); pending--; }
      }
    });
  })();

  /* ---------- toy 4: surprise, and the nudge that fixes it ---------- */
  (function surprise() {
    var canvas = document.querySelector('canvas[data-lab="surprise"]');
    if (!canvas) return;
    var c = setupCanvas(canvas, 470, 690), ctx = c.ctx, L = c.L;
    var START = [-1.0, 0.5, 3.0, 0.0, -0.5];   // confident, and wrong about basil
    var scores = START.slice(), truth = 0, steps = 0, auto = 0, acc = 0;
    var RATE = 0.5;
    function geo() {
      var pad = L.narrow ? 10 : 24, lab = L.narrow ? 78 : 126;
      var left = L.narrow ? L.W : 590, top = 74, rowsH = L.narrow ? 330 : L.H - top - 14;
      var gap = L.narrow ? 12 : 28, rest = left - pad * 2 - lab - gap;
      return { pad: pad, lab: lab, top: top, rowH: rowsH / 5, sx: pad + lab, sw: rest * 0.6,
               hx: pad + lab + rest * 0.6 + gap, hw: rest * 0.4,
               plot: L.narrow ? { x: 46, y: top + rowsH + 44, w: L.W - 46 - 16, h: L.H - (top + rowsH + 44) - 40 }
                              : { x: 650, y: 78, w: L.W - 650 - 22, h: L.H - 78 - 46 } };
    }
    var col = new ScoreColumn({
      scores: scores, lo: -4, hi: 6,
      geom: function () { var g = geo(); return { x: g.sx + 30, w: g.sw - 60, top: g.top, rowH: g.rowH }; },
      onChange: function () { draw(); }
    });
    col.bind(canvas, L);
    // click a name to move the truth
    canvas.addEventListener('pointerdown', function (e) {
      var p = pointerPos(canvas, L, e), g = geo();
      var i = Math.floor((p.y - g.top) / g.rowH);
      if (p.x < g.sx - 4 && i >= 0 && i < 5) { truth = i; steps = 0; draw(); }
    });
    function learn() {
      // the whole of softmax cross-entropy's gradient: share minus truth
      var p = softmax(scores, 1);
      for (var i = 0; i < 5; i++) {
        var s = scores[i] - RATE * (p[i] - (i === truth ? 1 : 0));
        scores[i] = Math.max(-4, Math.min(6, s));
      }
      steps++;
    }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var g = geo(), p = softmax(scores, 1), i;
      var loss = -Math.log(Math.max(p[truth], 1e-12));
      text(ctx, g.pad, 30, 'TRUTH', INK, MONO_S);
      text(ctx, g.pad, 48, L.narrow ? 'tap a name' : 'click a name', MUTED, MONO_S);
      text(ctx, g.sx, 30, 'SCORE', INK, MONO_S);
      text(ctx, g.sx, 48, L.narrow ? 'arrow = next nudge' : 'arrow = the next nudge', MUTED, MONO_S);
      text(ctx, g.hx, 30, 'SHARE', INK, MONO_S);
      col.draw(ctx, PALETTE);
      var cg = { x: g.sx + 30, w: g.sw - 60 };
      for (i = 0; i < 5; i++) {
        var y = g.top + g.rowH * i, bh = Math.min(30, g.rowH - 22), mid = y + bh / 2 + 4.5;
        var isT = i === truth;
        if (isT) {
          ctx.fillStyle = 'rgba(53,224,213,0.07)';
          rrect(ctx, 4, y - 12, (L.narrow ? L.W : 606) - 8, bh + 24, 8); ctx.fill();
        }
        text(ctx, g.pad, mid, (isT ? '★ ' : '  ') + NAMES[i], isT ? INK : PALETTE[i], MONO);
        // the nudge: truth minus share, drawn under the bar from its tip
        var nud = (isT ? 1 : 0) - p[i];
        if (Math.abs(nud) > 0.004) {
          var x0 = cg.x + cg.w * (scores[i] + 4) / 10, len = nud * 70, ay = y + bh + 9;
          ctx.strokeStyle = nud > 0 ? CYAN : RUST; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x0 + len, ay); ctx.stroke();
          var d = nud > 0 ? 1 : -1;
          ctx.beginPath(); ctx.moveTo(x0 + len + d * 6, ay); ctx.lineTo(x0 + len, ay - 4); ctx.lineTo(x0 + len, ay + 4); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = 'rgba(128,139,159,0.13)'; rrect(ctx, g.hx, y, g.hw - 52, bh, 4); ctx.fill();
        ctx.fillStyle = PALETTE[i]; rrect(ctx, g.hx, y, Math.max(2, (g.hw - 52) * p[i]), bh, 4); ctx.fill();
        text(ctx, g.hx + g.hw - 44, mid, pct(p[i]), isT ? INK : MUTED, MONO);
      }
      // the curve: surprise = -ln(share given to the truth)
      var P = g.plot, ymax = 5;
      function PX(q) { return P.x + P.w * q; }
      function PY(v) { return P.y + P.h * (1 - Math.min(v, ymax) / ymax); }
      text(ctx, P.x, P.y - 22, 'SURPRISE', INK, MONO_S);
      text(ctx, P.x + P.w, P.y - 22, '−ln(share on the truth)', MUTED, MONO_S, 'right');
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x, P.y + P.h); ctx.lineTo(P.x + P.w, P.y + P.h); ctx.stroke();
      for (i = 0; i <= ymax; i++) text(ctx, P.x - 8, PY(i) + 4, String(i), MUTED, MONO_S, 'right');
      text(ctx, PX(0), P.y + P.h + 18, '0%', MUTED, MONO_S);
      text(ctx, PX(0.5), P.y + P.h + 18, '50%', MUTED, MONO_S, 'center');
      text(ctx, PX(1), P.y + P.h + 18, '100%', MUTED, MONO_S, 'right');
      text(ctx, PX(0.5), P.y + P.h + 36, 'share on ' + NAMES[truth], PALETTE[truth], MONO_S, 'center');
      ctx.beginPath();
      for (i = 0; i <= 200; i++) {
        var q = Math.max(i / 200, 0.0045), v = -Math.log(q);
        if (i === 0) ctx.moveTo(PX(q), PY(v)); else ctx.lineTo(PX(q), PY(v));
      }
      ctx.strokeStyle = 'rgba(238,244,255,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      var qx = PX(Math.max(p[truth], 0.0045)), qy = PY(loss);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(53,224,213,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(qx, P.y + P.h); ctx.lineTo(qx, qy); ctx.lineTo(P.x, qy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(qx, qy, 7, 0, TAU); ctx.fillStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
      setText('sp-loss', loss.toFixed(2));
      setText('sp-share', pct(p[truth]));
      setText('sp-steps', String(steps));
    }
    on('sp-step', function () { auto = 0; learn(); draw(); });
    on('sp-run', function () { auto = 30; if (reduce) { while (auto-- > 0) learn(); auto = 0; draw(); } else wake(); });
    on('sp-reset', function () { for (var i = 0; i < 5; i++) scores[i] = START[i]; truth = 0; steps = 0; auto = 0; draw(); });
    register({
      canvas: canvas, resize: c.resize, draw: draw,
      need: function () { return auto > 0; },
      step: function (dt) {
        if (auto <= 0) return;
        acc += dt * 10;
        while (acc >= 1 && auto > 0) { acc -= 1; learn(); auto--; }
      }
    });
  })();
  /* ---------- lesson 1, toy 2: the dot product ----------
     Two arrows from the origin; drag either tip. The panel spells out the
     arithmetic (multiply the pairs, add) and the picture shows the same
     number as geometry: b's shadow on a, times a's length. */
  (function dot() {
    var canvas = document.querySelector('canvas[data-lab="dot"]');
    if (!canvas) return;
    var c = setupCanvas(canvas, 500, 680), ctx = c.ctx, L = c.L;
    var A = { x: 3, y: 1 }, B = { x: 2, y: 2 }, drag = null, R = 4.5;
    function box() { return L.narrow ? { x: 12, y: 12, s: 456 } : { x: 18, y: 14, s: 472 }; }
    function PX(b, v) { return b.x + b.s / 2 + v * b.s / (2 * R); }
    function PY(b, v) { return b.y + b.s / 2 - v * b.s / (2 * R); }
    function arrow(b, v, color, name) {
      var x0 = PX(b, 0), y0 = PY(b, 0), x1 = PX(b, v.x), y1 = PY(b, v.y);
      var ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(ang) * 8, y1 - Math.sin(ang) * 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(ang - 0.42) * 15, y1 - Math.sin(ang - 0.42) * 15);
      ctx.lineTo(x1 - Math.cos(ang + 0.42) * 15, y1 - Math.sin(ang + 0.42) * 15); ctx.closePath(); ctx.fill();
      // the grip
      ctx.beginPath(); ctx.arc(x1, y1, 13, 0, TAU); ctx.strokeStyle = color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      var lr = v.x > 1.5;   // keep the label inside the grid
      text(ctx, x1 + (lr ? -16 : 16), y1 - 14, name + ' = (' + v.x.toFixed(1) + ', ' + v.y.toFixed(1) + ')', color, MONO, lr ? 'right' : 'left');
    }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var b = box(), i, d = A.x * B.x + A.y * B.y;
      ctx.fillStyle = '#03050a'; rrect(ctx, b.x, b.y, b.s, b.s, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(34,44,61,0.7)'; ctx.lineWidth = 1;
      for (i = -4; i <= 4; i++) {
        ctx.globalAlpha = i === 0 ? 1 : 0.45;
        ctx.beginPath(); ctx.moveTo(PX(b, i), b.y + 6); ctx.lineTo(PX(b, i), b.y + b.s - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x + 6, PY(b, i)); ctx.lineTo(b.x + b.s - 6, PY(b, i)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // b's shadow on a
      var la = Math.sqrt(A.x * A.x + A.y * A.y), lb = Math.sqrt(B.x * B.x + B.y * B.y);
      if (la > 0.05) {
        var t = d / (la * la), sx = A.x * t, sy = A.y * t;
        ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(238,244,255,0.4)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(PX(b, B.x), PY(b, B.y)); ctx.lineTo(PX(b, sx), PY(b, sy)); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = d >= 0 ? 'rgba(53,224,213,0.55)' : 'rgba(217,130,95,0.7)'; ctx.lineWidth = 9; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(PX(b, 0), PY(b, 0)); ctx.lineTo(PX(b, sx), PY(b, sy)); ctx.stroke();
      }
      arrow(b, A, GOLD, 'a'); arrow(b, B, VIOLET, 'b');
      // the arithmetic
      var px = L.narrow ? 16 : b.x + b.s + 34, py = L.narrow ? b.y + b.s + 34 : 70, lh = 30;
      var BIG = '600 17px ui-monospace, "SF Mono", Menlo, monospace';
      text(ctx, px, py, 'MULTIPLY THE PAIRS', INK, MONO_S);
      text(ctx, px, py + lh, A.x.toFixed(1) + ' × ' + B.x.toFixed(1) + ' = ' + signed(A.x * B.x), MUTED, BIG);
      text(ctx, px, py + lh * 2, A.y.toFixed(1) + ' × ' + B.y.toFixed(1) + ' = ' + signed(A.y * B.y), MUTED, BIG);
      text(ctx, px, py + lh * 3 + 8, 'ADD THEM UP', INK, MONO_S);
      text(ctx, px, py + lh * 4 + 10, 'a · b = ' + signed(d), d >= 0 ? CYAN : RUST, '600 24px ui-monospace, "SF Mono", Menlo, monospace');
      // a meter for the result
      var mx = px, mw = L.narrow ? L.W - 32 : L.W - px - 26, my = py + lh * 5 + 14, mid = mx + mw / 2;
      ctx.fillStyle = 'rgba(128,139,159,0.13)'; rrect(ctx, mx, my, mw, 16, 4); ctx.fill();
      ctx.fillStyle = d >= 0 ? CYAN : RUST; rrect(ctx, mid, my, Math.max(-1, Math.min(1, d / 20)) * mw / 2, 16, 4); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mid, my - 4); ctx.lineTo(mid, my + 20); ctx.stroke();
      text(ctx, mx, my + 36, 'pulling apart', RUST, MONO_S);
      text(ctx, mx + mw, my + 36, 'pulling together', CYAN, MONO_S, 'right');
      var ang = (la > 0.05 && lb > 0.05) ? Math.acos(Math.max(-1, Math.min(1, d / (la * lb)))) * 180 / Math.PI : 0;
      setText('dot-read', signed(d));
      setText('dot-angle', ang.toFixed(0) + '°');
    }
    function tipHit(p, v) { var b = box(); return Math.hypot(p.x - PX(b, v.x), p.y - PY(b, v.y)) < 30; }
    canvas.addEventListener('pointerdown', function (e) {
      var p = pointerPos(canvas, L, e);
      drag = tipHit(p, B) ? B : tipHit(p, A) ? A : null;
      if (drag) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } }
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = pointerPos(canvas, L, e), b = box();
      if (!drag) { canvas.style.cursor = (tipHit(p, A) || tipHit(p, B)) ? 'grab' : ''; return; }
      var x = (p.x - b.x - b.s / 2) * 2 * R / b.s, y = -(p.y - b.y - b.s / 2) * 2 * R / b.s;
      drag.x = Math.max(-4, Math.min(4, Math.round(x * 2) / 2));
      drag.y = Math.max(-4, Math.min(4, Math.round(y * 2) / 2));
      draw();
    });
    function up() { drag = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    function preset(ax, ay, bx, by) { return function () { A.x = ax; A.y = ay; B.x = bx; B.y = by; draw(); }; }
    on('dot-same', preset(3, 1, 3, 1));
    on('dot-square', preset(3, 1, -1, 3));
    on('dot-opp', preset(3, 1, -3, -1));
    register({ canvas: canvas, resize: c.resize, draw: draw, step: function () {}, need: function () { return false; } });
  })();

  /* ---------- lesson 1, toy 3: one neuron ----------
     The dot-product toy again, with an opinion added. The gold arrow is the
     weights and the violet dot is the input; drag either. The neuron takes
     their dot product, adds the bias, and squashes. The plane is shaded by
     what it would say about every possible input, and the white fence is
     where the sum is exactly zero. Numbered axes, so zero is findable. */
  (function neuron() {
    var canvas = document.querySelector('canvas[data-lab="neuron"]');
    if (!canvas) return;
    var c = setupCanvas(canvas, 500, 730), ctx = c.ctx, L = c.L;
    var START = { w1: 1, w2: 1, b: 0, x1: 2, x2: -1 };
    function num(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(1); }
    var W = { x: START.w1, y: START.w2 }, X = { x: START.x1, y: START.x2 }, bias = START.b, drag = null, R = 4.5;
    var slider = document.getElementById('nr-b'), s1 = document.getElementById('nr-w1'), s2 = document.getElementById('nr-w2');
    function box() { return L.narrow ? { x: 12, y: 12, s: 456 } : { x: 18, y: 14, s: 472 }; }
    function PX(b, v) { return b.x + b.s / 2 + v * b.s / (2 * R); }
    function PY(b, v) { return b.y + b.s / 2 - v * b.s / (2 * R); }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var b = box(), n = 36, cs = b.s / n, i, j;
      ctx.save(); rrect(ctx, b.x, b.y, b.s, b.s, 8); ctx.clip();
      ctx.fillStyle = '#03050a'; ctx.fillRect(b.x, b.y, b.s, b.s);
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
        var gx0 = -R + (i + 0.5) * 2 * R / n, gy0 = R - (j + 0.5) * 2 * R / n;
        var o = Math.tanh(W.x * gx0 + W.y * gy0 + bias);
        ctx.fillStyle = (o >= 0 ? 'rgba(53,224,213,' : 'rgba(217,130,95,') + (Math.abs(o) * 0.42).toFixed(3) + ')';
        ctx.fillRect(b.x + i * cs, b.y + j * cs, cs + 0.5, cs + 0.5);
      }
      // a numbered grid: zero is the crossing of the two bright lines
      for (i = -4; i <= 4; i++) {
        ctx.strokeStyle = i === 0 ? 'rgba(238,244,255,0.55)' : 'rgba(238,244,255,0.10)'; ctx.lineWidth = i === 0 ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(PX(b, i), b.y); ctx.lineTo(PX(b, i), b.y + b.s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, PY(b, i)); ctx.lineTo(b.x + b.s, PY(b, i)); ctx.stroke();
        if (i !== 0) {
          text(ctx, PX(b, i), PY(b, 0) + 15, String(i).replace('-', '−'), 'rgba(238,244,255,0.6)', MONO_S, 'center');
          text(ctx, PX(b, 0) - 7, PY(b, i) + 4, String(i).replace('-', '−'), 'rgba(238,244,255,0.6)', MONO_S, 'right');
        }
      }
      text(ctx, PX(b, 0) - 7, PY(b, 0) + 15, '0', INK, MONO_S, 'right');
      text(ctx, b.x + b.s - 10, PY(b, 0) - 8, 'x1', INK, MONO_S, 'right');
      text(ctx, PX(b, 0) + 8, b.y + 18, 'x2', INK, MONO_S);
      // the fence: every input whose sum is exactly zero
      var wl = Math.hypot(W.x, W.y);
      if (wl > 0.02) {
        var ox = -bias * W.x / (wl * wl), oy = -bias * W.y / (wl * wl), tx = -W.y / wl, ty = W.x / wl;
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(PX(b, ox - tx * 12), PY(b, oy - ty * 12)); ctx.lineTo(PX(b, ox + tx * 12), PY(b, oy + ty * 12)); ctx.stroke();
        // name the two sides, a little way off the fence
        var sx = PX(b, ox + W.x / wl * 1.5 + tx * 2.2), sy = PY(b, oy + W.y / wl * 1.5 + ty * 2.2);
        var nx2 = PX(b, ox - W.x / wl * 1.5 + tx * 2.2), ny2 = PY(b, oy - W.y / wl * 1.5 + ty * 2.2);
        function clampX(v) { return Math.max(b.x + 40, Math.min(b.x + b.s - 40, v)); }
        function clampY(v) { return Math.max(b.y + 38, Math.min(b.y + b.s - 14, v)); }
        text(ctx, clampX(sx), clampY(sy), 'YES', CYAN, MONO, 'center');
        text(ctx, clampX(nx2), clampY(ny2), 'NO', RUST, MONO, 'center');
      }
      // the weights, an arrow from zero: drag its tip
      var x0 = PX(b, 0), y0 = PY(b, 0), x1 = PX(b, W.x), y1 = PY(b, W.y), an = Math.atan2(y1 - y0, x1 - x0);
      ctx.strokeStyle = GOLD; ctx.fillStyle = GOLD; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      if (wl > 0.2) {
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(an) * 8, y1 - Math.sin(an) * 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(an - 0.42) * 15, y1 - Math.sin(an - 0.42) * 15);
        ctx.lineTo(x1 - Math.cos(an + 0.42) * 15, y1 - Math.sin(an + 0.42) * 15); ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x1, y1, 14, 0, TAU); ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      var wr = W.x > 1.5;
      text(ctx, x1 + (wr ? -18 : 18), y1 - 14, 'weights (' + num(W.x) + ', ' + num(W.y) + ')', GOLD, MONO, wr ? 'right' : 'left');
      // the input: drag it
      var ix = PX(b, X.x), iy = PY(b, X.y);
      ctx.beginPath(); ctx.arc(ix, iy, 8, 0, TAU); ctx.fillStyle = VIOLET; ctx.fill();
      ctx.beginPath(); ctx.arc(ix, iy, 14, 0, TAU); ctx.strokeStyle = VIOLET; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      var xr = X.x > 1.5;
      text(ctx, ix + (xr ? -18 : 18), iy + 28, 'input (' + num(X.x) + ', ' + num(X.y) + ')', '#c9b3ff', MONO, xr ? 'right' : 'left');
      ctx.restore();

      // the arithmetic: the dot product from the last toy, plus a bias
      var d = W.x * X.x + W.y * X.y, s = d + bias, out = Math.tanh(s);
      var px = L.narrow ? 16 : b.x + b.s + 34, py = L.narrow ? b.y + b.s + 30 : 40, lh = 24;
      var pw = L.narrow ? L.W - 32 : L.W - px - 26;
      var BIG = '600 15px ui-monospace, "SF Mono", Menlo, monospace';
      text(ctx, px, py, 'WEIGHTS · INPUT', INK, MONO_S);
      text(ctx, px, py + lh, num(W.x) + ' × ' + num(X.x) + '  +  ' + num(W.y) + ' × ' + num(X.y) + '  =  ' + signed(d), MUTED, BIG);
      text(ctx, px, py + lh * 2 + 4, 'PLUS THE BIAS', INK, MONO_S);
      text(ctx, px, py + lh * 3 + 4, signed(d) + '  ' + (bias >= 0 ? '+' : '−') + '  ' + Math.abs(bias).toFixed(1) + '  =  ' + signed(s), INK, BIG);
      // tanh, with its own zero marked
      var gx = px + 30, gy = py + lh * 4 + 34, gw = pw - 34, gh = L.narrow ? 130 : 200;
      text(ctx, px, gy - 12, 'THEN SQUASH (TANH)', INK, MONO_S);
      function GX(v) { return gx + gw / 2 + Math.max(-6, Math.min(6, v)) / 6 * gw / 2; }
      function GY(v) { return gy + gh / 2 - v * (gh / 2 - 10); }
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, GY(0)); ctx.lineTo(gx + gw, GY(0)); ctx.moveTo(GX(0), gy + 2); ctx.lineTo(GX(0), gy + gh - 2); ctx.stroke();
      ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.moveTo(gx, GY(1)); ctx.lineTo(gx + gw, GY(1)); ctx.moveTo(gx, GY(-1)); ctx.lineTo(gx + gw, GY(-1)); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, gx - 6, GY(1) + 4, '+1', MUTED, MONO_S, 'right'); text(ctx, gx - 6, GY(0) + 4, '0', MUTED, MONO_S, 'right'); text(ctx, gx - 6, GY(-1) + 4, '−1', MUTED, MONO_S, 'right');
      for (i = -6; i <= 6; i += 3) text(ctx, GX(i), gy + gh + 14, String(i).replace('-', '−'), MUTED, MONO_S, 'center');
      text(ctx, gx + gw, gy + gh + 30, 'the sum', MUTED, MONO_S, 'right');
      ctx.beginPath();
      for (i = 0; i <= 120; i++) { var v = -6 + i / 10; if (i === 0) ctx.moveTo(GX(v), GY(Math.tanh(v))); else ctx.lineTo(GX(v), GY(Math.tanh(v))); }
      ctx.strokeStyle = 'rgba(238,244,255,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(238,244,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(GX(s), GY(0)); ctx.lineTo(GX(s), GY(out)); ctx.lineTo(gx, GY(out)); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(GX(s), GY(out), 7, 0, TAU); ctx.fillStyle = out >= 0 ? CYAN : RUST;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
      var word = Math.abs(out) < 0.3 ? 'on the fence' : out > 0 ? (out > 0.9 ? 'a firm yes' : 'leaning yes') : (out < -0.9 ? 'a firm no' : 'leaning no');
      text(ctx, px, gy + gh + 54, 'out = ' + (out >= 0 ? '+' : '−') + Math.abs(out).toFixed(2), out >= 0 ? CYAN : RUST, '600 22px ui-monospace, "SF Mono", Menlo, monospace');
      text(ctx, px + 170, gy + gh + 53, word, MUTED, MONO);
      setText('nr-b-read', signed(bias)); setText('nr-w1-read', signed(W.x)); setText('nr-w2-read', signed(W.y));
      if (slider && +slider.value !== bias) slider.value = bias;
      if (s1 && +s1.value !== W.x) s1.value = W.x;
      if (s2 && +s2.value !== W.y) s2.value = W.y;
    }
    function hit(p, v) { var b = box(); return Math.hypot(p.x - PX(b, v.x), p.y - PY(b, v.y)) < 30; }
    canvas.addEventListener('pointerdown', function (e) {
      var p = pointerPos(canvas, L, e);
      drag = hit(p, X) ? X : hit(p, W) ? W : null;
      if (drag) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } }
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = pointerPos(canvas, L, e), b = box();
      if (!drag) { canvas.style.cursor = (hit(p, X) || hit(p, W)) ? 'grab' : ''; return; }
      var x = (p.x - b.x - b.s / 2) * 2 * R / b.s, y = -(p.y - b.y - b.s / 2) * 2 * R / b.s;
      drag.x = Math.max(-4, Math.min(4, Math.round(x * 2) / 2));
      drag.y = Math.max(-4, Math.min(4, Math.round(y * 2) / 2));
      draw();
    });
    function up() { drag = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    if (slider) slider.addEventListener('input', function () { bias = +slider.value; draw(); });
    // the two weights have sliders too: the same numbers the gold arrow sets
    if (s1) s1.addEventListener('input', function () { W.x = +s1.value; draw(); });
    if (s2) s2.addEventListener('input', function () { W.y = +s2.value; draw(); });
    function set(w1, w2, bb, x1, x2) { return function () { W.x = w1; W.y = w2; bias = bb; if (x1 !== undefined) { X.x = x1; X.y = x2; } draw(); }; }
    on('nr-reset', set(START.w1, START.w2, START.b, START.x1, START.x2));
    on('nr-onfence', function () { X.x = 1; X.y = -1; W.x = 1; W.y = 1; bias = 0; draw(); });
    on('nr-sharp', function () { var k = Math.max(Math.abs(W.x), Math.abs(W.y)) || 1; var f = 4 / k; W.x = Math.round(W.x * f * 2) / 2; W.y = Math.round(W.y * f * 2) / 2; draw(); });
    on('nr-soft', function () { var k = Math.max(Math.abs(W.x), Math.abs(W.y)) || 1; var f = 0.5 / k; W.x = Math.round(W.x * f * 2) / 2; W.y = Math.round(W.y * f * 2) / 2; draw(); });
    on('nr-b0', function () { bias = 0; draw(); });
    register({ canvas: canvas, resize: c.resize, draw: draw, step: function () {}, need: function () { return false; } });
  })();

  /* ---------- lesson 0: rosemary or lavender ----------
     HERBS_DATA (assets/learn/herbs-data.js, generated by
     scripts/learn/export-herbs.py): 63 real photos, each with the two
     numbers the owl's features vary most along, and which herb it is. */
  var HERB_COL = [CYAN, VIOLET];
  function herbSrc(i) { return '../../assets/learn/herbs/' + (i < 10 ? '0' : '') + i + '.jpg'; }

  /* toy 1: you, against ten photos. Plain DOM: an image and two buttons. */
  (function quiz() {
    var root = document.getElementById('herb-quiz'), H = window.HERBS_DATA;
    if (!root || !H) return;
    var img = root.querySelector('img'), note = document.getElementById('quiz-note');
    var btns = [document.getElementById('quiz-0'), document.getElementById('quiz-1')];
    var order = [], n = 0, right = 0, locked = false;
    // five of each, in a fixed shuffle
    (function () {
      var got = [0, 0], i;
      for (i = 0; i < H.pts.length && order.length < 10; i++) if (got[H.pts[i][2]] < 5) { got[H.pts[i][2]]++; order.push(i); }
    })();
    function show() {
      if (n >= order.length) {
        note.textContent = 'You named ' + right + ' of 10. Now say how you knew.';
        btns[0].disabled = btns[1].disabled = true; setText('quiz-again', 'Again'); return;
      }
      img.src = herbSrc(order[n]); img.alt = 'A photo of rosemary or lavender, number ' + (n + 1) + ' of 10';
      note.textContent = 'Photo ' + (n + 1) + ' of 10';
      locked = false;
    }
    function answer(k) {
      if (locked || n >= order.length) return;
      locked = true;
      var truth = H.pts[order[n]][2], ok = k === truth;
      if (ok) right++;
      note.textContent = (ok ? 'Yes, ' : 'No, ') + H.names[truth] + '.';
      note.style.color = ok ? CYAN : RUST;
      setText('quiz-score', right + ' of ' + (n + 1));
      n++;
      setTimeout(function () { note.style.color = ''; show(); }, reduce ? 500 : 900);
    }
    btns[0].addEventListener('click', function () { answer(0); });
    btns[1].addEventListener('click', function () { answer(1); });
    on('quiz-again', function () {
      n = 0; right = 0; btns[0].disabled = btns[1].disabled = false;
      setText('quiz-score', '0 of 0'); setText('quiz-again', 'Start over'); show();
    });
    show();
  })();

  /* toys 2 and 3: every photo a dot, and a line that calls one side
     rosemary and the other lavender. In 'hand' mode two sliders turn the
     line. In 'learn' mode the machine turns it: each step looks at every
     photo and moves the three numbers a little toward fewer mistakes
     (logistic regression by gradient descent, which lesson 3 takes apart). */
  function herbToy(lab, mode) {
    var canvas = document.querySelector('canvas[data-lab="' + lab + '"]'), H = window.HERBS_DATA;
    if (!canvas || !H) return;
    var c = setupCanvas(canvas, 500, 650), ctx = c.ctx, L = c.L;
    var P = H.pts, w = [0, 0], bias = 0, picked = 0, steps = 0, auto = 0, acc = 0, seed = 11;
    var photo = new Image(); photo.onload = function () { draw(); };
    function pick(i) { picked = i; photo.src = herbSrc(i); }
    function rnd() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function fromSliders() {
      var a = document.getElementById(lab + '-tilt'), s = document.getElementById(lab + '-shift');
      var th = (a ? +a.value : 0) * Math.PI / 180;
      w = [Math.cos(th), Math.sin(th)]; bias = s ? -(+s.value) : 0;
    }
    function scramble() {
      var th = rnd() * TAU; w = [Math.cos(th) * 0.6, Math.sin(th) * 0.6]; bias = (rnd() - 0.5) * 0.8; steps = 0;
    }
    function says(i) { return w[0] * P[i][0] + w[1] * P[i][1] + bias > 0 ? 1 : 0; }
    function learn() {
      var g0 = 0, g1 = 0, gb = 0, i;
      for (i = 0; i < P.length; i++) {
        var p = 1 / (1 + Math.exp(-(w[0] * P[i][0] + w[1] * P[i][1] + bias))), e = p - P[i][2];
        g0 += e * P[i][0]; g1 += e * P[i][1]; gb += e;
      }
      w[0] -= 2.0 * g0 / P.length; w[1] -= 2.0 * g1 / P.length; bias -= 2.0 * gb / P.length; steps++;
    }
    function box() { return L.narrow ? { x: 12, y: 12, s: 456 } : { x: 18, y: 14, s: 472 }; }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var b = box(), i, right = 0;
      function PX(v) { return b.x + b.s / 2 + v * (b.s / 2 - 26); }
      function PY(v) { return b.y + b.s / 2 - v * (b.s / 2 - 26); }
      ctx.save(); rrect(ctx, b.x, b.y, b.s, b.s, 8); ctx.clip();
      ctx.fillStyle = '#03050a'; ctx.fillRect(b.x, b.y, b.s, b.s);
      // the two sides: a big tinted half-plane each way from the line
      var wl = Math.hypot(w[0], w[1]) || 1, nx = w[0] / wl, ny = w[1] / wl, off = -bias / wl;
      var ox = nx * off, oy = ny * off, tx = -ny, ty = nx, far = 6;
      for (i = 0; i < 2; i++) {
        var sgn = i ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(PX(ox - tx * far), PY(oy - ty * far)); ctx.lineTo(PX(ox + tx * far), PY(oy + ty * far));
        ctx.lineTo(PX(ox + tx * far + nx * far * sgn), PY(oy + ty * far + ny * far * sgn));
        ctx.lineTo(PX(ox - tx * far + nx * far * sgn), PY(oy - ty * far + ny * far * sgn)); ctx.closePath();
        ctx.fillStyle = i ? 'rgba(154,108,240,0.10)' : 'rgba(53,224,213,0.08)'; ctx.fill();
      }
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PX(ox - tx * far), PY(oy - ty * far)); ctx.lineTo(PX(ox + tx * far), PY(oy + ty * far)); ctx.stroke();
      for (i = 0; i < P.length; i++) {
        var ok = says(i) === P[i][2], x = PX(P[i][0]), y = PY(P[i][1]);
        if (ok) right++;
        ctx.beginPath(); ctx.arc(x, y, 6.5, 0, TAU); ctx.fillStyle = HERB_COL[P[i][2]]; ctx.fill();
        if (!ok) { ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.strokeStyle = RUST; ctx.lineWidth = 2.5; ctx.stroke(); }
        if (i === picked) { ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      ctx.restore();
      // name each side where it is: the labels ride with the line
      for (i = 0; i < 2; i++) {
        var sg = i ? 1 : -1, lx = PX(ox + nx * 0.55 * sg), ly = PY(oy + ny * 0.55 * sg);
        lx = Math.max(b.x + 86, Math.min(b.x + b.s - 86, lx)); ly = Math.max(b.y + 22, Math.min(b.y + b.s - 34, ly));
        text(ctx, lx, ly, 'says ' + H.names[i], HERB_COL[i], MONO_S, 'center');
      }
      text(ctx, b.x + b.s - 12, b.y + b.s - 12, 'a red ring is a mistake', RUST, MONO_S, 'right');
      // the photo behind the chosen dot
      var ps = L.narrow ? 150 : 250, px = L.narrow ? 16 : b.x + b.s + 34, py = L.narrow ? b.y + b.s + 16 : 44;
      var tx2 = L.narrow ? px + ps + 16 : px, ty2 = L.narrow ? py + 22 : py + ps + 30;
      ctx.fillStyle = '#0b1019'; rrect(ctx, px, py, ps, ps, 8); ctx.fill();
      if (photo.complete && photo.naturalWidth) {
        ctx.save(); rrect(ctx, px, py, ps, ps, 8); ctx.clip(); ctx.drawImage(photo, px, py, ps, ps); ctx.restore();
      }
      var truth = P[picked][2], guess = says(picked);
      text(ctx, tx2, ty2, 'THIS DOT IS A PHOTO OF', MUTED, MONO_S);
      text(ctx, tx2, ty2 + 24, H.names[truth], HERB_COL[truth], '600 20px ui-monospace, "SF Mono", Menlo, monospace');
      text(ctx, tx2, ty2 + 52, 'THE MACHINE SAYS', MUTED, MONO_S);
      text(ctx, tx2, ty2 + 76, H.names[guess] + (guess === truth ? '' : '  ✗'), guess === truth ? INK : RUST, '600 20px ui-monospace, "SF Mono", Menlo, monospace');
      if (!L.narrow) text(ctx, tx2, ty2 + 112, 'click any dot to see its photo', MUTED, MONO_S);
      setText(lab + '-right', right + ' of ' + P.length);
      setText(lab + '-steps', String(steps));
    }
    canvas.addEventListener('click', function (e) {
      var p = pointerPos(canvas, L, e), b = box(), best = -1, bd = 30, i;
      for (i = 0; i < P.length; i++) {
        var d = Math.hypot(p.x - (b.x + b.s / 2 + P[i][0] * (b.s / 2 - 26)), p.y - (b.y + b.s / 2 - P[i][1] * (b.s / 2 - 26)));
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { pick(best); draw(); }
    });
    if (mode === 'hand') {
      ['tilt', 'shift'].forEach(function (k) {
        var el = document.getElementById(lab + '-' + k);
        if (el) el.addEventListener('input', function () { fromSliders(); draw(); });
      });
      fromSliders();
    } else {
      // the first start is a bad one on purpose: nearly every photo wrong
      w = [0.6, 0.1]; bias = 0.25;
      on(lab + '-step', function () { auto = 0; learn(); draw(); });
      on(lab + '-run', function () { auto = 60; if (reduce) { while (auto-- > 0) learn(); auto = 0; draw(); } else wake(); });
      on(lab + '-scramble', function () { auto = 0; scramble(); draw(); });
    }
    pick(0);
    register({
      canvas: canvas, resize: c.resize, draw: draw,
      need: function () { return auto > 0; },
      step: function (dt) {
        if (auto <= 0) return;
        acc += dt * 12;
        while (acc >= 1 && auto > 0) { acc -= 1; learn(); auto--; }
      }
    });
  }
  herbToy('knobs', 'hand');
  herbToy('learner', 'learn');

  /* the later lessons live in their own files (learn-3.js ...) and borrow this */
  window.LearnKit = { TAU: TAU, CYAN: CYAN, INK: INK, MUTED: MUTED, RUST: RUST, VIOLET: VIOLET, GOLD: GOLD, BLUE: BLUE,
    LINE: LINE, PANEL: PANEL, PALETTE: PALETTE, MONO: MONO, MONO_S: MONO_S, reduce: reduce,
    softmax: softmax, argmax: argmax, forwardAll: forwardAll, setupCanvas: setupCanvas, pointerPos: pointerPos,
    text: text, rrect: rrect, pct: pct, signed: signed, setText: setText, on: on, register: register, wake: wake,
    ScoreColumn: ScoreColumn, pilotToy: pilotToy, arenaLeft: arenaLeft, drawPilotArena: drawPilotArena,
    signColor: signColor, herbSrc: herbSrc, HERB_COL: HERB_COL };
})();
