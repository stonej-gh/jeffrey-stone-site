/* /orbits/ - the orbit lab: three hands-on gravity toys on plain canvas.
   No libraries. Each toy binds to a canvas[data-lab=…] and its own control
   row, and no-ops if the canvas isn't on the page. Logical space is 960x540
   (the HTML width/height attributes); CSS scales it, resize() keeps it crisp.
   All three share one rAF loop that sleeps whenever nothing is moving. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var CYAN = '#35e0d5', INK = '#eef4ff', MUTED = 'rgba(128,139,159,0.9)',
      RUST = '#d9825f', VIOLET = '#9a6cf0', GOLD = '#ffc887';
  var MONO = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- shared plumbing ---------- */

  // deterministic PRNG → the same star field every visit
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeStars(seed, n) {
    var rnd = mulberry(seed), s = [];
    for (var i = 0; i < n; i++) {
      s.push({ x: rnd() * 960, y: rnd() * 540, r: rnd() * 1.1 + 0.25, a: rnd() * 0.5 + 0.15 });
    }
    return s;
  }
  function drawStars(ctx, stars) {
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = st.a; ctx.fillStyle = '#cdd6e6';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // the singularity, same visual language as the hero (orbit.js)
  function drawHole(ctx, x, y, hr, glow) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, glow);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(6,8,14,0.96)');
    g.addColorStop(0.72, 'rgba(106,63,176,0.30)');
    g.addColorStop(1, 'rgba(106,63,176,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, glow, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, hr, 0, TAU);
    ctx.fillStyle = '#05060a'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(53,224,213,0.25)'; ctx.stroke();
  }

  function drawShip(ctx, x, y, ang, color, flame) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    if (flame) {
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(-14 - Math.sin(Date.now() / 40) * 3, 0);
      ctx.lineWidth = 3; ctx.strokeStyle = GOLD; ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-3, 0); ctx.lineTo(-5, -4.5); ctx.closePath();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill();
    ctx.restore();
  }

  function label(ctx, x, y, txt, color) {
    ctx.font = MONO; ctx.fillStyle = color || MUTED; ctx.fillText(txt, x, y);
  }

  // semi-implicit Euler, fixed substeps - one body, one gravity well
  function stepBody(p, GM, cx, cy, dt) {
    var n = Math.max(1, Math.round(dt / (1 / 240)));
    var h = dt / n;
    for (var i = 0; i < n; i++) {
      var dx = cx - p.x, dy = cy - p.y;
      var r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
      var a = GM / (r2 * r);
      p.vx += a * dx * h; p.vy += a * dy * h;
      p.x += p.vx * h; p.y += p.vy * h;
    }
  }

  function setupCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cw = canvas.clientWidth || 960;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(cw * dpr * (540 / 960));
      var s = canvas.width / 960;
      ctx.setTransform(s, 0, 0, s, 0, 0);
    }
    resize();
    return { ctx: ctx, resize: resize };
  }

  function pointerPos(canvas, e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * 960, y: (e.clientY - r.top) / r.height * 540 };
  }

  // press-and-hold helper (mouse, touch, keyboard)
  function addHold(btn, set) {
    if (!btn) return;
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no live pointer */ }
      set(true);
    });
    btn.addEventListener('pointerup', function () { set(false); });
    btn.addEventListener('pointercancel', function () { set(false); });
    btn.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
    btn.addEventListener('keyup', function () { set(false); });
    btn.addEventListener('blur', function () { set(false); });
  }

  /* one shared loop: widgets register {canvas, need, step, draw} */
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

  /* ---------- toy 1: Newton's cannonball ----------
     Real Earth numbers on the dial: the sim's circular speed at the muzzle
     maps to 7,900 m/s, so escape shows up at ~11,200 m/s - both true. */
  (function cannon() {
    var canvas = document.querySelector('canvas[data-lab="cannon"]');
    if (!canvas) return;
    var S = setupCanvas(canvas), ctx = S.ctx;
    var stars = makeStars(7, 85);
    var C = { x: 480, y: 305 }, R = 128;         // the planet
    var r0 = R + 26;                             // muzzle radius (mountain top)
    var MUZ = { x: C.x, y: C.y - r0 };
    var VCIRC = 135;                             // px/s → displays as 7,900 m/s
    var GM = VCIRC * VCIRC * r0;
    var shots = [];

    var slider = document.getElementById('cannon-speed');
    var read = document.getElementById('cannon-read');
    var fireBtn = document.getElementById('cannon-fire');
    var clearBtn = document.getElementById('cannon-clear');

    function msDisplay() {
      return Math.round(+slider.value * 7900 / 10) * 10;
    }
    function updateRead() { read.textContent = msDisplay().toLocaleString('en-US') + ' m/s'; }

    function fire() {
      if (shots.length > 6) shots.shift();
      shots.push({
        x: MUZ.x, y: MUZ.y, vx: +slider.value * VCIRC, vy: 0,
        trail: [], state: 'fly', theta: 0,
        lastAng: Math.atan2(MUZ.y - C.y, MUZ.x - C.x), orbited: false
      });
      wake();
    }
    slider.addEventListener('input', updateRead);
    fireBtn.addEventListener('click', fire);
    clearBtn.addEventListener('click', function () { shots = []; draw(); });
    updateRead();

    function step(dt) {
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        if (s.state !== 'fly') continue;
        stepBody(s, GM, C.x, C.y, dt);
        var dx = s.x - C.x, dy = s.y - C.y, r = Math.hypot(dx, dy);
        s.trail.push(s.x, s.y);
        if (s.trail.length > 4400) s.trail.splice(0, 2);
        var ang = Math.atan2(dy, dx);
        var d = ang - s.lastAng;
        if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
        s.theta += d; s.lastAng = ang;
        if (Math.abs(s.theta) >= TAU) s.orbited = true;
        if (Math.abs(s.theta) >= 2.35 * TAU) s.state = 'parked';   // proven - declutter
        if (r <= R) s.state = 'crash';
        if (r > 900) {
          // off-screen: true escape only if unbound (keeps the caption's
          // 11,200 m/s honest - a huge ellipse is not an escape)
          var v2 = s.vx * s.vx + s.vy * s.vy;
          s.state = (v2 / 2 - GM / r >= 0) ? 'escape' : 'faroff';
        }
      }
    }

    function trailColor(s) {
      if (s.orbited) return CYAN;
      if (s.state === 'crash') return RUST;
      if (s.state === 'escape') return VIOLET;
      return INK;
    }

    function draw() {
      ctx.clearRect(0, 0, 960, 540);
      ctx.fillStyle = '#03050a'; ctx.fillRect(0, 0, 960, 540);
      drawStars(ctx, stars);

      // planet with a lit limb
      var g = ctx.createRadialGradient(C.x - 44, C.y - 52, 12, C.x, C.y, R);
      g.addColorStop(0, '#33445e'); g.addColorStop(0.55, '#1c2637'); g.addColorStop(1, '#0d1420');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,150,190,0.35)'; ctx.stroke();

      // Newton's impossible mountain + the cannon
      ctx.beginPath();
      ctx.moveTo(C.x - 11, C.y - R + 3); ctx.lineTo(C.x, MUZ.y); ctx.lineTo(C.x + 11, C.y - R + 3);
      ctx.closePath(); ctx.fillStyle = '#26334a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(MUZ.x, MUZ.y); ctx.lineTo(MUZ.x + 15, MUZ.y);
      ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();

      var anyOrbit = false, anyEscape = false, anyFaroff = false;
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        var col = trailColor(s);
        if (s.orbited) anyOrbit = true;
        if (s.state === 'escape') anyEscape = true;
        if (s.state === 'faroff') anyFaroff = true;
        if (s.trail.length >= 4) {
          ctx.beginPath();
          ctx.moveTo(s.trail[0], s.trail[1]);
          for (var k = 2; k < s.trail.length; k += 2) ctx.lineTo(s.trail[k], s.trail[k + 1]);
          ctx.globalAlpha = s.state === 'fly' ? 0.9 : 0.55;
          ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (s.state === 'fly') {
          ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU);
          ctx.fillStyle = INK; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (s.state === 'crash') {
          ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, TAU);
          ctx.fillStyle = RUST; ctx.fill();
        }
      }
      if (anyOrbit) label(ctx, 22, 32, 'ORBIT: it keeps missing', CYAN);
      if (anyEscape) label(ctx, 22, anyOrbit ? 54 : 32, 'ESCAPED: gone for good', VIOLET);
      if (anyFaroff) label(ctx, 22, 32 + (anyOrbit ? 22 : 0) + (anyEscape ? 22 : 0), 'LONG WAY OUT: still falling back, just not on this screen', INK);
      label(ctx, 22, 518, 'fire a few and compare the trails', MUTED);
    }

    register({ canvas: canvas, resize: S.resize, need: function () { return shots.some(function (s) { return s.state === 'fly'; }); }, step: step, draw: draw });
  })();

  /* ---------- toy 2: one burn, whole new orbit ----------
     The dashed guide is the osculating ellipse computed from the ship's
     state each frame - the burn visibly reshapes the FUTURE while the ship
     stays put. LAP TIME is the analytic period of that ellipse. */
  (function burn() {
    var canvas = document.querySelector('canvas[data-lab="burn"]');
    if (!canvas) return;
    var S = setupCanvas(canvas), ctx = S.ctx;
    var stars = makeStars(11, 85);
    var F = { x: 450, y: 280 }, HR = 15, GM = 3.0e6, ACC = 60;
    var ship, trail, burnDir = 0, dead = 0, escaped = false;

    var rSpeed = document.getElementById('burn-speed');
    var rAlt = document.getElementById('burn-alt');
    var rLap = document.getElementById('burn-lap');

    function reset() {
      var r = 170, v = Math.sqrt(GM / r) * 1.12;    // gentle ellipse to start
      ship = { x: F.x + r, y: F.y, vx: 0, vy: -v };
      trail = []; dead = 0; escaped = false;
    }
    reset();

    // orbital elements from state - guide ellipse + period
    function elements() {
      var rx = ship.x - F.x, ry = ship.y - F.y;
      var r = Math.hypot(rx, ry), v2 = ship.vx * ship.vx + ship.vy * ship.vy;
      var eps = v2 / 2 - GM / r;
      if (eps >= -1e-6) return null;                 // unbound - no ellipse
      var a = -GM / (2 * eps);
      var rv = rx * ship.vx + ry * ship.vy;
      var ex = ((v2 - GM / r) * rx - rv * ship.vx) / GM;
      var ey = ((v2 - GM / r) * ry - rv * ship.vy) / GM;
      var e = Math.min(Math.hypot(ex, ey), 0.999);
      return {
        a: a, e: e, phi: Math.atan2(ey, ex),
        b: a * Math.sqrt(1 - e * e),
        T: TAU * Math.sqrt(a * a * a / GM),
        peri: a * (1 - e)
      };
    }

    addHold(document.getElementById('burn-retro'), function (on) { burnDir = on ? -1 : (burnDir === -1 ? 0 : burnDir); wake(); });
    addHold(document.getElementById('burn-pro'), function (on) { burnDir = on ? 1 : (burnDir === 1 ? 0 : burnDir); wake(); });
    document.getElementById('burn-reset').addEventListener('click', function () { reset(); wake(); });

    function step(dt) {
      if (dead > 0) { dead -= dt; if (dead <= 0) reset(); return; }
      if (reduce && !burnDir) return;                // reduced motion: move only under command
      if (burnDir) {
        var v = Math.hypot(ship.vx, ship.vy) || 1;
        ship.vx += burnDir * ACC * dt * ship.vx / v;
        ship.vy += burnDir * ACC * dt * ship.vy / v;
      }
      stepBody(ship, GM, F.x, F.y, dt);
      var r = Math.hypot(ship.x - F.x, ship.y - F.y);
      trail.push(ship.x, ship.y);
      if (trail.length > 520) trail.splice(0, 2);
      if (r < HR + 5) { dead = 0.9; }
      escaped = !elements();
      if (escaped && r > 1500) reset();
    }

    function draw() {
      ctx.clearRect(0, 0, 960, 540);
      ctx.fillStyle = '#03050a'; ctx.fillRect(0, 0, 960, 540);
      drawStars(ctx, stars);

      var el = elements();
      if (el) {
        // guide ellipse: center sits a·e from the focus, opposite periapsis
        ctx.save();
        ctx.translate(F.x - el.a * el.e * Math.cos(el.phi), F.y - el.a * el.e * Math.sin(el.phi));
        ctx.rotate(el.phi);
        ctx.beginPath(); ctx.ellipse(0, 0, el.a, el.b, 0, 0, TAU);
        ctx.setLineDash([3, 8]); ctx.lineWidth = 1;
        ctx.strokeStyle = burnDir ? 'rgba(53,224,213,0.55)' : 'rgba(220,228,240,0.25)';
        ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
      drawHole(ctx, F.x, F.y, HR, 120);

      for (var j = 3; j < trail.length; j += 2) {
        var t = j / trail.length;
        ctx.beginPath();
        ctx.moveTo(trail[j - 3], trail[j - 2]); ctx.lineTo(trail[j - 1], trail[j]);
        ctx.strokeStyle = 'rgba(53,224,213,' + (t * 0.85).toFixed(3) + ')';
        ctx.lineWidth = t * 2.2 + 0.2; ctx.stroke();
      }

      if (dead > 0) {
        ctx.beginPath(); ctx.arc(F.x, F.y, HR + (0.9 - dead) * 90, 0, TAU);
        ctx.strokeStyle = 'rgba(154,108,240,' + (dead / 0.9).toFixed(2) + ')';
        ctx.lineWidth = 3; ctx.stroke();
        label(ctx, 22, 32, 'SWALLOWED: braked too deep', VIOLET);
      } else {
        drawShip(ctx, ship.x, ship.y, Math.atan2(ship.vy, ship.vx), INK, !!burnDir);
      }
      if (escaped) label(ctx, 22, 32, 'ESCAPE VELOCITY: it never comes back', VIOLET);
      if (reduce && !burnDir && dead <= 0) label(ctx, 22, 518, 'hold a burn to move (reduced motion honored)', MUTED);

      // readouts
      var v = Math.hypot(ship.vx, ship.vy);
      var r = Math.hypot(ship.x - F.x, ship.y - F.y);
      if (rSpeed) rSpeed.textContent = Math.round(v);
      if (rAlt) rAlt.textContent = Math.round(r - HR);
      if (rLap) rLap.textContent = el ? el.T.toFixed(1) + ' s' : '–';
    }

    register({ canvas: canvas, resize: S.resize, need: function () { return dead > 0 || !(reduce && !burnDir); }, step: step, draw: draw });
  })();

  /* ---------- toy 3: bend the shot ----------
     The target hides behind the hole: the straight line is swallowed, the
     curved one connects. GM/speed tuned so hits exist well off the direct
     bearing (see the tuning scan in scratch - constants baked here). */
  (function laser() {
    var canvas = document.querySelector('canvas[data-lab="laser"]');
    if (!canvas) return;
    var S = setupCanvas(canvas), ctx = S.ctx;
    var stars = makeStars(23, 85);
    var F = { x: 480, y: 270 }, HR = 30, GLOW = 140;
    var GM = 2.6e6, SPEED = 300, HIT_R = 32;
    var SHIP = { x: 120, y: 380 };
    var TARGETS = [{ x: 840, y: 160 }, { x: 800, y: 120 }, { x: 880, y: 205 }];
    var ti = 0, hits = 0, aim = -0.75, aiming = false, flash = 0;
    var shots = [];
    var readHits = document.getElementById('laser-hits');

    function muzzle() { return { x: SHIP.x + Math.cos(aim) * 17, y: SHIP.y + Math.sin(aim) * 17 }; }

    function fire() {
      var m = muzzle();
      if (shots.length > 7) shots.shift();
      shots.push({ x: m.x, y: m.y, vx: Math.cos(aim) * SPEED, vy: Math.sin(aim) * SPEED, trail: [], state: 'fly', age: 0 });
      wake();
    }

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no live pointer */ }
      aiming = true; onMove(e); wake();
    });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', function (e) {
      if (!aiming) return;
      onMove(e); aiming = false; fire();
    });
    function onMove(e) {
      if (!aiming) return;
      var p = pointerPos(canvas, e);
      aim = Math.atan2(p.y - SHIP.y, p.x - SHIP.x);
      aim = Math.max(-1.5, Math.min(0.6, aim));
      wake();
    }
    var fireBtn = document.getElementById('laser-fire');
    if (fireBtn) fireBtn.addEventListener('click', fire);

    function step(dt) {
      if (flash > 0) flash -= dt;
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        if (s.state !== 'fly') continue;
        stepBody(s, GM, F.x, F.y, dt);
        s.age += dt;
        s.trail.push(s.x, s.y);
        if (s.trail.length > 1200) s.trail.splice(0, 2);
        var T = TARGETS[ti];
        if (Math.hypot(s.x - F.x, s.y - F.y) < HR) { s.state = 'gone'; }
        else if (Math.hypot(s.x - T.x, s.y - T.y) < HIT_R) {
          s.state = 'hit'; hits++; flash = 0.8; ti = (ti + 1) % TARGETS.length;
          if (readHits) readHits.textContent = hits;
        }
        else if (s.x < -100 || s.x > 1060 || s.y < -100 || s.y > 640 || s.age > 14) s.state = 'miss';
      }
    }

    function draw() {
      ctx.clearRect(0, 0, 960, 540);
      ctx.fillStyle = '#03050a'; ctx.fillRect(0, 0, 960, 540);
      drawStars(ctx, stars);
      var T = TARGETS[ti], m = muzzle();

      // the shot you wish you could take: straight to the target, into the fire
      ctx.setLineDash([3, 9]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(217,130,95,0.55)';
      var ddx = T.x - m.x, ddy = T.y - m.y, dl = Math.hypot(ddx, ddy), stop = 1;
      for (var q = 0; q < 1; q += 0.002) {
        if (Math.hypot(m.x + ddx * q - F.x, m.y + ddy * q - F.y) < HR) { stop = q; break; }
      }
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + ddx * stop, m.y + ddy * stop); ctx.stroke();
      if (stop < 1) {
        label(ctx, m.x + ddx * stop - 8, m.y + ddy * stop - 12, '✕', RUST);
      }

      // current aim ray
      ctx.strokeStyle = aiming ? 'rgba(53,224,213,0.6)' : 'rgba(53,224,213,0.28)';
      ctx.beginPath(); ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x + Math.cos(aim) * 1100, m.y + Math.sin(aim) * 1100); ctx.stroke();
      ctx.setLineDash([]);

      drawHole(ctx, F.x, F.y, HR, GLOW);

      // target: double ring
      ctx.beginPath(); ctx.arc(T.x, T.y, HIT_R, 0, TAU);
      ctx.lineWidth = flash > 0 ? 3 : 1.5;
      ctx.strokeStyle = flash > 0 ? CYAN : 'rgba(53,224,213,0.8)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(T.x, T.y, 5, 0, TAU); ctx.fillStyle = CYAN; ctx.fill();
      if (flash > 0) {
        ctx.beginPath(); ctx.arc(T.x, T.y, HIT_R + (0.8 - flash) * 70, 0, TAU);
        ctx.strokeStyle = 'rgba(53,224,213,' + flash.toFixed(2) + ')'; ctx.lineWidth = 2; ctx.stroke();
        label(ctx, T.x - 52, T.y - 44, 'DIRECT HIT', CYAN);
      }
      label(ctx, T.x - 24, T.y + 46, 'TARGET', MUTED);

      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        if (s.trail.length < 4) continue;
        ctx.beginPath(); ctx.moveTo(s.trail[0], s.trail[1]);
        for (var k = 2; k < s.trail.length; k += 2) ctx.lineTo(s.trail[k], s.trail[k + 1]);
        ctx.globalAlpha = s.state === 'fly' ? 0.95 : 0.3;
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = s.state === 'hit' ? CYAN : s.state === 'gone' ? VIOLET : INK;
        ctx.stroke(); ctx.globalAlpha = 1;
        if (s.state === 'fly') {
          ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        }
      }

      drawShip(ctx, SHIP.x, SHIP.y, aim, INK, false);
      label(ctx, 22, 518, 'drag anywhere to aim · release to fire', MUTED);
    }

    register({
      canvas: canvas, resize: S.resize,
      need: function () { return aiming || flash > 0 || shots.some(function (s) { return s.state === 'fly'; }); },
      step: step, draw: draw
    });
  })();
})();
