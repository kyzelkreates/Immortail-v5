// IMMORTAIL™ App v6
// Wires: Engine · Storage · AI · AvatarBuilder · Animator → full PWA

const AUDIO_THROTTLE_MS = 4000;
let _lastAudioTime   = 0;
let _audioEl         = null;
let _currentExpr     = null;
let _pwaSettings     = {};
let _deferredInstall = null;
let _animatorActive  = false;

// Static AI-generated asset paths (fallback when no user assets)
const STATIC_MEDIA = {
  body:  { idle:'assets/dog/body_idle.png', happy:'assets/dog/body_happy.png', sad:'assets/dog/body_sad.png', excited:'assets/dog/body_happy.png' },
  face:  { idle:'assets/dog/eyes_idle.png', happy:'assets/dog/eyes_happy.png', sad:'assets/dog/eyes_sad.png', excited:'assets/dog/eyes_happy.png' },
  video: { idle:'assets/dog/blink.webm',    happy:'assets/dog/tail_wag.webm',  sad:null, excited:'assets/dog/bounce.webm' },
  audio: { idle:'assets/audio/breath_idle.mp3', happy:'assets/audio/bark_soft.mp3', sad:'assets/audio/whine.mp3', excited:'assets/audio/bark_excited.mp3' }
};

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('load', async () => {

  // SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
        });
      });
    }).catch(e => console.warn('[Boot] SW:', e.message));
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  }

  // Storage
  try { await window.Storage.init(); }
  catch (e) { showSplashError('Storage unavailable — try a different browser or disable private mode.'); return; }

  // PWA settings + AI config from IDB
  try { _pwaSettings = await window.Storage.loadPWASettings(); } catch (_) { _pwaSettings = {}; }
  try { await window.AI.loadConfig(); } catch (_) {}

  // Engine
  let state;
  try { state = await window.Engine.init(onStateChange); }
  catch (e) { showSplashError('Engine failed — refresh or clear site data.'); return; }

  // Avatar Builder + Animator
  try {
    await window.AvatarBuilder.init();
    const canvas = document.getElementById('dog-canvas');
    if (canvas && window.Animator) {
      _animatorActive = await window.Animator.init(canvas);
    }
  } catch (e) { console.warn('[Boot] Avatar/Animator:', e.message); }

  // UI
  try { applyPWASettings(_pwaSettings); renderState(state); await loadAndRenderMemory(); } catch (_) {}

  hideSplash();
  initAudio();
  bindEvents();
  buildAvatarBuilderUI();
  updateAIChip();
  checkInstallability();
  handleURLActions();
});

// ═══════════════════════════════════════════════════════════════════════════
// PWA INSTALL
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _deferredInstall = e; _showInstallBtn(); });
window.addEventListener('appinstalled', () => { _deferredInstall = null; document.getElementById('install-btn')?.style.setProperty('display','none'); showToast('IMMORTAIL™ installed! 🐾'); });

function _showInstallBtn() { const b = document.getElementById('install-btn'); if (b) b.style.display = 'flex'; }

function checkInstallability() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone;
  if (!isStandalone && (isIOS || _deferredInstall)) _showInstallBtn();
}

function triggerInstall() {
  if (!_deferredInstall) { showToast('Tap Share → "Add to Home Screen" in Safari 🐾'); return; }
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(r => { if (r.outcome === 'accepted') _deferredInstall = null; });
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const b = document.createElement('div');
  b.id = 'update-banner'; b.className = 'update-banner';
  b.innerHTML = `<span>🔄 Update available</span><button id="update-apply">Reload</button><button id="update-dismiss">✕</button>`;
  document.body.appendChild(b);
  document.getElementById('update-apply')?.addEventListener('click', () => navigator.serviceWorker.controller?.postMessage({ type:'SKIP_WAITING' }));
  document.getElementById('update-dismiss')?.addEventListener('click', () => b.remove());
}

function handleURLActions() {
  const p = new URLSearchParams(location.search).get('action');
  if (!p) return;
  history.replaceState({}, '', '/');
  setTimeout(() => {
    if (p === 'feed') handleAction('FEED', '🍖 *gobbles up the food happily!*', 'happy');
    if (p === 'play') handleAction('PLAY', '🎾 *zooms around excitedly!*', 'excited');
  }, 800);
}

// ═══════════════════════════════════════════════════════════════════════════
// PWA SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function applyPWASettings(s) {
  _pwaSettings = s || {};
  if (_audioEl) _audioEl.volume = s.audioVolume ?? 0.45;
}

async function savePWASettings(overrides) {
  _pwaSettings = { ..._pwaSettings, ...overrides };
  applyPWASettings(_pwaSettings);
  await window.Storage.savePWASettings(_pwaSettings);
}

// ═══════════════════════════════════════════════════════════════════════════
// AVATAR — composite render, priority: Animator canvas > static images > SVG
// ═══════════════════════════════════════════════════════════════════════════
async function renderDog(expression) {
  if (_currentExpr === expression) return;
  _currentExpr = expression;

  try {
    const stage = document.getElementById('dog-stage');
    if (stage) stage.className = `dog-stage expr-${expression}`;
    document.body.className = `mood-${expression}`;

    // Tell animator
    if (_animatorActive && window.Animator) {
      window.Animator.setExpression(expression);
    }

    // Check if user has custom assets for this expression
    const hasBody  = !!(await window.AvatarBuilder.getAssetURL(`body:${expression}`));
    const hasVideo = !!(await window.AvatarBuilder.getAssetURL(`video:${expression}`));

    // Show/hide canvas vs static images
    const canvas    = document.getElementById('dog-canvas');
    const baseImg   = document.getElementById('dog-base-img');
    const faceImg   = document.getElementById('dog-face-img');
    const videoEl   = document.getElementById('dog-video-overlay');
    const svgFb     = document.getElementById('dog-svg-fallback');

    if (_animatorActive && (hasBody || hasVideo)) {
      // Animator is handling it
      if (canvas)  { canvas.style.display  = 'block'; canvas.style.opacity = '1'; }
      if (baseImg) baseImg.style.display   = 'none';
      if (faceImg) faceImg.style.display   = 'none';
      if (videoEl) { videoEl.pause(); videoEl.style.display = 'none'; }
      if (svgFb)   svgFb.style.opacity     = '0.08'; // faint SVG behind canvas
    } else {
      // Fall back to static AI-generated images
      if (canvas)  canvas.style.display    = 'none';
      _setImgSrc(baseImg, STATIC_MEDIA.body[expression]  || STATIC_MEDIA.body.idle);
      _setImgSrc(faceImg, STATIC_MEDIA.face[expression]  || STATIC_MEDIA.face.idle);
      if (_pwaSettings.animationsEnabled !== false) {
        _setVideoSrc(videoEl, STATIC_MEDIA.video[expression] || null);
      }
      if (svgFb) svgFb.style.opacity = '1';
    }

    // Play user audio or static audio
    const userAudio = await window.AvatarBuilder.getAssetURL(`audio:${expression}`);
    _playAudio(userAudio || STATIC_MEDIA.audio[expression], expression);

    _updateSVG(expression);
  } catch (e) { console.warn('[renderDog]', e.message); }
}

function _setImgSrc(el, src) {
  if (!el || !src) return;
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  const i = new Image();
  i.onload  = () => { el.src = src; el.style.display = 'block'; el.style.opacity = '0'; requestAnimationFrame(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '1'; }); };
  i.onerror = () => { el.style.display = 'none'; };
  i.src = src;
}

function _setVideoSrc(el, src) {
  if (!el) return;
  if (!src) { el.pause(); el.removeAttribute('src'); el.style.display = 'none'; return; }
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src); el.style.display = 'none'; el.src = src; el.load();
  el.oncanplay = () => { el.style.display = 'block'; el.play().catch(() => { el.style.display = 'none'; }); };
  el.onerror   = () => { el.style.display = 'none'; };
}

function _updateSVG(expression) {
  const cfg = {
    idle:    { mouth:'M 43 63 Q 55 67 67 63', ry:5,   tail:'1.1s',  bY:0,  tongue:false },
    happy:   { mouth:'M 40 61 Q 55 74 70 61', ry:4,   tail:'0.35s', bY:-2, tongue:true  },
    sad:     { mouth:'M 40 66 Q 55 58 70 66', ry:2.5, tail:'2.2s',  bY:3,  tongue:false },
    excited: { mouth:'M 39 60 Q 55 76 71 60', ry:5,   tail:'0.22s', bY:-3, tongue:true  }
  }[expression] || { mouth:'M 43 63 Q 55 67 67 63', ry:5, tail:'1.1s', bY:0, tongue:false };
  const $  = id => document.getElementById(id);
  $('svg-mouth')?.setAttribute('d', cfg.mouth);
  $('svg-eye-l')?.setAttribute('ry', cfg.ry);
  $('svg-eye-r')?.setAttribute('ry', cfg.ry);
  $('svg-tail')?.querySelector('animateTransform')?.setAttribute('dur', cfg.tail);
  $('svg-brow-l')?.setAttribute('transform', `translate(0,${cfg.bY})`);
  $('svg-brow-r')?.setAttribute('transform', `translate(0,${cfg.bY})`);
  const t = $('svg-tongue'); if (t) t.style.display = cfg.tongue ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════════════════
function initAudio() {
  try { _audioEl = new Audio(); _audioEl.volume = _pwaSettings.audioVolume ?? 0.45; } catch (_) {}
}

function _playAudio(src, expression) {
  if (!_audioEl || _pwaSettings.audioEnabled === false || !src) return;
  const now = Date.now();
  if (now - _lastAudioTime < AUDIO_THROTTLE_MS) return;
  _lastAudioTime = now;
  try {
    _audioEl.pause(); _audioEl.src = src;
    _audioEl.volume = expression === 'excited' ? Math.min(1, (_pwaSettings.audioVolume ?? 0.45) * 1.3) : (_pwaSettings.audioVolume ?? 0.45);
    _audioEl.load(); _audioEl.play().catch(() => {});
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE → UI
// ═══════════════════════════════════════════════════════════════════════════
function onStateChange(state) { renderState(state); }

function renderState(state) {
  if (!state) return;
  const $ = id => document.getElementById(id);
  if ($('dog-name-display')) $('dog-name-display').textContent = state.name || 'Rex';
  const badges = { idle:'😐 Idle', happy:'😄 Happy', sad:'😢 Sad', excited:'🐾 Excited' };
  if ($('mood-badge')) $('mood-badge').textContent = badges[state.expression] || '😐 Idle';
  _setBar('energy-bar', state.energy); _setBar('bond-bar', state.bond);
  if ($('energy-val')) $('energy-val').textContent = Math.round(state.energy);
  if ($('bond-val'))   $('bond-val').textContent   = Math.round(state.bond);
  renderDog(state.expression || 'idle');
}

function _setBar(id, val) { const el = document.getElementById(id); if (el) el.style.width = `${Math.round(Math.min(100,Math.max(0,val||0)))}%`; }

// ═══════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderMemory() {
  let mems = []; try { mems = await window.Storage.loadMemory(); } catch (_) {}
  const c = document.getElementById('chat-history'); if (!c) return;
  c.innerHTML = '';
  if (!mems.length) showWelcome(); else { mems.forEach(m => appendMsg(m.role, m.content, false)); scrollChat(); }
}
function showWelcome() {
  const c = document.getElementById('chat-history'); if (!c) return;
  c.innerHTML = `<div id="chat-welcome" class="chat-welcome"><div class="welcome-paw">🐾</div><div class="welcome-text">Your companion is waiting.<br/>Say hello, feed them, or chat.</div><div class="welcome-hint">Add an AI key in ⚙ Settings, or use 🦙 Ollama locally.</div></div>`;
}
function removeWelcome() { document.getElementById('chat-welcome')?.remove(); }
function appendMsg(role, content, scroll=true) {
  removeWelcome();
  const c = document.getElementById('chat-history'); if (!c) return;
  const row = document.createElement('div'); row.className = `chat-msg ${role==='user'?'msg-user':'msg-dog'}`;
  const b   = document.createElement('div'); b.className = 'bubble'; b.textContent = content;
  row.appendChild(b); c.appendChild(row); if (scroll) scrollChat();
}
function scrollChat() { const c = document.getElementById('chat-history'); if (c) c.scrollTop = c.scrollHeight; }
function showTyping() {
  const id = `t${Date.now()}`; const c = document.getElementById('chat-history'); if (!c) return id;
  const row = document.createElement('div'); row.id = id; row.className = 'chat-msg msg-dog';
  row.innerHTML = '<div class="bubble typing-bubble"><span></span><span></span><span></span></div>';
  c.appendChild(row); scrollChat(); return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

let _lock = false;
async function handleSend() {
  const inp = document.getElementById('chat-input'); if (!inp) return;
  const msg = inp.value.trim(); if (!msg || _lock) return;
  _lock = true; inp.value = ''; inp.disabled = true;
  appendMsg('user', msg);
  try { await window.Storage.addMemory({ role:'user', content:msg }); } catch (_) {}
  let state; try { state = await window.Engine.dispatch({ type:'CHAT' }); } catch (_) {}
  state = state || window.Engine.getState() || { expression:'idle', name:'Rex' };
  let mems = []; try { mems = await window.Storage.loadMemory(); } catch (_) {}
  const tid = showTyping();
  let reply; try { if (!window.AI.isBusy()) reply = await window.AI.ask(msg, state, mems); } catch (_) {}
  removeTyping(tid);
  reply = reply || window.AI.getFallback(state.expression);
  appendMsg('dog', reply);
  try { await window.Storage.addMemory({ role:'dog', content:reply }); } catch (_) {}
  try { await window.Storage.enforceMemoryCap(); } catch (_) {}
  inp.disabled = false; inp.focus(); _lock = false;
}

async function handleAction(type, displayMsg, audioExpr) {
  let state; try { state = await window.Engine.dispatch({ type }); } catch (_) {}
  appendMsg('dog', displayMsg);
  try { await window.Storage.addMemory({ role:'dog', content:displayMsg }); } catch (_) {}
  try { await window.Storage.enforceMemoryCap(); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// AVATAR BUILDER UI
// ═══════════════════════════════════════════════════════════════════════════
const EXPR_LABELS = { idle:'😐 Idle', happy:'😄 Happy', sad:'😢 Sad', excited:'🐾 Excited' };
const SLOT_CONFIG = [
  { slot:'body:{expr}',  label:'Body Photo',     accept:'image/*',       icon:'📷' },
  { slot:'face:{expr}',  label:'Face/Eyes Photo', accept:'image/*',       icon:'👁' },
  { slot:'video:{expr}', label:'Animation Video', accept:'video/*',       icon:'🎬' },
  { slot:'audio:{expr}', label:'Sound',           accept:'audio/*',       icon:'🔊' },
];

let _currentBuilderExpr = 'idle';

function buildAvatarBuilderUI() {
  const container = document.getElementById('builder-panels');
  if (!container) return;
  container.innerHTML = '';

  for (const expr of ['idle','happy','sad','excited']) {
    const panel = document.createElement('div');
    panel.className   = `builder-panel ${expr === 'idle' ? '' : 'hidden'}`;
    panel.dataset.expr = expr;

    const grid = document.createElement('div');
    grid.className = 'slot-grid';

    for (const cfg of SLOT_CONFIG) {
      const slot    = cfg.slot.replace('{expr}', expr);
      const card    = document.createElement('div');
      card.className = 'slot-card';
      card.dataset.slot = slot;
      card.innerHTML = `
        <div class="slot-preview" id="preview-${slot.replace(':','-')}">
          <div class="slot-empty-icon">${cfg.icon}</div>
        </div>
        <div class="slot-label">${cfg.label}</div>
        <div class="slot-actions">
          <label class="btn-secondary upload-label">
            Upload <input type="file" accept="${cfg.accept}" data-slot="${slot}" class="slot-file-input"/>
          </label>
          <button class="btn-danger slot-clear-btn" data-slot="${slot}" title="Remove">✕</button>
        </div>`;
      grid.appendChild(card);
    }

    panel.appendChild(grid);
    container.appendChild(panel);
  }

  // Refresh previews
  refreshBuilderPreviews();

  // Check worker status
  setTimeout(() => {
    const ready = window.AvatarBuilder.workerReady;
    const dot   = document.getElementById('worker-dot');
    const lbl   = document.getElementById('worker-label');
    if (dot) dot.style.background = ready ? '#4ade80' : '#f87171';
    if (lbl) lbl.textContent = ready ? 'Local processor ready ✓' : 'Local processor unavailable (Chrome required for video)';
  }, 1500);
}

async function refreshBuilderPreviews() {
  const slots = await window.AvatarBuilder.getSlotStatus();
  for (const s of slots) {
    const id  = `preview-${s.slot.replace(':','-')}`;
    const el  = document.getElementById(id);
    if (!el) continue;
    if (s.filled && s.asset?.blob) {
      const url = await window.AvatarBuilder.getAssetURL(s.slot);
      if (!url) continue;
      const [layer] = s.slot.split(':');
      if (layer === 'body' || layer === 'face') {
        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
      } else if (layer === 'video') {
        el.innerHTML = `<video src="${url}" autoplay loop muted playsinline style="width:100%;height:100%;object-fit:cover;border-radius:8px"></video>`;
      } else if (layer === 'audio') {
        el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:4px"><div style="font-size:1.8rem">🔊</div><div style="font-size:0.65rem;color:var(--text-muted)">${s.asset.originalName || 'audio'}</div></div>`;
      }
      el.classList.add('has-asset');
    } else {
      el.classList.remove('has-asset');
    }
  }
}

function logProcess(msg, ok = true) {
  const log = document.getElementById('process-log'); if (!log) return;
  const row = document.createElement('div');
  row.className = `log-row ${ok ? '' : 'log-error'}`;
  row.innerHTML = `<span>${ok ? '✓' : '✗'}</span> ${msg}`;
  log.prepend(row);
  if (log.children.length > 8) log.removeChild(log.lastChild);
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  const $ = id => document.getElementById(id);

  // Chat
  $('send-btn')?.addEventListener('click', handleSend);
  $('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });

  // Dog tap
  $('dog-stage')?.addEventListener('click', async () => {
    let state; try { state = await window.Engine.dispatch({ type:'PET' }); } catch (_) {}
    showToast(`${state?.name||'Rex'} loves the attention! 🐾`);
    const expr = state?.expression || 'idle';
    await renderDog('excited');
    setTimeout(() => renderDog(expr), 900);
  });

  // Actions
  $('btn-feed')?.addEventListener('click', () => handleAction('FEED','🍖 *gobbles up the food happily!*','happy'));
  $('btn-play')?.addEventListener('click', () => handleAction('PLAY','🎾 *zooms around excitedly!*','excited'));
  $('btn-rest')?.addEventListener('click', () => handleAction('REST','💤 *curls up contentedly*','idle'));

  // Settings modal
  $('settings-btn')?.addEventListener('click', openSettings);
  $('close-settings')?.addEventListener('click', closeSettings);
  $('settings-overlay')?.addEventListener('click', e => { if (e.target === $('settings-overlay')) closeSettings(); });

  // Builder modal
  $('builder-btn')?.addEventListener('click', openBuilder);
  $('close-builder')?.addEventListener('click', closeBuilder);
  $('builder-overlay')?.addEventListener('click', e => { if (e.target === $('builder-overlay')) closeBuilder(); });

  // Install
  $('install-btn')?.addEventListener('click', triggerInstall);

  // Name
  $('save-name')?.addEventListener('click', async () => {
    const name = $('dog-name-input')?.value.trim(); if (!name) return;
    try { await window.Engine.dispatch({ type:'RENAME', name }); } catch (_) {}
    showToast(`Renamed to ${name} ✓`);
  });

  // Provider tabs
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.provider-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      $(`panel-${tab.dataset.provider}`)?.classList.remove('hidden');
    });
  });

  // Save key buttons
  document.querySelectorAll('[data-save-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prov = btn.dataset.saveKey;
      const key  = $(`key-${prov}`)?.value.trim();
      if (!key) { showToast('Enter a key first', true); return; }
      window.AI.setKey(prov, key);
      await window.AI.saveConfig();
      updateAIChip();
      showToast(`${prov} key saved ✓`);
    });
  });

  // Ollama ping
  $('ollama-ping')?.addEventListener('click', async () => {
    const st  = $('ollama-status');
    const url = $('key-ollama')?.value.trim() || 'http://localhost:11434';
    if (st) st.textContent = 'Pinging…';
    const r = await window.AI.pingOllama(url);
    if (r.ok) {
      window.AI.setKey('ollama', url); await window.AI.saveConfig();
      const sel = $('model-ollama');
      if (r.models.length && sel) sel.innerHTML = r.models.map(m => `<option value="${m}">${m}</option>`).join('');
      if (st) st.innerHTML = `<span style="color:#4ade80">✓ ${r.models.length} model(s)</span>`;
    } else {
      if (st) st.innerHTML = `<span style="color:#f87171">✗ Not reachable — is Ollama running?</span>`;
    }
  });

  // Activate provider
  $('activate-provider')?.addEventListener('click', async () => {
    const tab = document.querySelector('.provider-tab.active'); if (!tab) return;
    const prov  = tab.dataset.provider;
    const model = $(`model-${prov}`)?.value || null;
    window.AI.setProvider(prov, model); await window.AI.saveConfig();
    updateAIChip(); showToast(`${prov} activated ✓`); closeSettings();
  });

  // PWA toggles
  $('toggle-audio')?.addEventListener('change', e => savePWASettings({ audioEnabled: e.target.checked }));
  $('range-volume')?.addEventListener('input',  e => savePWASettings({ audioVolume: parseFloat(e.target.value) }));
  $('toggle-animations')?.addEventListener('change', e => savePWASettings({ animationsEnabled: e.target.checked }));
  $('toggle-notifications')?.addEventListener('change', async e => {
    if (e.target.checked && 'Notification' in window) {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { e.target.checked = false; showToast('Permission denied', true); return; }
    }
    savePWASettings({ notificationsEnabled: e.target.checked });
  });

  // Cache check
  $('check-cache-btn')?.addEventListener('click', async () => {
    const s = await window.Storage.getCacheStatus();
    const c = $('cache-status-list'); if (!c) return;
    if (!s.length) { c.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem">SW not active yet — install first</div>'; return; }
    const ok = s.filter(x=>x.cached).length;
    c.innerHTML = `<div class="cache-summary">${ok}/${s.length} cached</div>${s.map(x=>`<div class="asset-row"><span class="asset-dot ${x.cached?'dot-ok':'dot-missing'}"></span><span>${x.url}</span></div>`).join('')}`;
  });

  // Clear memory
  $('clear-memory-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear all chat history?')) return;
    try { await window.Storage.clearMemory(); } catch (_) {}
    await loadAndRenderMemory(); showToast('Chat cleared');
  });

  // Export/Import
  $('export-btn')?.addEventListener('click', async () => {
    try { if ($('export-output')) $('export-output').value = await window.Storage.exportKey(); showToast('Key ready ✓'); } catch (_) { showToast('Export failed', true); }
  });
  $('copy-export')?.addEventListener('click', () => {
    const v = $('export-output')?.value; if (v) navigator.clipboard?.writeText(v).then(() => showToast('Copied ✓'));
  });
  $('import-btn')?.addEventListener('click', async () => {
    const k = $('import-input')?.value.trim(); if (!k) { showToast('Paste a key first', true); return; }
    if (window.Engine.getState()?.totalInteractions > 0 && !confirm('Overwrite current companion?')) return;
    try { await window.Storage.importKey(k); showToast('Imported! Reloading…'); setTimeout(() => location.reload(), 1200); }
    catch (e) { showToast('Import failed: ' + e.message, true); }
  });

  // Builder: expression tabs
  document.querySelectorAll('.expr-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.expr-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.builder-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      _currentBuilderExpr = tab.dataset.expr;
      document.querySelector(`.builder-panel[data-expr="${_currentBuilderExpr}"]`)?.classList.remove('hidden');
    });
  });

  // Builder: file inputs (delegated)
  document.getElementById('builder-panels')?.addEventListener('change', async e => {
    if (!e.target.classList.contains('slot-file-input')) return;
    const file = e.target.files?.[0]; if (!file) return;
    const slot = e.target.dataset.slot;
    logProcess(`Processing ${file.name}…`);
    try {
      await window.AvatarBuilder.addMedia(file, slot);
      await refreshBuilderPreviews();
      logProcess(`${file.name} → ${slot} ✓`);
      showToast('Asset added! ✓');
    } catch (err) {
      logProcess(`${file.name}: ${err.message}`, false);
      showToast('Failed: ' + err.message, true);
    }
    e.target.value = ''; // reset so same file can be re-uploaded
  });

  // Builder: clear buttons (delegated)
  document.getElementById('builder-panels')?.addEventListener('click', async e => {
    if (!e.target.classList.contains('slot-clear-btn')) return;
    const slot = e.target.dataset.slot;
    if (!confirm(`Remove ${slot}?`)) return;
    try {
      await window.AvatarBuilder.deleteAsset(slot);
      await refreshBuilderPreviews();
      window.dispatchEvent(new CustomEvent('immortail:asset-updated', { detail: { slot } }));
      showToast('Removed');
    } catch (err) { showToast('Failed: ' + err.message, true); }
  });

  // Drop zone
  const dropZone = document.getElementById('drop-zone');
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drop-active'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drop-active'));
  dropZone?.addEventListener('drop', async e => {
    e.preventDefault(); dropZone.classList.remove('drop-active');
    const files = [...e.dataTransfer.files];
    for (const file of files) {
      const slot = _autoDetectSlot(file, _currentBuilderExpr);
      if (!slot) { logProcess(`${file.name}: unrecognised type`, false); continue; }
      logProcess(`Processing ${file.name} → ${slot}…`);
      try {
        await window.AvatarBuilder.addMedia(file, slot);
        logProcess(`${file.name} → ${slot} ✓`);
      } catch (err) { logProcess(`${file.name}: ${err.message}`, false); }
    }
    await refreshBuilderPreviews();
    showToast(`${files.length} file(s) processed`);
  });
}

// Auto-detect which slot a dropped file belongs to
function _autoDetectSlot(file, expr) {
  const t = file.type;
  if (t.startsWith('image/')) return `body:${expr}`;
  if (t.startsWith('video/')) return `video:${expr}`;
  if (t.startsWith('audio/')) return `audio:${expr}`;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS OPEN/CLOSE
// ═══════════════════════════════════════════════════════════════════════════
function openSettings() {
  document.getElementById('settings-overlay')?.classList.add('open');
  const s = window.Engine.getState();
  const ni = document.getElementById('dog-name-input');
  if (ni && s) ni.value = s.name || '';
  const ta  = document.getElementById('toggle-audio');
  const tv  = document.getElementById('range-volume');
  const tan = document.getElementById('toggle-animations');
  const tn  = document.getElementById('toggle-notifications');
  if (ta)  ta.checked  = _pwaSettings.audioEnabled !== false;
  if (tv)  tv.value    = _pwaSettings.audioVolume ?? 0.45;
  if (tan) tan.checked = _pwaSettings.animationsEnabled !== false;
  if (tn)  tn.checked  = !!_pwaSettings.notificationsEnabled;
  // Restore provider tab
  const prov = window.AI.getProvider?.() || 'groq';
  document.querySelector(`[data-provider="${prov}"]`)?.click();
}
function closeSettings() { document.getElementById('settings-overlay')?.classList.remove('open'); }

function openBuilder() { document.getElementById('builder-overlay')?.classList.add('open'); refreshBuilderPreviews(); }
function closeBuilder() { document.getElementById('builder-overlay')?.classList.remove('open'); }

function updateAIChip() {
  const dot   = document.getElementById('api-status-dot');
  const label = document.getElementById('api-status-label');
  const prov  = window.AI.getProvider?.();
  const info  = window.AI.getProviders?.()?.[prov];
  const hasKey = prov === 'ollama' || !!window.AI._keys?.[prov]; // rough check
  if (dot)   dot.className     = `status-dot ${hasKey ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = info?.label || prov || 'No AI';
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST + SPLASH
// ═══════════════════════════════════════════════════════════════════════════
function showToast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' toast-error' : ''); t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 2800);
}

function hideSplash() { const s = document.getElementById('splash'); if (!s) return; s.style.opacity = '0'; setTimeout(() => s.remove(), 580); }
function showSplashError(msg) { document.getElementById('splash-ring')?.remove(); const e = document.createElement('div'); e.className='splash-error'; e.textContent=msg; document.getElementById('splash')?.appendChild(e); }
