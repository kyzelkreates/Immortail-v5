// IMMORTAIL™ Animator v2
// Canvas compositor: user assets → AI virtual copy → procedural SVG fallback
// Supports environments: park, home, space, rain, night, snow, beach
// Each environment renders a parallax scene behind the dog

const FPS          = 18;
const BLEND_FRAMES = 10;

// ── State ──────────────────────────────────────────────────────────────────
let _canvas = null, _ctx = null, _rafId = null;
let _cur = 'idle', _next = null, _blending = false, _blendF = 0;
let _lastTs = 0;
let _currentEnv      = 'home';
let _envOffset       = 0;
let _particles       = [];
let _timeOfDay       = 12; // 0-23
let _weatherIntensity = 2;  // 1-3

const _exprAssets = {
  idle:    { video: null, bitmap: null },
  happy:   { video: null, bitmap: null },
  sad:     { video: null, bitmap: null },
  excited: { video: null, bitmap: null }
};
const _faceAssets = { idle: null, happy: null, sad: null, excited: null };

// Procedural motion per expression
const MOTION = {
  idle:    t => ({ tx: 0,              ty: Math.sin(t * 1.1) * 4,              s: 1 + Math.sin(t * 1.1) * 0.009 }),
  happy:   t => ({ tx: 0,              ty: -Math.abs(Math.sin(t * 3.2)) * 10,  s: 1 + Math.sin(t * 3.2) * 0.018 }),
  sad:     t => ({ tx: 0,              ty: Math.sin(t * 0.5) * 3 + 8,          s: 0.96 + Math.sin(t * 0.5) * 0.006 }),
  excited: t => ({ tx: Math.sin(t * 16) * 7, ty: -Math.abs(Math.sin(t * 8)) * 14, s: 1 + Math.abs(Math.sin(t * 8)) * 0.028 })
};

// ── Environment definitions ────────────────────────────────────────────────
const ENVIRONMENTS = {
  home: {
    label: '🏠 Home',
    bg: (ctx, w, h, t) => {
      // Warm interior gradient
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a1a0e'); g.addColorStop(1, '#1a0e06');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // Wooden floor
      ctx.fillStyle = '#3d1f0a';
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      // Floor grain lines
      ctx.strokeStyle = 'rgba(90,40,10,0.4)'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 28) {
        ctx.beginPath(); ctx.moveTo(x, h * 0.72); ctx.lineTo(x + 20, h);
        ctx.stroke();
      }
      // Window glow
      const wx = w * 0.75, wy = h * 0.1, ww = w * 0.2, wh = h * 0.32;
      const wg = ctx.createRadialGradient(wx + ww/2, wy + wh/2, 0, wx + ww/2, wy + wh/2, ww);
      wg.addColorStop(0, 'rgba(255,220,120,0.18)');
      wg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = wg; ctx.fillRect(wx - 20, wy - 20, ww + 40, wh + 40);
      ctx.fillStyle = 'rgba(255,210,100,0.1)';
      ctx.fillRect(wx, wy, ww, wh);
    },
    ambient: '#ff8c3020'
  },

  park: {
    label: '🌿 Park',
    bg: (ctx, w, h, t) => {
      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
      sky.addColorStop(0, '#1a3a5c'); sky.addColorStop(1, '#2d6a9f');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.6);
      // Clouds drift
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      const cx = (t * 15) % (w + 80) - 40;
      _drawCloud(ctx, cx, h * 0.15, 60);
      _drawCloud(ctx, (cx + 180) % (w + 80) - 40, h * 0.08, 40);
      // Grass
      const grass = ctx.createLinearGradient(0, h * 0.58, 0, h);
      grass.addColorStop(0, '#1a4a1a'); grass.addColorStop(1, '#0d2e0d');
      ctx.fillStyle = grass; ctx.fillRect(0, h * 0.58, w, h * 0.42);
      // Far trees (parallax)
      const off = (_envOffset * 0.3) % w;
      ctx.fillStyle = '#0e3a0e';
      for (let tx = -off; tx < w + 60; tx += 70) {
        ctx.beginPath(); ctx.arc(tx + 25, h * 0.56, 28, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(tx + 18, h * 0.56, 14, h * 0.2);
      }
      // Closer trees
      ctx.fillStyle = '#0a280a';
      for (let tx = -((off * 0.6) % w); tx < w + 80; tx += 110) {
        ctx.beginPath(); ctx.arc(tx + 35, h * 0.6, 40, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(tx + 25, h * 0.6, 20, h * 0.25);
      }
    },
    ambient: '#1a4a1a18'
  },

  night: {
    label: '🌙 Night',
    bg: (ctx, w, h, t) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#02030a'); g.addColorStop(1, '#060d1a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // Stars twinkle
      if (!_particles.length) _spawnStars(w, h);
      _particles.forEach(p => {
        const alpha = 0.4 + Math.sin(t * p.speed + p.phase) * 0.4;
        ctx.fillStyle = `rgba(200,210,255,${alpha})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      // Moon
      ctx.fillStyle = 'rgba(240,240,200,0.9)';
      ctx.beginPath(); ctx.arc(w * 0.8, h * 0.12, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(10,15,30,0.85)';
      ctx.beginPath(); ctx.arc(w * 0.8 + 8, h * 0.12 - 4, 18, 0, Math.PI * 2); ctx.fill();
      // Ground
      ctx.fillStyle = '#08101e';
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
    },
    ambient: '#1428540a'
  },

  rain: {
    label: '🌧 Rain',
    bg: (ctx, w, h, t) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a1f28'); g.addColorStop(1, '#0d1018');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // Ground / puddle
      ctx.fillStyle = '#0f1520';
      ctx.fillRect(0, h * 0.68, w, h * 0.32);
      ctx.fillStyle = 'rgba(100,140,180,0.08)';
      ctx.fillRect(0, h * 0.68, w, 8);
      // Rain drops
      ctx.strokeStyle = 'rgba(150,185,220,0.35)';
      ctx.lineWidth = 1;
      if (!_particles.length) _spawnRain(w, h);
      _particles.forEach(p => {
        p.y += p.speed; p.x += p.wx;
        if (p.y > h) { p.y = -20; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.wx * 2, p.y + 12); ctx.stroke();
      });
    },
    ambient: '#1a2a3a14',
    postDraw: (ctx, w, h) => {
      // Wet overlay on dog
      ctx.fillStyle = 'rgba(120,160,200,0.04)';
      ctx.fillRect(0, 0, w, h);
    }
  },

  snow: {
    label: '❄ Snow',
    bg: (ctx, w, h, t) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a2030'); g.addColorStop(1, '#2a3040');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // Snow ground
      ctx.fillStyle = '#d8e4f0';
      ctx.fillRect(0, h * 0.68, w, h * 0.32);
      // Snow flakes
      if (!_particles.length) _spawnSnow(w, h);
      ctx.fillStyle = 'rgba(220,235,255,0.8)';
      _particles.forEach(p => {
        p.y += p.speed; p.x += Math.sin(t * p.wobble + p.phase) * 0.5;
        if (p.y > h * 0.7) { p.y = -10; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      });
    },
    ambient: '#c0d4f010'
  },

  space: {
    label: '🚀 Space',
    bg: (ctx, w, h, t) => {
      ctx.fillStyle = '#000005'; ctx.fillRect(0, 0, w, h);
      if (!_particles.length) _spawnStars(w, h);
      // Star field
      _particles.forEach(p => {
        const pulse = 0.5 + Math.sin(t * p.speed + p.phase) * 0.5;
        ctx.fillStyle = `rgba(200,210,255,${pulse * 0.8})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      // Nebula
      const ng = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, w * 0.4);
      ng.addColorStop(0, 'rgba(80,20,120,0.08)');
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h);
      // Distant planet
      ctx.fillStyle = 'rgba(180,100,60,0.6)';
      ctx.beginPath(); ctx.arc(w * 0.75, h * 0.2, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(160,80,40,0.4)';
      ctx.beginPath(); ctx.ellipse(w * 0.75, h * 0.2, 45, 8, 0.3, 0, Math.PI * 2); ctx.fill();
    },
    ambient: '#20003020',
    gravity: 0.3 // reduced gravity — dog floats
  },

  beach: {
    label: '🏖 Beach',
    bg: (ctx, w, h, t) => {
      // Ocean
      const ocean = ctx.createLinearGradient(0, 0, 0, h * 0.55);
      ocean.addColorStop(0, '#0a3a5a'); ocean.addColorStop(1, '#1a6090');
      ctx.fillStyle = ocean; ctx.fillRect(0, 0, w, h * 0.55);
      // Waves
      ctx.strokeStyle = 'rgba(120,200,255,0.3)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const waveY = h * 0.45 + i * 8 + Math.sin(t * 1.5 + i) * 5;
        const waveX = (t * 40 + i * 60) % (w + 100) - 50;
        ctx.beginPath();
        ctx.moveTo(waveX, waveY);
        ctx.quadraticCurveTo(waveX + 40, waveY - 8, waveX + 80, waveY);
        ctx.stroke();
      }
      // Sand
      const sand = ctx.createLinearGradient(0, h * 0.55, 0, h);
      sand.addColorStop(0, '#c8a84b'); sand.addColorStop(1, '#a8882b');
      ctx.fillStyle = sand; ctx.fillRect(0, h * 0.55, w, h * 0.45);
      // Sun
      const sg = ctx.createRadialGradient(w * 0.85, h * 0.08, 0, w * 0.85, h * 0.08, 60);
      sg.addColorStop(0, 'rgba(255,230,100,0.9)');
      sg.addColorStop(0.4, 'rgba(255,200,60,0.4)');
      sg.addColorStop(1, 'rgba(255,180,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(w * 0.6, 0, w * 0.4, h * 0.3);
    },
    ambient: '#ffe06015'
  }
};

// ── Particle spawners ──────────────────────────────────────────────────────
function _spawnStars(w, h) {
  _particles = [];
  for (let i = 0; i < 80; i++) {
    _particles.push({ x: Math.random()*w, y: Math.random()*h*0.85,
      size: Math.random()*1.5+0.5, speed: Math.random()*2+0.5, phase: Math.random()*Math.PI*2 });
  }
}
function _spawnRain(w, h) {
  _particles = [];
  const count = _weatherIntensity === 1 ? 25 : _weatherIntensity === 3 ? 100 : 60;
  const speedMul = _weatherIntensity === 1 ? 0.6 : _weatherIntensity === 3 ? 1.5 : 1;
  for (let i = 0; i < count; i++) {
    _particles.push({ x: Math.random()*w, y: Math.random()*h,
      speed: (8+Math.random()*6)*speedMul, wx: (-1-Math.random()*1.5)*speedMul });
  }
}
function _spawnSnow(w, h) {
  _particles = [];
  const count = _weatherIntensity === 1 ? 20 : _weatherIntensity === 3 ? 90 : 50;
  const sizeMul = _weatherIntensity === 1 ? 0.6 : _weatherIntensity === 3 ? 1.6 : 1;
  for (let i = 0; i < count; i++) {
    _particles.push({ x: Math.random()*w, y: Math.random()*h*0.7,
      size: (Math.random()*2+1)*sizeMul, speed: 0.5+Math.random(), wobble: Math.random()*2+0.5, phase: Math.random()*Math.PI*2 });
  }
}
function _drawCloud(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2); ctx.arc(x+r*0.8, y-r*0.3, r*0.7, 0, Math.PI*2);
  ctx.arc(x+r*1.6, y, r*0.8, 0, Math.PI*2); ctx.fill();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init(canvasEl, env) {
  _canvas = canvasEl; if (!_canvas) return false;
  _ctx = _canvas.getContext('2d');
  _canvas.width  = _canvas.offsetWidth  || 512;
  _canvas.height = _canvas.offsetHeight || 512;
  if (env) setEnvironment(env);
  await _loadAll();
  _cur = 'idle';
  _rafId = requestAnimationFrame(_loop);
  return true;
}

// ── Load user assets ───────────────────────────────────────────────────────
async function _loadAll() {
  _particles = [];
  for (const expr of ['idle','happy','sad','excited']) await _loadExpr(expr);
  await _loadFaces();
}

async function _loadExpr(expr) {
  const a = _exprAssets[expr];
  if (a.video) { a.video.pause(); a.video.src = ''; a.video = null; }
  a.bitmap = null;

  const vUrl = await window.AvatarBuilder?.getAssetURL(`video:${expr}`);
  if (vUrl) {
    const v = document.createElement('video');
    v.src = vUrl; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
    await v.play().catch(() => {});
    a.video = v; return;
  }
  const bUrl = await window.AvatarBuilder?.getAssetURL(`body:${expr}`);
  if (bUrl) {
    try {
      a.bitmap = await createImageBitmap(await fetch(bUrl).then(r => r.blob()));
    } catch (_) {}
  }
}

async function _loadFaces() {
  for (const expr of ['idle','happy','sad','excited']) {
    const url = await window.AvatarBuilder?.getAssetURL(`face:${expr}`);
    if (url) {
      try { _faceAssets[expr] = await createImageBitmap(await fetch(url).then(r => r.blob())); }
      catch (_) { _faceAssets[expr] = null; }
    } else { _faceAssets[expr] = null; }
  }
}

// ── Environment ────────────────────────────────────────────────────────────
function setEnvironment(envId) {
  if (!ENVIRONMENTS[envId]) return;
  if (envId !== _currentEnv) { _particles = []; } // reset particles on change
  _currentEnv = envId;
  window.dispatchEvent(new CustomEvent('immortail:env-changed', { detail: { env: envId } }));
}

function getEnvironment() { return _currentEnv; }
function getEnvironments() { return ENVIRONMENTS; }

// ── Expression ────────────────────────────────────────────────────────────
function setExpression(expr) {
  if (expr === _cur && !_blending) return;
  _next = expr; _blending = true; _blendF = 0;
}

// ── Main loop ──────────────────────────────────────────────────────────────
function _loop(ts) {
  _rafId = requestAnimationFrame(_loop);
  if (ts - _lastTs < 1000 / FPS) return;
  _lastTs = ts;
  _render(ts / 1000);
}

function _render(t) {
  if (!_ctx || !_canvas) return;
  const w = _canvas.width, h = _canvas.height;
  _ctx.clearRect(0, 0, w, h);

  // 1. Environment background
  const env = ENVIRONMENTS[_currentEnv] || ENVIRONMENTS.home;
  try { env.bg(_ctx, w, h, t); } catch (_) {}

  // 2. Parallax scroll (auto-drift)
  _envOffset += 0.4;

  // 3. Dog layer
  const dogH = h * 0.62;
  const dogY = h * 0.18;
  const gravity = env.gravity || 1;

  if (_blending && _next) {
    const alpha = _blendF / BLEND_FRAMES;
    _ctx.globalAlpha = 1 - alpha;
    _drawDog(_cur, w, dogH, dogY, t, gravity);
    _ctx.globalAlpha = alpha;
    _drawDog(_next, w, dogH, dogY, t, gravity);
    _ctx.globalAlpha = 1;
    if (++_blendF >= BLEND_FRAMES) { _cur = _next; _next = null; _blending = false; }
  } else {
    _drawDog(_cur, w, dogH, dogY, t, gravity);
  }

  // 4. Post-draw (wet/glow effects)
  try { env.postDraw?.(_ctx, w, h); } catch (_) {}

  // 5. Ambient tint
  if (env.ambient) {
    _ctx.fillStyle = env.ambient;
    _ctx.fillRect(0, 0, w, h);
  }

  // 6. Time-of-day darkness overlay
  const bright = _todBrightness();
  if (bright < 0.95) {
    _ctx.fillStyle = `rgba(0,0,10,${(1 - bright) * 0.65})`;
    _ctx.fillRect(0, 0, w, h);
  }
  // Golden hour tint (6-8 and 17-19)
  const hr = _timeOfDay;
  if ((hr >= 6 && hr <= 8) || (hr >= 17 && hr <= 19)) {
    const goldenAlpha = 0.12 * (1 - Math.abs(hr - (hr < 12 ? 7 : 18)));
    _ctx.fillStyle = `rgba(255,160,40,${Math.max(0,goldenAlpha)})`;
    _ctx.fillRect(0, 0, w, h);
  }
}

function _drawDog(expr, w, dogH, dogY, t, gravity) {
  const a  = _exprAssets[expr] || _exprAssets.idle;
  const mo = MOTION[expr] || MOTION.idle;
  const { tx, ty, s } = mo(t);
  const gravTy = ty * gravity;

  if (a.video && !a.video.paused && a.video.readyState >= 2) {
    _ctx.save();
    _ctx.translate(w/2 + tx, dogY + dogH/2 + gravTy);
    _ctx.scale(s, s * gravity);
    _ctx.drawImage(a.video, -dogH/2, -dogH/2, dogH, dogH);
    _ctx.restore();
    _drawFace(expr, w, dogH, dogY, tx, gravTy, s, gravity);
    return;
  }
  if (a.bitmap) {
    _ctx.save();
    _ctx.translate(w/2 + tx, dogY + dogH/2 + gravTy);
    _ctx.scale(s, s * gravity);
    _ctx.drawImage(a.bitmap, -dogH/2, -dogH/2, dogH, dogH);
    _ctx.restore();
    _drawFace(expr, w, dogH, dogY, tx, gravTy, s, gravity);
  }
  // No assets: canvas stays clear — SVG shows through
}

function _drawFace(expr, w, dogH, dogY, tx, ty, s, gravity) {
  const bm = _faceAssets[expr] || _faceAssets.idle;
  if (!bm) return;
  const blink = Math.sin(performance.now() / 3000 * 0.4) > 0.97;
  _ctx.globalAlpha = blink ? 0.2 : 1;
  _ctx.save();
  _ctx.translate(w/2 + tx, dogY + dogH/2 + ty);
  _ctx.scale(s, s * gravity);
  _ctx.drawImage(bm, -dogH/2, -dogH/2, dogH, dogH);
  _ctx.restore();
  _ctx.globalAlpha = 1;
}

// ── Snapshot ───────────────────────────────────────────────────────────────
function snapshot() { return _canvas?.toDataURL('image/webp', 0.85) || null; }
function stop()     { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }
function isActive() { return !!_rafId; }
function hasUserAssets() { return Object.values(_exprAssets).some(a => a.video || a.bitmap); }

async function refreshSlot(slot) {
  const [layer, expr] = slot.split(':');
  if (layer === 'body' || layer === 'video') await _loadExpr(expr);
  else if (layer === 'face') await _loadFaces();
}

window.addEventListener('immortail:asset-updated', async e => {
  await refreshSlot(e.detail.slot);
});

function setTimeOfDay(h) {
  _timeOfDay = Math.max(0, Math.min(23, h));
}

function setWeatherIntensity(v) {
  _weatherIntensity = Math.max(1, Math.min(3, v));
  // Respawn particles scaled to intensity
  _particles = [];
}

// Compute a lighting multiplier from time of day (0=night, 1=noon)
function _todBrightness() {
  // Peak at 12, dark at 0/23
  const h = _timeOfDay;
  if (h >= 6 && h <= 18) return 0.5 + 0.5 * Math.sin((h - 6) / 12 * Math.PI);
  return 0.08;
}

window.Animator = {
  init, setExpression, setEnvironment, getEnvironment, getEnvironments,
  setTimeOfDay, setWeatherIntensity,
  refreshSlot, refreshAllAssets: _loadAll, loadFaceOverlays: _loadFaces,
  hasUserAssets, snapshot, stop, isActive,
  get currentEnv() { return _currentEnv; }
};
