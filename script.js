(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GLYPHS = '01<>/\\|_#$%&*+=:;';
  const rand = (n) => Math.floor(Math.random() * n);
  const randGlyph = () => GLYPHS[rand(GLYPHS.length)];
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- Binary rain ---------- */
  function createRain(canvas, { size = 16, step = 55, fade = 0.12, alpha = 1 } = {}) {
    const ctx = canvas.getContext('2d');
    let cols = [], w = 0, h = 0, fs = size, last = 0, raf = 0, running = false;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fs = Math.max(11, Math.round(size * Math.min(w / 1440, 1.2) + 4));
      const n = Math.ceil(w / fs);
      cols = Array.from({ length: n }, (_, i) => cols[i] || {
        y: rand(h / fs) - h / fs * 0.3,
        speed: 0.45 + Math.random() * 0.75
      });
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (t - last < step) return;
      last = t;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
      ctx.textBaseline = 'top';
      cols.forEach((c, i) => {
        const prev = Math.floor(c.y);
        c.y += c.speed;
        const row = Math.floor(c.y);
        if (row === prev) return;
        const bright = Math.random() < 0.06;
        ctx.fillStyle = bright ? `rgba(210,255,220,${alpha})` : `rgba(0,255,65,${alpha * (0.5 + Math.random() * 0.5)})`;
        ctx.fillText(Math.random() < 0.5 ? '0' : '1', i * fs, row * fs);
        if (row * fs > h && Math.random() > 0.96) { c.y = -rand(20); c.speed = 0.45 + Math.random() * 0.75; }
      });
    }

    resize();
    window.addEventListener('resize', resize);
    return {
      start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
      stop() { running = false; cancelAnimationFrame(raf); }
    };
  }

  /* ---------- Text scramble / decode ---------- */
  function textNodes(el) {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) out.push(walk.currentNode);
    return out;
  }

  function decode(el, duration = 900) {
    const nodes = textNodes(el);
    nodes.forEach((n) => { if (n._orig == null) n._orig = n.nodeValue; });
    const total = nodes.reduce((s, n) => s + n._orig.length, 0);
    if (reduceMotion) { nodes.forEach((n) => (n.nodeValue = n._orig)); return; }
    cancelAnimationFrame(el._decodeRaf);
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      let revealed = Math.floor(p * total);
      nodes.forEach((n) => {
        const o = n._orig;
        let s = '';
        for (let i = 0; i < o.length; i++) {
          s += revealed > 0 || o[i] === ' ' ? o[i] : randGlyph();
          revealed--;
        }
        n.nodeValue = s;
      });
      if (p < 1) el._decodeRaf = requestAnimationFrame(tick);
    };
    el._decodeRaf = requestAnimationFrame(tick);
  }

  document.querySelectorAll('[data-scramble]').forEach((el) => {
    el.addEventListener('mouseenter', () => decode(el, 380));
  });

  /* ---------- Shared ASCII engine ---------- */
  const RAMP = ' .,:;-=+*%#@';
  const GREENS = ['#06401a', '#0a7a2c', '#10b83f', '#00ff41', '#8dffad', '#e6ffee'];

  // Size a canvas to its CSS box and work out the character grid for a font size
  function asciiSurface(canvas, fontSize) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fs = fontSize(w, h);
    ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
    const cw = ctx.measureText('M').width;
    const cols = Math.max(1, Math.floor(w / cw)), rows = Math.max(1, Math.floor(h / fs));
    return { ctx, w, h, fs, cw, cols, rows };
  }

  // Source rectangle that "covers" a cols x rows grid of cw x fs cells.
  // fy = vertical anchor (like object-position), zoom = extra scale about that anchor.
  function coverRect(srcW, srcH, s, fy = 0.5, zoom = 1) {
    const ta = (s.cols * s.cw) / (s.rows * s.fs), va = srcW / srcH;
    let r;
    if (va > ta) { const sw = srcH * ta; r = [(srcW - sw) / 2, 0, sw, srcH]; }
    else { const sh = srcW / ta; r = [0, (srcH - sh) * fy, srcW, sh]; }
    if (zoom === 1) return r;
    const zw = r[2] / zoom, zh = r[3] / zoom;
    return [r[0] + (r[2] - zw) / 2, r[1] + (r[3] - zh) * fy, zw, zh];
  }

  const sampler = document.createElement('canvas');
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  // Draw a source region onto a cols x rows grid and return its pixels
  function samplePixels(src, rect, cols, rows) {
    if (sampler.width !== cols || sampler.height !== rows) { sampler.width = cols; sampler.height = rows; }
    sctx.clearRect(0, 0, cols, rows);
    sctx.drawImage(src, rect[0], rect[1], rect[2], rect[3], 0, 0, cols, rows);
    return sctx.getImageData(0, 0, cols, rows).data;
  }

  // Luminance grid -> chars + shade buckets
  function toGrid(px, cols, rows, { lift = 0.06, gain = 1.4, alpha = false, keyWhite = false } = {}) {
    const n = cols * rows, ch = new Array(n), bk = new Uint8Array(n), lum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      let l = (0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2]) / 255;
      if (alpha) l *= px[p + 3] / 255;
      // studio shots on white: treat near-white, colourless pixels as empty background
      if (keyWhite && l > 0.88 && Math.max(px[p], px[p + 1], px[p + 2]) - Math.min(px[p], px[p + 1], px[p + 2]) < 30) l = 0;
      l = clamp01((l - lift) * gain);
      lum[i] = l;
      ch[i] = RAMP[Math.floor(l * (RAMP.length - 1))];
      bk[i] = Math.min(5, Math.floor(l * 6));
    }
    return { ch, bk, lum };
  }

  // Paint a grid in one fillText per row per shade (bold = double-strike for heavier glyphs)
  function paintGrid(s, ch, bk, shades, bold = false) {
    const { ctx, w, h, fs, cols, rows } = s;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
    ctx.textBaseline = 'top';
    for (let k = 0; k < shades.length; k++) {
      ctx.fillStyle = shades[k];
      for (let r = 0; r < rows; r++) {
        let line = '', any = false;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (bk[i] === k && ch[i] !== ' ') { line += ch[i]; any = true; } else line += ' ';
        }
        if (any) {
          ctx.fillText(line, 0, r * fs);
          if (bold) ctx.fillText(line, 0.8, r * fs);
        }
      }
    }
  }

  // Run fn on a ~fps loop only while el is on screen
  function whileVisible(el, fps, fn, threshold = 0.05) {
    let on = false, last = 0;
    const loop = (t) => {
      if (!on) return;
      requestAnimationFrame(loop);
      if (t - last < 1000 / fps) return;
      last = t;
      fn(t);
    };
    new IntersectionObserver(([e]) => {
      const was = on;
      on = e.isIntersecting;
      if (on && !was) requestAnimationFrame(loop);
    }, { threshold }).observe(el);
  }

  /* ---------- ASCII torus (hero card) ---------- */
  const asciiEl = document.getElementById('ascii');
  const SHAPES = [
    { R1: 1, R2: 2, chars: '.,-~:;=!*#$@' },
    { R1: 0.6, R2: 1.6, chars: ' .:01' },
    { R1: 1.25, R2: 1.25, chars: '.:-=+*%#@' }
  ];
  let shape = SHAPES[0];

  function startTorus() {
    const W = 38, H = 24, K2 = 5, ASPECT = 1.9;
    let A = 0.6, B = 0.2, last = 0;
    const out = new Array(W * H), zbuf = new Float32Array(W * H);

    function render(t) {
      requestAnimationFrame(render);
      if (t - last < 33) return;
      last = t;
      const { R1, R2, chars } = shape;
      const K1 = (W * K2 * 3) / (8 * (R1 + R2));
      out.fill(' '); zbuf.fill(0);
      const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
      for (let th = 0; th < 6.283; th += 0.07) {
        const ct = Math.cos(th), st = Math.sin(th);
        for (let ph = 0; ph < 6.283; ph += 0.02) {
          const cp = Math.cos(ph), sp = Math.sin(ph);
          const cx = R2 + R1 * ct, cy = R1 * st;
          const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
          const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
          const ooz = 1 / (K2 + cA * cx * sp + cy * sA);
          const xp = Math.floor(W / 2 + K1 * ooz * x);
          const yp = Math.floor(H / 2 - (K1 / ASPECT) * ooz * y);
          if (xp < 0 || xp >= W || yp < 0 || yp >= H) continue;
          const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
          const idx = xp + W * yp;
          if (L > 0 && ooz > zbuf[idx]) {
            zbuf[idx] = ooz;
            out[idx] = chars[Math.min(chars.length - 1, Math.floor((L / 1.42) * chars.length))];
          }
        }
      }
      let s = '';
      for (let r = 0; r < H; r++) s += out.slice(r * W, r * W + W).join('') + '\n';
      asciiEl.textContent = s;
      A += 0.045; B += 0.022;
    }
    requestAnimationFrame(render);
  }

  /* ---------- Card slides ---------- */
  const slides = ['Follow the white rabbit.', 'Bend the code, not the rules.', 'Design to explore.'];
  let slide = 0;
  const titleEl = document.getElementById('cardTitle');
  const indexEl = document.getElementById('cardIndex');
  const dots = document.querySelectorAll('.card__progress i');
  function goTo(n) {
    slide = (n + slides.length) % slides.length;
    shape = SHAPES[slide];
    titleEl.textContent = slides[slide];
    indexEl.textContent = `0${slide + 1} / 0${slides.length}`;
    dots.forEach((d, i) => d.classList.toggle('is-on', i === slide));
    decode(titleEl, 600);
  }
  document.querySelectorAll('.card__arrows button').forEach((b) =>
    b.addEventListener('click', () => goTo(slide + Number(b.dataset.dir)))
  );
  let autoplay = setInterval(() => goTo(slide + 1), 6000);
  document.querySelector('.card').addEventListener('mouseenter', () => clearInterval(autoplay));

  /* ---------- Hero subject switcher ---------- */
  const models = document.getElementById('models');
  const subjectTabs = document.querySelectorAll('.subject button');
  function setSubject(n, animate) {
    models.dataset.subject = n;
    subjectTabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.subject === n)));
    if (animate && !reduceMotion) {
      models.classList.remove('is-swapping');
      void models.offsetWidth;
      models.classList.add('is-swapping');
    }
  }
  subjectTabs.forEach((t) => t.addEventListener('click', () => setSubject(t.dataset.subject, true)));
  models.addEventListener('animationend', () => models.classList.remove('is-swapping'));

  /* ---------- Hero light / dark ---------- */
  const hero = document.querySelector('.hero');
  const themeBtn = document.getElementById('themeBtn');
  const themeLabel = document.getElementById('themeLabel');
  function setHeroTheme(light, animate) {
    hero.classList.toggle('is-light', light);
    themeBtn.setAttribute('aria-pressed', String(light));
    themeBtn.setAttribute('aria-label', `Switch hero to ${light ? 'dark' : 'light'} theme`);
    themeLabel.textContent = light ? 'DARK' : 'LIGHT';
    if (animate && !reduceMotion) {
      hero.classList.remove('is-flipping');
      void hero.offsetWidth;
      hero.classList.add('is-flipping');
      document.querySelectorAll('.headline [data-decode]').forEach((el, i) => setTimeout(() => decode(el, 500), i * 80));
    }
    try { localStorage.setItem('matrix-hero-theme', light ? 'light' : 'dark'); } catch (e) {}
  }
  themeBtn.addEventListener('click', () => setHeroTheme(!hero.classList.contains('is-light'), true));
  hero.addEventListener('animationend', (e) => { if (e.target === hero) hero.classList.remove('is-flipping'); });
  try { if (localStorage.getItem('matrix-hero-theme') === 'light') setHeroTheme(true, false); } catch (e) {}

  /* ---------- Clock + latency ---------- */
  const clockEl = document.getElementById('clock');
  const tzLabel = document.querySelector('.timezone__label');
  function tickClock() {
    const d = new Date();
    clockEl.innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} <i>·</i> ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
  const off = -new Date().getTimezoneOffset() / 60;
  tzLabel.textContent = `SYS.TIME // UTC${off >= 0 ? '+' : ''}${off}`;
  tickClock(); setInterval(tickClock, 1000);

  const latencyEl = document.getElementById('latency');
  setInterval(() => { latencyEl.textContent = 9 + rand(16); }, 1500);

  /* ---------- Section titles decode on first view ---------- */
  const titleObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.querySelectorAll('[data-decode]').forEach((el, i) => setTimeout(() => decode(el, 700), i * 160));
      titleObs.unobserve(e.target);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.sec-title').forEach((t) => titleObs.observe(t));

  /* ---------- 02: Bullet time — ASCII video ---------- */
  (function bulletTime() {
    const screen = document.getElementById('screen');
    const video = document.getElementById('bulletVideo');
    const canvas = document.getElementById('bulletAscii');
    const FPS = 24;
    const tc = document.getElementById('timecode');
    const frameNo = document.getElementById('frameNo');
    const progress = document.getElementById('videoProgress');
    const density = document.getElementById('densityLabel');
    let s = null, inView = false, last = 0;

    function resize() {
      s = asciiSurface(canvas, (w) => Math.max(7, Math.min(12, w / 150)));
      density.textContent = `${s.cols} × ${s.rows} cols`;
    }

    function draw() {
      if (!video.videoWidth || !s) return;
      // the clip has letterbox bars baked in: only sample the 2.39:1 picture area
      const vw = video.videoWidth, vh = Math.min(video.videoHeight, vw / 2.39);
      const top = (video.videoHeight - vh) / 2;
      const rect = coverRect(vw, vh, s);
      rect[1] += top;
      const g = toGrid(samplePixels(video, rect, s.cols, s.rows), s.cols, s.rows);
      paintGrid(s, g.ch, g.bk, GREENS);
    }

    function hud() {
      const t = video.currentTime || 0;
      const abs = 21 + t;
      tc.textContent = `00:00:${pad(Math.floor(abs))}:${pad(Math.floor((abs % 1) * FPS))}`;
      frameNo.textContent = String(Math.floor(t * FPS)).padStart(4, '0');
      if (video.duration) progress.style.width = (t / video.duration) * 100 + '%';
    }

    function loop(now) {
      if (!inView) return;
      requestAnimationFrame(loop);
      if (now - last < 1000 / 30) return;
      last = now;
      if (screen.dataset.mode !== 'raw') draw();
      hud();
    }

    function setPlaying(on) {
      if (on) { video.play().catch(() => {}); } else { video.pause(); }
    }

    new IntersectionObserver(([entry]) => {
      const was = inView;
      inView = entry.isIntersecting;
      if (inView && !was) {
        if (!reduceMotion) setPlaying(true);
        requestAnimationFrame(loop);
      } else if (!inView) {
        setPlaying(false);
      }
    }, { threshold: 0.2 }).observe(screen);

    document.querySelectorAll('.modes button').forEach((btn) => {
      btn.addEventListener('click', () => {
        screen.dataset.mode = btn.dataset.mode;
        document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('is-on', b === btn));
        if (btn.dataset.mode !== 'raw') draw();
      });
    });

    const soundBtn = document.getElementById('soundBtn');
    soundBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      soundBtn.setAttribute('aria-pressed', String(!video.muted));
      soundBtn.textContent = `SOUND: ${video.muted ? 'OFF' : 'ON'}`;
      if (!video.muted) setPlaying(true);
    });

    // Click the footage to pause / resume
    canvas.addEventListener('click', () => setPlaying(video.paused));
    video.addEventListener('loadeddata', () => { draw(); hud(); });
    window.addEventListener('resize', () => { resize(); draw(); });
    resize();
    document.fonts && document.fonts.ready.then(() => { resize(); draw(); });
  })();

  /* ---------- 03: Red / blue pill — ray-traced ASCII capsules ---------- */
  (function pills() {
    const PALETTES = {
      red:  ['#3a0606', '#7a0d0d', '#c4161c', '#ff2a2a', '#ff8a80', '#ffe3e0'],
      blue: ['#061a3a', '#0d3a7a', '#1663c4', '#2a8cff', '#8cc4ff', '#e3f1ff']
    };
    const HALF = 0.72, RAD = 0.56;          // capsule: segment half-length + radius
    const L = norm([-0.55, 0.65, -0.6]);    // light, pointing toward the viewer
    const Hv = norm([L[0], L[1], L[2] - 1]); // half vector with view dir (0,0,-1)

    function norm(v) { const m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; }

    // Ray / capsule intersection (segment along y from -HALF to HALF), returns t or -1
    function hitCapsule(ox, oy, oz, dx, dy, dz) {
      const bay = 2 * HALF, baba = bay * bay;
      const oax = ox, oay = oy + HALF, oaz = oz;
      const bard = bay * dy, baoa = bay * oay;
      const rdoa = dx * oax + dy * oay + dz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
      const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - RAD * RAD * baba;
      let h = b * b - a * c;
      if (h >= 0) {
        const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
        if (y > 0 && y < baba) return t;
        // end caps
        const cy = y <= 0 ? oay : oy - HALF;
        const b2 = dx * ox + dy * cy + dz * oz, c2 = ox * ox + cy * cy + oz * oz - RAD * RAD;
        h = b2 * b2 - c2;
        if (h > 0) return -b2 - Math.sqrt(h);
      }
      return -1;
    }

    function createPill(article, color, dir) {
      const canvas = article.querySelector('.pill__ascii');
      const shades = PALETTES[color];
      const HOT_RAMP = '=*#@';               // heavy glyphs for the black-on-colour hover state
      let s = null, spin = Math.random() * 6, roll = 0, speed = 1, target = 1, lastT = 0, hot = false, zoom = 1;

      const resize = () => { s = asciiSurface(canvas, (w) => Math.max(7, Math.min(11, w / 60))); };

      function render(t) {
        const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
        lastT = t;
        speed += (target - speed) * 0.08;
        spin += dt * speed * 0.9 * dir;   // turntable: the tilted pill swings around the vertical through its centre
        roll += dt * speed * 2.4 * dir;   // and rolls about its own long axis (the stripe makes this visible)
        const { cols, rows, cw, fs, w, h } = s;
        const wobble = 0.3 * Math.sin(t * 0.0007), tilt = 1.05 * dir;
        // world = Ry(spin) * Rx(wobble) * Rz(tilt) * Ry(roll) * object
        const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
        const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
        const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
        const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
        const R = mul(rotY(spin), mul(rotX(wobble), mul(rotZ(tilt), rotY(roll))));
        const toObj = (v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];
        const d = toObj([0, 0, 1]), Lo = toObj(L), Ho = toObj(Hv);
        const isHot = hot || article.classList.contains('is-chosen');
        zoom += ((isHot ? 1.14 : 1) - zoom) * 0.15;
        const scale = (Math.min(w, h) / 2 / 1.38) * zoom;

        const n = cols * rows, ch = new Array(n), bk = new Uint8Array(n);
        for (let r = 0; r < rows; r++) {
          const wy = (h / 2 - (r + 0.5) * fs) / scale;
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const wx = ((c + 0.5) * cw - w / 2) / scale;
            const o = toObj([wx, wy, -4]);
            const tHit = hitCapsule(o[0], o[1], o[2], d[0], d[1], d[2]);
            if (tHit < 0) { ch[i] = ' '; continue; }
            const px = o[0] + tHit * d[0], py = o[1] + tHit * d[1], pz = o[2] + tHit * d[2];
            const qy = Math.max(-HALF, Math.min(HALF, py));
            const nx = px / RAD, ny = (py - qy) / RAD, nz = pz / RAD;
            const diff = Math.max(0, nx * Lo[0] + ny * Lo[1] + nz * Lo[2]);
            const spec = Math.pow(Math.max(0, nx * Ho[0] + ny * Ho[1] + nz * Ho[2]), 28);
            let lum = 0.1 + 0.68 * diff + 0.7 * spec;
            if (Math.abs(py) < 0.035) lum *= 0.35;        // seam between the two halves
            else if (py < 0) lum *= 0.78;                  // two-tone capsule
            if (pz < 0 && Math.abs(px) < RAD * 0.22) lum *= 0.38; // printed stripe down one side
            lum = clamp01(lum);
            if (isHot) { ch[i] = HOT_RAMP[Math.min(3, Math.floor(lum * 4))]; bk[i] = 0; continue; }
            ch[i] = RAMP[Math.max(1, Math.floor(lum * (RAMP.length - 1)))];
            bk[i] = Math.min(5, Math.floor(lum * 6));
          }
        }
        if (isHot) paintGrid(s, ch, bk, ['#000'], true);
        else paintGrid(s, ch, bk, shades);
      }

      article.addEventListener('mouseenter', () => { target = 1.8; hot = true; });
      article.addEventListener('mouseleave', () => { target = 1; hot = false; });
      window.addEventListener('resize', resize);
      resize();
      document.fonts && document.fonts.ready.then(resize);
      whileVisible(canvas, 30, render);
      return { boost() { target = 6; setTimeout(() => (target = 1), 900); } };
    }

    const section = document.getElementById('choice');
    const result = document.getElementById('choiceResult');
    const pillsBy = {};
    section.querySelectorAll('.pill').forEach((a) => {
      const color = a.dataset.pill;
      pillsBy[color] = createPill(a, color, color === 'red' ? 1 : -1);
    });

    section.querySelectorAll('[data-choose]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const color = btn.dataset.choose;
        section.classList.add('is-chosen');
        section.querySelectorAll('.pill').forEach((p) => p.classList.toggle('is-chosen', p.dataset.pill === color));
        pillsBy[color].boost();
        result.className = `choice__result is-${color}`;
        result.textContent = color === 'red'
          ? '> red pill accepted. Decrypting the crew manifest...'
          : '> blue pill accepted. Restoring comfortable defaults...';
        decode(result, 700);
        await sleep(1500);
        if (color === 'red') document.getElementById('crew').scrollIntoView({ behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  })();

  /* ---------- 04: Crew — ASCII portraits, real photo on hover ---------- */
  (function crew() {
    const PLACEHOLDER = 'images/crew/placeholder.svg';
    const members = [...document.querySelectorAll('.member')].map((el) => {
      const img = el.querySelector('img');
      const m = {
        el, img, canvas: el.querySelector('.member__ascii'), s: null, grid: null,
        zoom: Number(el.dataset.zoom) || 1, fy: el.dataset.fy != null ? Number(el.dataset.fy) : 0.5,
        keyWhite: el.dataset.key === 'white'
      };
      // the photo uses the same framing as the ASCII (see .member__media img)
      el.style.setProperty('--zoom', m.zoom);
      el.style.setProperty('--fy', m.fy * 100 + '%');
      const fallback = () => { if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = PLACEHOLDER; } };
      img.addEventListener('error', fallback);
      img.addEventListener('load', () => build(m));
      if (img.complete) img.naturalWidth ? build(m) : fallback();
      // tap to reveal on touch screens
      el.addEventListener('click', () => el.classList.toggle('is-revealed'));
      return m;
    });

    function build(m) {
      if (!m.img.naturalWidth) return;
      m.s = asciiSurface(m.canvas, (w) => Math.max(6, Math.min(10, w / 42)));
      const rect = coverRect(m.img.naturalWidth, m.img.naturalHeight, m.s, m.fy, m.zoom);
      m.grid = toGrid(samplePixels(m.img, rect, m.s.cols, m.s.rows), m.s.cols, m.s.rows, { lift: 0.05, gain: 1.5, keyWhite: m.keyWhite });
    }

    // repaint with a little binary shimmer so the portraits feel alive
    function render() {
      members.forEach((m) => {
        if (!m.grid || m.el.matches(':hover')) return;
        const { ch, bk } = m.grid;
        const c2 = ch.slice(), b2 = bk.slice();
        for (let k = 0; k < c2.length * 0.03; k++) {
          const i = rand(c2.length);
          if (c2[i] !== ' ') { c2[i] = Math.random() < 0.5 ? '0' : '1'; b2[i] = 4; }
        }
        paintGrid(m.s, c2, b2, GREENS);
      });
    }

    window.addEventListener('resize', () => members.forEach(build));
    document.fonts && document.fonts.ready.then(() => members.forEach(build));
    whileVisible(document.querySelector('.crew__grid'), 10, render);
  })();

  /* ---------- 05: Exit — ASCII wordmark sweeps in, then shimmers ---------- */
  (function outro() {
    const canvas = document.getElementById('outroAscii');
    const img = document.getElementById('outroSrc');
    const clock = document.getElementById('outroClock');
    let s = null, g = null, thr = null, started = 0;

    function build() {
      if (!img.naturalWidth) return;
      s = asciiSurface(canvas, (w) => Math.max(6, w / 150));
      g = toGrid(samplePixels(img, [0, 0, img.naturalWidth, img.naturalHeight], s.cols, s.rows), s.cols, s.rows, { lift: 0.04, gain: 1.25, alpha: true });
      thr = new Float32Array(s.cols * s.rows);
      for (let i = 0; i < thr.length; i++) thr[i] = 0.82 * ((i % s.cols) / s.cols) + 0.16 * Math.random();
    }

    function render(t) {
      if (!g) return;
      started = started || t;
      const p = reduceMotion ? 1.03 : Math.min(1.03, (t - started) / 1600);
      const n = thr.length, ch = new Array(n), bk = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (g.lum[i] < 0.05) { ch[i] = ' '; continue; }
        if (thr[i] <= p - 0.03) {
          // settled: mostly the real glyph, with a faint binary flicker
          if (Math.random() < 0.02) { ch[i] = Math.random() < 0.5 ? '0' : '1'; bk[i] = 4; }
          else { ch[i] = g.ch[i]; bk[i] = g.bk[i]; }
        }
        else if (thr[i] <= p) { ch[i] = randGlyph(); bk[i] = 5; }
        else { ch[i] = Math.random() < 0.5 ? '0' : '1'; bk[i] = 1; }
      }
      paintGrid(s, ch, bk, GREENS);
    }

    img.complete ? build() : img.addEventListener('load', build);
    window.addEventListener('resize', build);
    document.fonts && document.fonts.ready.then(build);
    whileVisible(canvas, 14, render, 0.2);
    setInterval(() => { const d = new Date(); clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }, 1000);
  })();

  /* ---------- Hero entrance: one item at a time ---------- */
  const heroRain = createRain(document.getElementById('rain'), { size: 15, step: 60, fade: 0.1 });
  function revealSite() {
    document.body.classList.remove('is-loading');
    heroRain.start();
    startTorus();

    const items = [...document.querySelectorAll('.hero [data-seq]')]
      .sort((a, b) => a.dataset.seq - b.dataset.seq);
    const STEP = reduceMotion ? 0 : 110;
    items.forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('is-in');
        if (el.hasAttribute('data-decode')) decode(el, 650);
      }, 150 + i * STEP);
    });
    // the model (last item) arrives lit; a second after it settles, it falls into shadow
    const modelIn = 150 + (items.length - 1) * STEP + 700;
    setTimeout(() => setSubject('2', true), modelIn + 1000);
  }

  /* ---------- Preloader: wordmark assembles in ASCII ---------- */
  const loader = document.getElementById('loader');
  const pageLoaded = new Promise((r) => (document.readyState === 'complete' ? r() : window.addEventListener('load', r)));

  async function runLoader() {
    if (reduceMotion) { loader.classList.add('is-gone'); revealSite(); return; }

    const loaderRain = createRain(document.getElementById('loaderRain'), { size: 18, step: 40, fade: 0.08, alpha: 0.6 });
    loaderRain.start();

    const canvas = document.getElementById('loaderAscii');
    const img = loader.querySelector('.loader__img');
    const pct = document.getElementById('loaderPct');
    const status = document.getElementById('loaderStatus');

    await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), sleep(1200)]);
    await (img.decode ? img.decode().catch(() => {}) : Promise.resolve());

    const s = asciiSurface(canvas, (w) => Math.max(5, w / 120));
    const g = toGrid(samplePixels(img, [0, 0, img.naturalWidth || 1, img.naturalHeight || 1], s.cols, s.rows), s.cols, s.rows, { lift: 0.04, gain: 1.25, alpha: true });
    // each cell resolves at its own moment: a left-to-right sweep with some noise
    const thr = new Float32Array(s.cols * s.rows);
    for (let i = 0; i < thr.length; i++) thr[i] = 0.82 * ((i % s.cols) / s.cols) + 0.16 * Math.random();

    const ch = new Array(thr.length), bk = new Uint8Array(thr.length);
    function frame(p) {
      for (let i = 0; i < thr.length; i++) {
        if (g.lum[i] < 0.05) { ch[i] = ' '; continue; }
        if (thr[i] <= p - 0.03) { ch[i] = g.ch[i]; bk[i] = g.bk[i]; }
        else if (thr[i] <= p) { ch[i] = randGlyph(); bk[i] = 5; }          // bright leading edge
        else { ch[i] = Math.random() < 0.5 ? '0' : '1'; bk[i] = Math.random() < 0.15 ? 2 : 1; }
      }
      paintGrid(s, ch, bk, GREENS);
      pct.textContent = String(Math.round(p * 100)).padStart(3, '0');
    }

    // Time-based progress: sweep to 90%, hold until the page has loaded, then finish
    let loaded = false;
    pageLoaded.then(() => { loaded = true; });
    const start = performance.now();
    let held = 0, p = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const t = performance.now() - start;
        if (p < 0.9) p = Math.min(0.9, 1 - Math.pow(1 - Math.min(1, t / 2000), 2));
        else if (loaded) { held = held || performance.now(); p = Math.min(1.03, 0.9 + (performance.now() - held) / 450 * 0.13); }
        if (p >= 0.9 && !loaded) status.textContent = 'Awaiting assets';
        frame(Math.min(p, 1.03));
        p >= 1.03 ? resolve() : setTimeout(tick, 33);
      };
      tick();
    });

    pct.textContent = '100';
    status.textContent = 'Signal locked';
    loader.classList.add('is-complete');
    await sleep(900);

    loader.classList.add('is-done');
    revealSite();
    await sleep(1200);
    loaderRain.stop();
    loader.classList.add('is-gone');
  }

  runLoader();
})();
