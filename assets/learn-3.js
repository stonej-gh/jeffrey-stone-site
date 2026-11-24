/* /learn/downhill/ - lesson 3's toys. Plumbing comes from learn-lab.js
   (window.LearnKit); the rosemary and lavender photos from herbs-data.js. */
(function () {
  'use strict';
  var K = window.LearnKit, H = window.HERBS_DATA;
  if (!K) return;
  var TAU = K.TAU, CYAN = K.CYAN, INK = K.INK, MUTED = K.MUTED, RUST = K.RUST, VIOLET = K.VIOLET,
      GOLD = K.GOLD, LINE = K.LINE, MONO = K.MONO, MONO_S = K.MONO_S, text = K.text, rrect = K.rrect;

  /* The two-knob machine of lesson 0, written so its loss can be drawn.
     Knobs: tilt (radians) and slide. A photo's score is how far it sits on
     the lavender side of the line, times SHARP; the share for lavender is
     the squashed score; the loss is the mean surprise at the right answer. */
  var SHARP = 6;
  function scoreOf(p, tilt, slide) { return SHARP * (Math.cos(tilt) * p[0] + Math.sin(tilt) * p[1] - slide); }
  function lossAt(tilt, slide) {
    var P = H.pts, sum = 0;
    for (var i = 0; i < P.length; i++) {
      var s = scoreOf(P[i], tilt, slide), z = P[i][2] ? s : -s;
      sum += Math.log(1 + Math.exp(-z));          // -ln(share on the truth)
    }
    return sum / P.length;
  }
  function mistakesAt(tilt, slide) {
    var P = H.pts, n = 0;
    for (var i = 0; i < P.length; i++) if ((scoreOf(P[i], tilt, slide) > 0 ? 1 : 0) !== P[i][2]) n++;
    return n;
  }
  // the tilt the machine itself settles on, found once by plain descent
  var BEST = (function () {
    if (!H) return { tilt: Math.PI, slide: 0 };
    var t = Math.PI, c = 0, e = 1e-4;
    for (var i = 0; i < 600; i++) {
      var gt = (lossAt(t + e, c) - lossAt(t - e, c)) / (2 * e), gc = (lossAt(t, c + e) - lossAt(t, c - e)) / (2 * e);
      t -= 0.1 * gt; c -= 0.1 * gc;
    }
    return { tilt: t, slide: c };
  })();

  function drawScatter(ctx, b, tilt, slide, small) {
    var P = H.pts, i;
    function PX(v) { return b.x + b.s / 2 + v * (b.s / 2 - 20); }
    function PY(v) { return b.y + b.s / 2 - v * (b.s / 2 - 20); }
    ctx.save(); rrect(ctx, b.x, b.y, b.s, b.s, 8); ctx.clip();
    ctx.fillStyle = '#03050a'; ctx.fillRect(b.x, b.y, b.s, b.s);
    var nx = Math.cos(tilt), ny = Math.sin(tilt), ox = nx * slide, oy = ny * slide, tx = -ny, ty = nx, far = 6;
    for (i = 0; i < 2; i++) {
      var sg = i ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(PX(ox - tx * far), PY(oy - ty * far)); ctx.lineTo(PX(ox + tx * far), PY(oy + ty * far));
      ctx.lineTo(PX(ox + tx * far + nx * far * sg), PY(oy + ty * far + ny * far * sg));
      ctx.lineTo(PX(ox - tx * far + nx * far * sg), PY(oy - ty * far + ny * far * sg)); ctx.closePath();
      ctx.fillStyle = i ? 'rgba(154,108,240,0.10)' : 'rgba(53,224,213,0.08)'; ctx.fill();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PX(ox - tx * far), PY(oy - ty * far)); ctx.lineTo(PX(ox + tx * far), PY(oy + ty * far)); ctx.stroke();
    var r = small ? 4.5 : 6;
    for (i = 0; i < P.length; i++) {
      var ok = (scoreOf(P[i], tilt, slide) > 0 ? 1 : 0) === P[i][2], x = PX(P[i][0]), y = PY(P[i][1]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = K.HERB_COL[P[i][2]]; ctx.fill();
      if (!ok) { ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, TAU); ctx.strokeStyle = RUST; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
    ctx.restore();
    text(ctx, b.x + 10, b.y + 20, 'rosemary', CYAN, MONO_S);
    text(ctx, b.x + 86, b.y + 20, 'lavender', VIOLET, MONO_S);
  }

  /* ---------- toy 1: two ways to keep score ---------- */
  (function loss() {
    var canvas = document.querySelector('canvas[data-lab="loss"]');
    if (!canvas || !H) return;
    var c = K.setupCanvas(canvas, 480, 760), ctx = c.ctx, L = c.L;
    var slider = document.getElementById('loss-slide'), slide = slider ? +slider.value : 0.5;
    var N = 161, xs = [], ms = [], ls = [], lmax = 0, i;
    for (i = 0; i < N; i++) {
      var s = -1 + 2 * i / (N - 1);
      xs.push(s); ms.push(mistakesAt(BEST.tilt, s)); ls.push(lossAt(BEST.tilt, s)); lmax = Math.max(lmax, ls[i]);
    }
    function plot(P, vals, vmax, cur, color, title, read, stepped) {
      function X(v) { return P.x + (v + 1) / 2 * P.w; }
      function Y(v) { return P.y + P.h - v / vmax * (P.h - 8); }
      text(ctx, P.x, P.y - 12, title, INK, MONO_S);
      text(ctx, P.x + P.w, P.y - 12, read, color, MONO, 'right');
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x, P.y + P.h); ctx.lineTo(P.x + P.w, P.y + P.h); ctx.stroke();
      ctx.beginPath();
      for (var j = 0; j < N; j++) {
        if (j === 0) ctx.moveTo(X(xs[j]), Y(vals[j]));
        else { if (stepped) ctx.lineTo(X(xs[j]), Y(vals[j - 1])); ctx.lineTo(X(xs[j]), Y(vals[j])); }
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(238,244,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(slide), P.y); ctx.lineTo(X(slide), P.y + P.h); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(X(slide), Y(cur), 6.5, 0, TAU); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
    }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var b = L.narrow ? { x: 12, y: 12, s: 456 } : { x: 18, y: 14, s: 452 };
      drawScatter(ctx, b, BEST.tilt, slide);
      var px = L.narrow ? 40 : b.x + b.s + 62, pw = L.narrow ? L.W - 58 : L.W - px - 24;
      var top = L.narrow ? b.y + b.s + 44 : 50, ph = L.narrow ? 96 : 160, gap = L.narrow ? 54 : 64;
      var m = mistakesAt(BEST.tilt, slide), l = lossAt(BEST.tilt, slide);
      plot({ x: px, y: top, w: pw, h: ph }, ms, 40, Math.min(m, 40), RUST, 'MISTAKES, COUNTED', m + ' of ' + H.pts.length, true);
      plot({ x: px, y: top + ph + gap, w: pw, h: ph }, ls, lmax, l, CYAN, 'LOSS, THE AVERAGE SURPRISE', l.toFixed(3), false);
      text(ctx, px, top + ph * 2 + gap + 20, 'line far left', MUTED, MONO_S);
      text(ctx, px + pw, top + ph * 2 + gap + 20, 'line far right', MUTED, MONO_S, 'right');
      K.setText('loss-m', m + ' of ' + H.pts.length); K.setText('loss-l', l.toFixed(3));
    }
    if (slider) slider.addEventListener('input', function () { slide = +slider.value; draw(); });
    K.register({ canvas: canvas, resize: c.resize, draw: draw, step: function () {}, need: function () { return false; } });
  })();

  /* ---------- toy 2: the landscape, and a ball that feels its way down ---------- */
  (function descent() {
    var canvas = document.querySelector('canvas[data-lab="descent"]');
    if (!canvas || !H) return;
    var c = K.setupCanvas(canvas, 480, 760), ctx = c.ctx, L = c.L;
    // the window of knob settings shown: tilt across, slide up
    var T0 = BEST.tilt - 1.5, T1 = BEST.tilt + 1.5, S0 = -1.6, S1 = 1.6, G = 56;
    var grid = [], gmin = 1e9, gmax = 0, i, j;
    for (j = 0; j < G; j++) for (i = 0; i < G; i++) {
      var v = lossAt(T0 + (i + 0.5) / G * (T1 - T0), S1 - (j + 0.5) / G * (S1 - S0));
      grid.push(v); gmin = Math.min(gmin, v); gmax = Math.max(gmax, v);
    }
    var START = { t: BEST.tilt + 1.15, s: 0.72 };
    var pos = { t: START.t, s: START.s }, path = [], steps = 0, auto = 0, acc = 0;
    var rate = document.getElementById('descent-rate');
    function lr() { return rate ? Math.pow(10, +rate.value) : 0.3; }
    function box() { return L.narrow ? { x: 12, y: 12, s: 456 } : { x: 18, y: 14, s: 452 }; }
    function BX(b, t) { return b.x + (t - T0) / (T1 - T0) * b.s; }
    function BY(b, s) { return b.y + (S1 - s) / (S1 - S0) * b.s; }
    function step() {
      var e = 1e-4;
      var gt = (lossAt(pos.t + e, pos.s) - lossAt(pos.t - e, pos.s)) / (2 * e);
      var gs = (lossAt(pos.t, pos.s + e) - lossAt(pos.t, pos.s - e)) / (2 * e);
      pos.t -= lr() * gt; pos.s -= lr() * gs;
      path.push({ t: pos.t, s: pos.s }); steps++;
    }
    function reset(t, s) { pos = { t: t, s: s }; path = [{ t: t, s: s }]; steps = 0; auto = 0; }
    reset(START.t, START.s);
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var b = box(), cs = b.s / G, n, k;
      ctx.save(); rrect(ctx, b.x, b.y, b.s, b.s, 8); ctx.clip();
      for (n = 0; n < G * G; n++) {
        // low is dark, high is bright: a height map
        var u = Math.pow((grid[n] - gmin) / (gmax - gmin), 0.5);
        var r = Math.round(8 + u * 60), g2 = Math.round(14 + u * 150), b2 = Math.round(24 + u * 150);
        ctx.fillStyle = 'rgb(' + r + ',' + g2 + ',' + b2 + ')';
        ctx.fillRect(b.x + (n % G) * cs, b.y + Math.floor(n / G) * cs, cs + 0.6, cs + 0.6);
      }
      ctx.beginPath();
      for (k = 0; k < path.length; k++) { if (k === 0) ctx.moveTo(BX(b, path[k].t), BY(b, path[k].s)); else ctx.lineTo(BX(b, path[k].t), BY(b, path[k].s)); }
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
      for (k = 0; k < path.length; k++) { ctx.beginPath(); ctx.arc(BX(b, path[k].t), BY(b, path[k].s), 2.2, 0, TAU); ctx.fillStyle = GOLD; ctx.fill(); }
      ctx.beginPath(); ctx.arc(BX(b, pos.t), BY(b, pos.s), 8, 0, TAU); ctx.fillStyle = INK; ctx.shadowColor = INK; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
      text(ctx, b.x + 10, b.y + 20, 'dark is low loss', INK, MONO_S);
      text(ctx, b.x + b.s / 2, b.y + b.s - 10, 'TILT →', 'rgba(238,244,255,0.75)', MONO_S, 'center');
      ctx.save(); ctx.translate(b.x + 16, b.y + b.s / 2); ctx.rotate(-Math.PI / 2);
      text(ctx, 0, 0, 'SLIDE →', 'rgba(238,244,255,0.75)', MONO_S, 'center'); ctx.restore();
      // the line these two knobs draw
      var sb = L.narrow ? { x: 12, y: b.y + b.s + 40, s: 232 } : { x: b.x + b.s + 40, y: 44, s: 330 };
      text(ctx, sb.x, sb.y - 12, 'THE LINE AT THIS SPOT', INK, MONO_S);
      drawScatter(ctx, sb, pos.t, pos.s, true);
      var tx = L.narrow ? sb.x + sb.s + 18 : sb.x, ty = L.narrow ? sb.y + 24 : sb.y + sb.s + 34;
      var big = '600 20px ui-monospace, "SF Mono", Menlo, monospace';
      text(ctx, tx, ty, 'LOSS', MUTED, MONO_S); text(ctx, tx, ty + 24, lossAt(pos.t, pos.s).toFixed(3), CYAN, big);
      text(ctx, tx + (L.narrow ? 0 : 130), ty + (L.narrow ? 54 : 0), 'MISTAKES', MUTED, MONO_S);
      text(ctx, tx + (L.narrow ? 0 : 130), ty + (L.narrow ? 78 : 24), String(mistakesAt(pos.t, pos.s)), RUST, big);
      K.setText('descent-steps', String(steps)); K.setText('descent-loss', lossAt(pos.t, pos.s).toFixed(3));
      K.setText('descent-rate-read', lr() < 1 ? lr().toFixed(2) : lr().toFixed(1));
    }
    canvas.addEventListener('click', function (e) {
      var p = K.pointerPos(canvas, L, e), b = box();
      if (p.x < b.x || p.x > b.x + b.s || p.y < b.y || p.y > b.y + b.s) return;
      reset(T0 + (p.x - b.x) / b.s * (T1 - T0), S1 - (p.y - b.y) / b.s * (S1 - S0)); draw();
    });
    if (rate) rate.addEventListener('input', draw);
    K.on('descent-step', function () { auto = 0; step(); draw(); });
    K.on('descent-roll', function () { auto = 40; if (K.reduce) { while (auto-- > 0) step(); auto = 0; draw(); } else K.wake(); });
    K.on('descent-reset', function () { reset(START.t, START.s); draw(); });
    K.register({
      canvas: canvas, resize: c.resize, draw: draw, need: function () { return auto > 0; },
      step: function (dt) { if (auto <= 0) return; acc += dt * 10; while (acc >= 1 && auto > 0) { acc -= 1; step(); auto--; } }
    });
  })();

  /* ---------- toy 3: blame, sent backward ----------
     x -> (x w1) -> tanh -> (x w2) -> out, scored against a target by
     (out - target)^2. Forward fills the top row; backward fills the bottom
     row right to left, each number made from the one to its right. */
  (function chain() {
    var canvas = document.querySelector('canvas[data-lab="chain"]');
    if (!canvas) return;
    var c = K.setupCanvas(canvas, 420, 640), ctx = c.ctx, L = c.L;
    var X = 1.5, T = 0.8, START = { w1: -0.6, w2: 0.5 }, w1 = START.w1, w2 = START.w2;
    var stage = 0, anim = 0, steps = 0, RATE = 0.4;
    function fwd() { var a = X * w1, h = Math.tanh(a), out = h * w2; return { a: a, h: h, out: out, loss: (out - T) * (out - T) }; }
    function back(f) {
      var dout = 2 * (f.out - T), dw2 = dout * f.h, dh = dout * w2, da = dh * (1 - f.h * f.h), dw1 = da * X;
      return { dout: dout, dw2: dw2, dh: dh, da: da, dw1: dw1 };
    }
    function f2(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var f = fwd(), g = back(f), nar = L.narrow;
      // five stations: x, a, h, out, loss; four links between them
      var names = ['input', 'weighted', 'squashed', 'output', 'loss'];
      var vals = [X, f.a, f.h, f.out, f.loss];
      var ops = ['× w1', 'tanh', '× w2', '(out − target)²'];
      var blame = [null, g.da, g.dh, g.dout, null];
      var how = ['', 'blame × (1 − squashed²)', 'blame × w2', '2 × (out − target)', ''];
      var n = 5, i;
      function P(k) {
        if (!nar) return { x: 70 + k * (L.W - 140) / (n - 1), y: 150 };
        return { x: 110, y: 60 + k * 118 };
      }
      for (i = 0; i < n - 1; i++) {
        var a = P(i), b = P(i + 1);
        ctx.strokeStyle = 'rgba(53,224,213,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a.x + (nar ? 0 : 34), a.y + (nar ? 30 : 0)); ctx.lineTo(b.x - (nar ? 0 : 34), b.y - (nar ? 30 : 0)); ctx.stroke();
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (nar) text(ctx, mx + 14, my + 4, ops[i], GOLD, MONO); else text(ctx, mx, my - 14, ops[i], GOLD, MONO, 'center');
        // the weight on this link, and the blame that lands on it
        var wname = i === 0 ? 'w1 = ' + f2(w1) : i === 2 ? 'w2 = ' + f2(w2) : '';
        if (wname) {
          if (nar) text(ctx, mx + 14, my + 22, wname, INK, MONO_S); else text(ctx, mx, my - 34, wname, INK, MONO_S, 'center');
          var need = i === 0 ? 5 : 2, gw = i === 0 ? g.dw1 : g.dw2;
          if (stage >= need) {
            var lab = 'its blame ' + f2(gw);
            if (nar) text(ctx, mx + 130, my + 22, lab, RUST, MONO_S); else text(ctx, mx, my + 86, lab, RUST, MONO_S, 'center');
          }
        }
      }
      for (i = 0; i < n; i++) {
        var p = P(i), isLoss = i === n - 1;
        ctx.fillStyle = '#0b1019'; rrect(ctx, p.x - 34, p.y - 28, 68, 56, 10); ctx.fill();
        ctx.strokeStyle = isLoss ? RUST : 'rgba(53,224,213,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
        text(ctx, p.x, p.y + 6, isLoss ? vals[i].toFixed(2) : f2(vals[i]), isLoss ? RUST : INK, '600 16px ui-monospace, "SF Mono", Menlo, monospace', 'center');
        if (nar) text(ctx, p.x - 44, p.y + 5, names[i], MUTED, MONO_S, 'right'); else text(ctx, p.x, p.y - 40, names[i], MUTED, MONO_S, 'center');
        // blame under each station, appearing right to left
        var order = { 3: 1, 2: 3, 1: 4 }[i];
        if (blame[i] !== null && stage >= order) {
          if (nar) { text(ctx, p.x + 48, p.y - 4, 'blame ' + f2(blame[i]), RUST, MONO); text(ctx, p.x + 48, p.y + 14, how[i], MUTED, MONO_S); }
          else { text(ctx, p.x, p.y + 52, 'blame ' + f2(blame[i]), RUST, MONO, 'center'); text(ctx, p.x, p.y + 70, how[i], MUTED, MONO_S, 'center'); }
        }
      }
      if (!nar) {
        text(ctx, 36, 36, 'FORWARD: LEFT TO RIGHT, THE ANSWER', CYAN, MONO_S);
        text(ctx, L.W - 36, 268, 'BACKWARD: RIGHT TO LEFT, THE BLAME', RUST, MONO_S, 'right');
        text(ctx, 36, 330, 'target ' + f2(T) + '   the output should have been this', MUTED, MONO_S);
        text(ctx, 36, 352, 'a weight’s blame = the blame at its far end × the number at its near end', MUTED, MONO_S);
        text(ctx, 36, 374, 'a nudge = move each weight a little against its blame', MUTED, MONO_S);
      } else {
        text(ctx, 16, L.H - 14, 'target ' + f2(T) + ': what the output should be', MUTED, MONO_S);
      }
      K.setText('chain-loss', f.loss.toFixed(3)); K.setText('chain-steps', String(steps));
    }
    K.on('chain-back', function () { stage = 0; anim = 5; if (K.reduce) { stage = 5; anim = 0; draw(); } else K.wake(); });
    K.on('chain-nudge', function () {
      var g = back(fwd()); w1 -= RATE * g.dw1; w2 -= RATE * g.dw2; steps++; stage = 5; draw();
    });
    K.on('chain-reset', function () { w1 = START.w1; w2 = START.w2; stage = 0; steps = 0; anim = 0; draw(); });
    var acc = 0;
    K.register({
      canvas: canvas, resize: c.resize, draw: draw, need: function () { return anim > 0; },
      step: function (dt) { if (anim <= 0) return; acc += dt * 1.8; while (acc >= 1 && anim > 0) { acc -= 1; stage++; anim--; } }
    });
  })();

  /* ---------- toy 4: homework and exam ----------
     Ten noisy points from a gentle curve, a polynomial with as many knobs as
     the slider says fitted to them by least squares, and thirty held-back
     points it never sees. */
  (function overfit() {
    var canvas = document.querySelector('canvas[data-lab="overfit"]');
    if (!canvas) return;
    var c = K.setupCanvas(canvas, 460, 720), ctx = c.ctx, L = c.L;
    var slider = document.getElementById('fit-knobs'), seed = 4, train = [], test = [], errs = [];
    function rnd() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * 0.87; }
    function truth(x) { return 0.6 * Math.sin(2.6 * x) + 0.25 * x; }
    function fit(k) {
      // least squares for k coefficients (degree k-1): solve (A'A) w = A'y
      var n = k, A = [], b = [], i, j, m;
      for (i = 0; i < n; i++) { A.push([]); b.push(0); for (j = 0; j < n; j++) A[i].push(i === j ? 1e-9 : 0); }
      for (m = 0; m < train.length; m++) {
        var pw = [1]; for (i = 1; i < n; i++) pw.push(pw[i - 1] * train[m].x);
        for (i = 0; i < n; i++) { b[i] += pw[i] * train[m].y; for (j = 0; j < n; j++) A[i][j] += pw[i] * pw[j]; }
      }
      for (i = 0; i < n; i++) {           // elimination with pivoting
        var piv = i; for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
        var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp; var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
        for (j = i + 1; j < n; j++) { var fct = A[j][i] / A[i][i]; b[j] -= fct * b[i]; for (m = i; m < n; m++) A[j][m] -= fct * A[i][m]; }
      }
      var w = []; for (i = n - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < n; j++) s -= A[i][j] * w[j]; w[i] = s / A[i][i]; }
      return w;
    }
    function evalP(w, x) { var s = 0; for (var i = w.length - 1; i >= 0; i--) s = s * x + w[i]; return s; }
    function rms(w, pts) { var s = 0; for (var i = 0; i < pts.length; i++) { var d = evalP(w, pts[i].x) - pts[i].y; s += d * d; } return Math.sqrt(s / pts.length); }
    function deal() {
      train = []; test = []; var i;
      for (i = 0; i < 10; i++) { var x = -0.95 + 1.9 * (i + 0.15 + 0.7 * rnd()) / 10; train.push({ x: x, y: truth(x) + 0.09 * gauss() }); }
      for (i = 0; i < 30; i++) { var x2 = -0.95 + 1.9 * rnd(); test.push({ x: x2, y: truth(x2) + 0.09 * gauss() }); }
      errs = []; for (i = 1; i <= 10; i++) { var w = fit(i); errs.push({ tr: rms(w, train), te: rms(w, test) }); }
    }
    deal();
    function draw() {
      ctx.clearRect(0, 0, L.W, L.H);
      var k = slider ? +slider.value : 4, w = fit(k), nar = L.narrow, i;
      var b = nar ? { x: 12, y: 12, w: 456, h: 360 } : { x: 18, y: 14, w: 560, h: 432 };
      function X(v) { return b.x + (v + 1) / 2 * b.w; }
      function Y(v) { return b.y + b.h / 2 - v * b.h / 2.6; }
      ctx.save(); rrect(ctx, b.x, b.y, b.w, b.h, 8); ctx.clip();
      ctx.fillStyle = '#03050a'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.beginPath(); for (i = 0; i <= 100; i++) { var x = -1 + i / 50; if (i === 0) ctx.moveTo(X(x), Y(truth(x))); else ctx.lineTo(X(x), Y(truth(x))); }
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(128,139,159,0.6)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); for (i = 0; i <= 240; i++) { var x3 = -1 + i / 120, y3 = Math.max(-3, Math.min(3, evalP(w, x3))); if (i === 0) ctx.moveTo(X(x3), Y(y3)); else ctx.lineTo(X(x3), Y(y3)); }
      ctx.strokeStyle = CYAN; ctx.lineWidth = 2.5; ctx.stroke();
      for (i = 0; i < test.length; i++) { ctx.beginPath(); ctx.arc(X(test[i].x), Y(test[i].y), 4.5, 0, TAU); ctx.strokeStyle = VIOLET; ctx.lineWidth = 1.5; ctx.stroke(); }
      for (i = 0; i < train.length; i++) { ctx.beginPath(); ctx.arc(X(train[i].x), Y(train[i].y), 6.5, 0, TAU); ctx.fillStyle = GOLD; ctx.fill(); }
      ctx.restore();
      text(ctx, b.x + 12, b.y + 22, '● homework: 10 points it trains on', GOLD, MONO_S);
      text(ctx, b.x + 12, b.y + 40, '○ exam: 30 points it never sees', '#c9b3ff', MONO_S);
      text(ctx, b.x + 12, b.y + 58, '- - the true shape, hidden from it', MUTED, MONO_S);
      // error against knob count
      var P = nar ? { x: 46, y: b.y + b.h + 50, w: L.W - 66, h: 190 } : { x: b.x + b.w + 62, y: 60, w: L.W - (b.x + b.w + 62) - 24, h: 300 };
      var emax = 0.5;
      function EX(n) { return P.x + (n - 1) / 9 * P.w; }
      function EY(v) { return P.y + P.h - Math.min(v, emax) / emax * P.h; }
      text(ctx, P.x, P.y - 16, 'ERROR AT EACH KNOB COUNT', INK, MONO_S);
      ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x, P.y + P.h); ctx.lineTo(P.x + P.w, P.y + P.h); ctx.stroke();
      for (i = 1; i <= 10; i++) text(ctx, EX(i), P.y + P.h + 16, String(i), i === k ? INK : MUTED, MONO_S, 'center');
      text(ctx, P.x + P.w / 2, P.y + P.h + 34, 'knobs', MUTED, MONO_S, 'center');
      ['tr', 'te'].forEach(function (key) {
        ctx.beginPath(); for (i = 0; i < 10; i++) { if (i === 0) ctx.moveTo(EX(i + 1), EY(errs[i][key])); else ctx.lineTo(EX(i + 1), EY(errs[i][key])); }
        ctx.strokeStyle = key === 'tr' ? GOLD : VIOLET; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(EX(k), EY(errs[k - 1][key]), 6, 0, TAU); ctx.fillStyle = key === 'tr' ? GOLD : VIOLET; ctx.fill();
      });
      text(ctx, P.x + P.w, P.y + 4, 'exam', '#c9b3ff', MONO_S, 'right'); text(ctx, P.x + P.w, P.y + 22, 'homework', GOLD, MONO_S, 'right');
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(238,244,255,0.3)'; ctx.beginPath(); ctx.moveTo(EX(k), P.y); ctx.lineTo(EX(k), P.y + P.h); ctx.stroke(); ctx.setLineDash([]);
      K.setText('fit-read', String(k)); K.setText('fit-train', errs[k - 1].tr.toFixed(3)); K.setText('fit-test', errs[k - 1].te > 9.99 ? 'over 10' : errs[k - 1].te.toFixed(3));
    }
    if (slider) slider.addEventListener('input', draw);
    K.on('fit-new', function () { deal(); draw(); });
    K.register({ canvas: canvas, resize: c.resize, draw: draw, step: function () {}, need: function () { return false; } });
  })();
})();
