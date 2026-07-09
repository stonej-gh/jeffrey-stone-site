/* Keplerian-orbit hero: a ship rides a real ellipse around the singularity -
   the game's own motif (cyan "YOUR PATH" trail + dashed guide orbit).
   No-ops on pages that don't include a #orbit canvas. */
(function () {
  var canvas = document.getElementById('orbit');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var stars = [];

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = [];
    var n = Math.round((W * H) / 11000);   // a touch denser (was /14000) so the field reads
    for (var i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + 0.25, a: Math.random() * 0.6 + 0.22 });
    }
  }

  // Orbit geometry: black hole (focus) sits left-of-center; ship rides a Keplerian ellipse.
  function focusPt() { return { x: W * (W < 640 ? 0.5 : 0.34), y: H * 0.46 }; }
  // Orbit size: widened to show off the ellipse more (was 0.34 / 0.30).
  function scale() { return Math.min(W, H) * (W < 640 ? 0.40 : 0.38); }
  var a = 1.0, e = 0.52, b = a * Math.sqrt(1 - e * e);
  var rot = -0.35;                 // ellipse tilt
  var cr = Math.cos(rot), sr = Math.sin(rot);
  var M = 0;                       // mean anomaly
  var trail = [];
  var last = null;

  // solve Kepler: E - e sinE = M
  function eccentricAnomaly(m) {
    var E = m;
    for (var i = 0; i < 6; i++) { E = E - (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E)); }
    return E;
  }

  // position on ellipse with focus at origin (unit scale), rotated
  function posAt(m) {
    var E = eccentricAnomaly(m);
    var x = a * (Math.cos(E) - e);   // focus-centered
    var y = b * Math.sin(E);
    return { x: x * cr - y * sr, y: x * sr + y * cr };
  }

  function drawGuide(f, s) {
    // faint dashed "guide orbit" - the ideal ellipse
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(-a * e * s, 0, a * s, b * s, 0, 0, Math.PI * 2);
    ctx.setLineDash([2, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(220,228,240,0.22)';   // slightly brighter guide (was 0.16)
    ctx.stroke();
    ctx.restore();
  }

  function drawHole(f) {
    var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 130);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(6,8,14,0.96)');
    g.addColorStop(0.72, 'rgba(106,63,176,0.30)');   // richer violet accretion glow (was 0.22)
    g.addColorStop(1, 'rgba(106,63,176,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(f.x, f.y, 130, 0, Math.PI * 2); ctx.fill();
    // event horizon rim
    ctx.beginPath(); ctx.arc(f.x, f.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#05060a'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(53,224,213,0.25)'; ctx.stroke();
  }

  function frame(dt) {
    var f = focusPt(), s = scale();
    ctx.clearRect(0, 0, W, H);

    // stars
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = st.a; ctx.fillStyle = '#cdd6e6';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawGuide(f, s);
    drawHole(f);

    // advance ship (variable speed via Kepler - faster near the hole)
    M += dt * 0.55;
    var p = posAt(M);
    var sx = f.x + p.x * s, sy = f.y + p.y * s;
    trail.push({ x: sx, y: sy });
    if (trail.length > 150) trail.shift();

    // YOUR PATH - cyan fading trail
    for (var j = 1; j < trail.length; j++) {
      var t = j / trail.length;
      ctx.beginPath();
      ctx.moveTo(trail[j - 1].x, trail[j - 1].y);
      ctx.lineTo(trail[j].x, trail[j].y);
      ctx.strokeStyle = 'rgba(53,224,213,' + (t * 0.9).toFixed(3) + ')';
      ctx.lineWidth = t * 2.4 + 0.2;
      ctx.stroke();
    }

    // the ship
    var ang = last ? Math.atan2(sy - last.y, sx - last.x) : 0;
    last = { x: sx, y: sy };
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-5, 4); ctx.lineTo(-3, 0); ctx.lineTo(-5, -4); ctx.closePath();
    ctx.fillStyle = '#eef4ff'; ctx.fill();
    ctx.shadowColor = 'rgba(53,224,213,0.9)'; ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
  }

  var prev = 0;
  function loop(ts) {
    var dt = prev ? Math.min((ts - prev) / 1000, 0.05) : 0.016; prev = ts;
    frame(dt);
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize);
  if (reduce) {
    // static frame: draw a good moment and stop
    M = 2.1; frame(0.016); frame(0);
  } else {
    requestAnimationFrame(loop);
  }
})();
