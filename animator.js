// IMMORTAIL™ Animator v1
// Canvas-based compositor — priority: user video > user stills > procedural
// Runs requestAnimationFrame loop, cross-fades between expressions

const FPS        = 12;
const BLEND_FRAMES = 8;

let _canvas = null, _ctx = null, _rafId = null;
let _cur = 'idle', _next = null, _blending = false, _blendF = 0;
let _lastTs = 0;

const _exprAssets = {
  idle:    { video:null, bitmap:null },
  happy:   { video:null, bitmap:null },
  sad:     { video:null, bitmap:null },
  excited: { video:null, bitmap:null }
};
const _faceAssets = { idle:null, happy:null, sad:null, excited:null };

// Procedural animation params per expression
const ANIM = {
  idle:    (t) => ({ tx:0,        ty: Math.sin(t*1.1)*3,                   s:1+Math.sin(t*1.1)*0.008 }),
  happy:   (t) => ({ tx:0,        ty:-Math.abs(Math.sin(t*3.5))*8,          s:1+Math.sin(t*3.5)*0.015 }),
  sad:     (t) => ({ tx:0,        ty: Math.sin(t*0.6)*2+6,                  s:0.97+Math.sin(t*0.6)*0.005 }),
  excited: (t) => ({ tx:Math.sin(t*14)*5, ty:-Math.abs(Math.sin(t*7))*12,  s:1+Math.abs(Math.sin(t*7))*0.025 })
};

async function init(canvasEl) {
  _canvas = canvasEl; if (!_canvas) return false;
  _ctx = _canvas.getContext('2d');
  _canvas.width = 512; _canvas.height = 512;
  await _loadAll();
  _cur = 'idle';
  _rafId = requestAnimationFrame(_loop);
  return true;
}

async function _loadAll() {
  for (const expr of ['idle','happy','sad','excited']) await _loadExpr(expr);
}

async function _loadExpr(expr) {
  const a = _exprAssets[expr];
  // cleanup old
  if (a.video) { a.video.pause(); a.video.src=''; a.video=null; }
  a.bitmap = null;

  // Video first
  const vUrl = await window.AvatarBuilder?.getAssetURL(`video:${expr}`);
  if (vUrl) {
    const v = document.createElement('video');
    v.src=vUrl; v.loop=true; v.muted=true; v.playsInline=true; v.crossOrigin='anonymous';
    await v.play().catch(()=>{});
    a.video = v; return;
  }
  // Still image
  const bUrl = await window.AvatarBuilder?.getAssetURL(`body:${expr}`);
  if (bUrl) {
    try {
      const blob = await fetch(bUrl).then(r=>r.blob());
      a.bitmap = await createImageBitmap(blob);
    } catch(_) {}
  }
}

async function _loadFaces() {
  for (const expr of ['idle','happy','sad','excited']) {
    const url = await window.AvatarBuilder?.getAssetURL(`face:${expr}`);
    if (url) {
      try { _faceAssets[expr] = await createImageBitmap(await fetch(url).then(r=>r.blob())); }
      catch(_) {}
    } else {
      _faceAssets[expr] = null;
    }
  }
}

function setExpression(expr) {
  if (expr===_cur && !_blending) return;
  _next=expr; _blending=true; _blendF=0;
}

function _loop(ts) {
  _rafId = requestAnimationFrame(_loop);
  if (ts - _lastTs < 1000/FPS) return;
  _lastTs = ts;
  _render(ts);
}

function _render(ts) {
  if (!_ctx) return;
  const w=_canvas.width, h=_canvas.height;
  _ctx.clearRect(0,0,w,h);

  if (_blending && _next) {
    const alpha = _blendF / BLEND_FRAMES;
    _ctx.globalAlpha = 1-alpha; _drawExpr(_cur, w, h, ts);
    _ctx.globalAlpha = alpha;   _drawExpr(_next, w, h, ts);
    _ctx.globalAlpha = 1;
    if (++_blendF >= BLEND_FRAMES) { _cur=_next; _next=null; _blending=false; }
  } else {
    _drawExpr(_cur, w, h, ts);
  }
}

function _drawExpr(expr, w, h, ts) {
  const a = _exprAssets[expr] || _exprAssets.idle;
  const t = ts / 1000;

  if (a.video && !a.video.paused && a.video.readyState >= 2) {
    try { _ctx.drawImage(a.video, 0, 0, w, h); } catch(_) {}
    // Face overlay on top of video
    _drawFace(expr, w, h);
    return;
  }
  if (a.bitmap) {
    _drawAnimated(a.bitmap, expr, w, h, t);
    _drawFace(expr, w, h);
    return;
  }
  // No user assets — canvas stays transparent (SVG shows through)
}

function _drawAnimated(bitmap, expr, w, h, t) {
  const fn  = ANIM[expr] || ANIM.idle;
  const { tx, ty, s } = fn(t);
  _ctx.save();
  _ctx.translate(w/2+tx, h/2+ty);
  _ctx.scale(s, s);
  _ctx.drawImage(bitmap, -w/2, -h/2, w, h);
  _ctx.restore();
}

function _drawFace(expr, w, h) {
  const bm = _faceAssets[expr] || _faceAssets.idle;
  if (!bm) return;
  const t = performance.now()/1000;
  // Occasional blink
  const blink = Math.sin(t*0.4) > 0.97;
  _ctx.globalAlpha = blink ? 0.25 : 1;
  _ctx.drawImage(bm, 0, 0, w, h);
  _ctx.globalAlpha = 1;
}

async function refreshSlot(slot) {
  const [layer, expr] = slot.split(':');
  if (layer==='body'||layer==='video') await _loadExpr(expr);
  else if (layer==='face') await _loadFaces();
}

function hasUserAssets() {
  return Object.values(_exprAssets).some(a=>a.video||a.bitmap);
}

function snapshot() { return _canvas?.toDataURL('image/webp', 0.85)||null; }
function stop()     { if (_rafId) { cancelAnimationFrame(_rafId); _rafId=null; } }
function isActive() { return !!_rafId; }

window.addEventListener('immortail:asset-updated', async e => {
  await refreshSlot(e.detail.slot);
});

window.Animator = { init, setExpression, refreshSlot, refreshAllAssets:_loadAll, loadFaceOverlays:_loadFaces, hasUserAssets, snapshot, stop, isActive };
