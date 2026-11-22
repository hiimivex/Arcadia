// Logo vectoriel + intro animée « ARCADIA » (lignes de construction, tracé des lettres, arcs qui se mettent en place).
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  return e;
}

// Mot « ARCADIA » en tracés (couleur pleine) pour la barre du haut et BigPicture
function wordmark(color) {
  const L = window.ARCADIA_LOGO;
  const svg = svgEl('svg', { viewBox: `0 0 ${L.w} ${L.h}`, role: 'img', 'aria-label': 'Arcadia' });
  for (const g of L.glyphs) {
    const grp = svgEl('g', { transform: `translate(${g.x} 664) scale(1 -1)` });
    grp.append(svgEl('path', { d: g.d, fill: color || 'currentColor' }));
    svg.append(grp);
  }
  return svg;
}

// Intro « pixel dither » : le logo puis le mot ARCADIA apparaissent en trame ordonnée (Bayer 8×8),
// les pixels s'affinent (14 → 1 px) avant de laisser place à l'image nette avec son halo.
const BAYER8 = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
  3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
const clamp01 = t => Math.max(0, Math.min(1, t));

// Dessine src en trame : b = taille d'un « pixel », reveal 0→1, jitter = décalage de lignes (glitch)
function drawDither(ctx, tmp, src, dx, dy, dw, dh, b, reveal, jitter) {
  const w = Math.max(1, Math.ceil(dw / b)), h = Math.max(1, Math.ceil(dh / b));
  tmp.width = w; tmp.height = h;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  t.clearRect(0, 0, w, h); t.imageSmoothingEnabled = true; t.drawImage(src, 0, 0, w, h);
  const img = t.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, T = (BAYER8[(y & 7) * 8 + (x & 7)] + .5) / 64;
    const a = d[i + 3] / 255;
    if (a < T + (1 - reveal)) { d[i + 3] = 0; continue; }
    // couleurs réduites à 5 niveaux, tramées elles aussi
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.floor(d[i + c] / 255 * 4 + T) / 4 * 255);
    d[i + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (!jitter) { ctx.drawImage(tmp, dx, dy, dw, dh); return; }
  const rows = 6; // bandes horizontales décalées
  for (let r = 0; r < rows; r++) {
    const sy = Math.floor(h * r / rows), sh = Math.ceil(h / rows);
    const off = (Math.random() < .35 ? (Math.random() - .5) * jitter : 0);
    ctx.drawImage(tmp, 0, sy, w, sh, dx + off, dy + dh * sy / h, dw, dh * sh / h);
  }
}

function playIntro() {
  const box = document.getElementById('intro');
  let enabled = true;
  try { enabled = localStorage.getItem('arcadia.intro') !== 'off'; } catch { /* stockage indisponible */ }
  if (!enabled) { box.classList.add('gone'); return; }
  const cv = document.createElement('canvas'); cv.className = 'intro-cv'; box.append(cv);
  const ctx = cv.getContext('2d');
  const tmp = document.createElement('canvas');
  const logo = new Image(); logo.src = 'logo.png';
  // mot ARCADIA en image (tracés vectoriels) pour pouvoir le tramer aussi
  const L = window.ARCADIA_LOGO, word = document.createElement('canvas');
  if (L) {
    word.width = 900; word.height = Math.round(900 * L.h / L.w);
    const wc = word.getContext('2d'), k = word.width / L.w;
    const grad = wc.createLinearGradient(0, 0, word.width, 0); grad.addColorStop(0, '#9fd8ff'); grad.addColorStop(.5, '#3d8bff'); grad.addColorStop(1, '#9fd8ff');
    wc.fillStyle = grad;
    for (const g of L.glyphs) { wc.save(); wc.scale(k, k); wc.translate(g.x, 664); wc.scale(1, -1); wc.fill(new Path2D(g.d)); wc.restore(); }
  }
  const sparks = Array.from({ length: 90 }, () => ({ a: Math.random() * Math.PI * 2, r: .55 + Math.random() * .5, s: 1 + Math.random() * 3, p: Math.random() }));
  let t0 = 0, raf = 0, done = false;
  const steps = [14, 10, 7, 5, 3, 2, 1];
  const blockAt = (u) => steps[Math.min(steps.length - 1, Math.floor(ease(clamp01(u)) * steps.length))];

  const frame = (now) => {
    if (done) return;
    if (!t0) t0 = now;
    const ms = now - t0, dpr = window.devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const S = Math.min(H * .40, W * .32), lx = (W - S) / 2, ly = H * .36 - S / 2;
    // étincelles qui convergent vers le logo
    const sp = clamp01(ms / 1400);
    ctx.fillStyle = '#7fd8ff';
    for (const s of sparks) {
      const k = 1 - ease(clamp01(sp * 1.2 - s.p * .3));
      if (k <= 0) continue;
      const r = S * (s.r + k * .9) * .5, x = W / 2 + Math.cos(s.a + k) * r, y = ly + S / 2 + Math.sin(s.a + k) * r;
      ctx.globalAlpha = Math.min(1, k * 2) * .9; ctx.fillRect(Math.round(x / 3) * 3, Math.round(y / 3) * 3, s.s * 2, s.s * 2);
    }
    ctx.globalAlpha = 1;
    // logo : trame 0 → 1,3 s, puis image nette
    if (logo.complete && logo.naturalWidth) {
      const u = ms / 1300;
      const crisp = clamp01((ms - 1150) / 350);
      if (crisp < 1) drawDither(ctx, tmp, logo, lx, ly, S, S, blockAt(u), ease(clamp01(u * 1.25)), ms < 700 ? S * .06 : 0);
      if (crisp > 0) { ctx.globalAlpha = crisp; ctx.imageSmoothingEnabled = true; ctx.drawImage(logo, lx, ly, S, S); ctx.globalAlpha = 1; }
    }
    // mot ARCADIA : 0,95 → 2,1 s
    if (L) {
      const ww = Math.min(W * .24, 400), wh = ww * word.height / word.width, wx = (W - ww) / 2, wy = ly + S + H * .03;
      const u = (ms - 950) / 1000, crisp = clamp01((ms - 1900) / 300);
      if (u > 0 && crisp < 1) drawDither(ctx, tmp, word, wx, wy, ww, wh, blockAt(u), ease(clamp01(u * 1.3)), u < .4 ? ww * .03 : 0);
      if (crisp > 0) { ctx.globalAlpha = crisp; ctx.imageSmoothingEnabled = true; ctx.drawImage(word, wx, wy, ww, wh); ctx.globalAlpha = 1; }
      // slogan
      const ta = clamp01((ms - 2050) / 450);
      if (ta > 0) {
        ctx.globalAlpha = ta; ctx.fillStyle = '#8fb4ff'; ctx.textAlign = 'center';
        ctx.font = `600 ${Math.round(Math.max(13, ww * .045))}px "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif`;
        ctx.letterSpacing = `${Math.round(ww * .02)}px`;
        ctx.fillText('TA BIBLIOTHÈQUE DE JEUX', W / 2, wy + wh + H * .05); ctx.globalAlpha = 1;
      }
    }
    if (ms > 3000) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  const finish = () => {
    if (done) return; done = true; cancelAnimationFrame(raf);
    box.classList.add('out');
    setTimeout(() => { box.classList.add('gone'); cv.remove(); }, 600);
    removeEventListener('keydown', finish, true); removeEventListener('mousedown', finish, true);
  };
  addEventListener('keydown', finish, true);
  addEventListener('mousedown', finish, true);
  window.__introAt = ms => { t0 = performance.now() - ms; }; // pour les captures de test
  raf = requestAnimationFrame(frame);
}

function mountWordmarks() {
  document.querySelectorAll('.brand-word, #bp-brand').forEach(n => {
    if (n.firstChild) return;
    if (n.id === 'bp-brand') { const i = document.createElement('img'); i.src = 'logo-128.png'; i.className = 'bp-logo'; i.alt = ''; n.append(i); }
    n.append(wordmark('#fff'));
  });
}

mountWordmarks();
playIntro();
