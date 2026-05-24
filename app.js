// IMMORTAIL™ App v3
// Boot + Media Composite Avatar Engine + UI
// Defensive boot: each step isolated, never crashes on missing assets

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA MANIFEST
// ═══════════════════════════════════════════════════════════════════════════
const MEDIA = {
  images: {
    idle:    'assets/dog/body_idle.png',
    happy:   'assets/dog/body_happy.png',
    sad:     'assets/dog/body_sad.png',
    excited: 'assets/dog/body_happy.png'
  },
  faces: {
    idle:    'assets/dog/eyes_idle.png',
    happy:   'assets/dog/eyes_happy.png',
    sad:     'assets/dog/eyes_sad.png',
    excited: 'assets/dog/eyes_happy.png'
  },
  videos: {
    idle:    'assets/dog/blink.webm',
    happy:   'assets/dog/tail_wag.webm',
    sad:     null,
    excited: 'assets/dog/bounce.webm'
  },
  audio: {
    idle:    'assets/audio/breath_idle.mp3',
    happy:   'assets/audio/bark_soft.mp3',
    sad:     'assets/audio/whine.mp3',
    excited: 'assets/audio/bark_excited.mp3'
  }
};

const AUDIO_THROTTLE_MS = 4000;
let _lastAudioTime     = 0;
let _audioEl           = null;
let _currentExpression = null;

// ═══════════════════════════════════════════════════════════════════════════
// BOOT SEQUENCE — isolated steps, never fatal-errors on recoverable issues
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('load', async () => {

  // Step 1 — Service Worker (non-blocking, failure is fine)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(e => console.warn('[Boot] SW:', e.message));
  }

  // Step 2 — Storage init
  let storageOk = false;
  try {
    await window.Storage.init();
    storageOk = true;
  } catch (e) {
    console.error('[Boot] Storage failed:', e.message);
    // Show degraded mode rather than hard crash
    showSplashError('Storage unavailable — running in limited mode.');
    // Continue anyway with in-memory fallback (engine handles null saved state)
  }

  // Step 3+4 — Engine init (always attempt, engine is defensive internally)
  let initialState = null;
  try {
    initialState = await window.Engine.init(onStateChange);
  } catch (e) {
    console.error('[Boot] Engine failed:', e.message);
    // Engine couldn't start — this is the real fatal case
    showSplashError('Failed to start. Try refreshing, or clear your browser data for this site.');
    return; // stop here — can't render without state
  }

  // Step 5 — UI render
  try {
    renderState(initialState);
    await loadAndRenderMemory();
  } catch (e) {
    console.warn('[Boot] UI render partial failure:', e.message);
    // Non-fatal — app still usable
  }

  hideSplash();

  // Step 6 — AI
  try {
    const savedKey = localStorage.getItem('immortail_api_key');
    if (savedKey) {
      window.AI.setApiKey(savedKey);
      setApiStatus(true);
    }
  } catch (e) {
    console.warn('[Boot] AI key load failed:', e.message);
  }

  initAudio();
  bindEvents();
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITE AVATAR RENDERING
// ═══════════════════════════════════════════════════════════════════════════
function renderDog(expression) {
  if (_currentExpression === expression) return;
  _currentExpression = expression;

  try {
    const stage = document.getElementById('dog-stage');
    if (stage) stage.className = `dog-stage expr-${expression}`;
    document.body.className = `mood-${expression}`;

    _setImageSrc(document.getElementById('dog-base-img'), MEDIA.images[expression] || MEDIA.images.idle);
    _setImageSrc(document.getElementById('dog-face-img'), MEDIA.faces[expression]  || MEDIA.faces.idle);
    _setVideoSrc(document.getElementById('dog-video-overlay'), MEDIA.videos[expression] || null);
    _updateSVGExpression(expression);
  } catch (e) {
    console.warn('[Render] Dog render error:', e.message);
  }
}

function _setImageSrc(el, src) {
  if (!el || !src) return;
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  const img = new Image();
  img.onload = () => {
    el.src = src;
    el.style.display = 'block';
    el.style.opacity = '0';
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.35s'; el.style.opacity = '1'; });
  };
  img.onerror = () => { el.style.display = 'none'; };
  img.src = src;
}

function _setVideoSrc(el, src) {
  if (!el) return;
  if (!src) { el.pause(); el.removeAttribute('src'); el.style.display = 'none'; return; }
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  el.style.display = 'none';
  el.src = src;
  el.load();
  el.oncanplay = () => {
    el.style.display = 'block';
    el.play().catch(() => { el.style.display = 'none'; });
  };
  el.onerror = () => { el.style.display = 'none'; };
}

function _updateSVGExpression(expression) {
  const mouth  = document.getElementById('svg-mouth');
  const eyeL   = document.getElementById('svg-eye-l');
  const eyeR   = document.getElementById('svg-eye-r');
  const tail   = document.getElementById('svg-tail');
  const browL  = document.getElementById('svg-brow-l');
  const browR  = document.getElementById('svg-brow-r');
  const tongue = document.getElementById('svg-tongue');

  const cfg = {
    idle:    { mouth: 'M 40 63 Q 50 67 60 63', eyeRy: 5,   tailDur: '1.1s',  browY: 0,  tongue: false },
    happy:   { mouth: 'M 37 61 Q 50 74 63 61', eyeRy: 4,   tailDur: '0.35s', browY: -2, tongue: true  },
    sad:     { mouth: 'M 37 66 Q 50 58 63 66', eyeRy: 2.5, tailDur: '2.2s',  browY: 3,  tongue: false },
    excited: { mouth: 'M 36 60 Q 50 76 64 60', eyeRy: 5,   tailDur: '0.22s', browY: -3, tongue: true  }
  }[expression] || { mouth: 'M 40 63 Q 50 67 60 63', eyeRy: 5, tailDur: '1.1s', browY: 0, tongue: false };

  if (mouth)  mouth.setAttribute('d', cfg.mouth);
  if (eyeL)   eyeL.setAttribute('ry', cfg.eyeRy);
  if (eyeR)   eyeR.setAttribute('ry', cfg.eyeRy);
  if (tail)   { const a = tail.querySelector('animateTransform'); if (a) a.setAttribute('dur', cfg.tailDur); }
  if (browL)  browL.setAttribute('transform', `translate(0,${cfg.browY})`);
  if (browR)  browR.setAttribute('transform', `translate(0,${cfg.browY})`);
  if (tongue) tongue.style.display = cfg.tongue ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════════════════
function initAudio() {
  try {
    _audioEl = new Audio();
    _audioEl.volume = 0.45;
  } catch (e) {
    _audioEl = null;
  }
}

function playAudio(expression) {
  if (!_audioEl) return;
  const now = Date.now();
  if (now - _lastAudioTime < AUDIO_THROTTLE_MS) return;
  const src = MEDIA.audio[expression];
  if (!src) return;
  _lastAudioTime = now;
  try {
    _audioEl.pause();
    _audioEl.src    = src;
    _audioEl.volume = expression === 'excited' ? 0.6 : 0.4;
    _audioEl.load();
    _audioEl.play().catch(() => {});
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE → UI
// ═══════════════════════════════════════════════════════════════════════════
function onStateChange(state) { renderState(state); }

function renderState(state) {
  if (!state) return;
  const nameEl = document.getElementById('dog-name-display');
  if (nameEl) nameEl.textContent = state.name || 'Rex';

  const badgeEl = document.getElementById('mood-badge');
  const badges  = { idle: '😐 Idle', happy: '😄 Happy', sad: '😢 Sad', excited: '🐾 Excited' };
  if (badgeEl) badgeEl.textContent = badges[state.expression] || '😐 Idle';

  setBar('energy-bar', state.energy);
  setBar('bond-bar',   state.bond);

  const ev = document.getElementById('energy-val');
  const bv = document.getElementById('bond-val');
  if (ev) ev.textContent = Math.round(state.energy);
  if (bv) bv.textContent = Math.round(state.bond);

  renderDog(state.expression || 'idle');
}

function setBar(id, val) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.round(Math.min(100, Math.max(0, val || 0)))}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderMemory() {
  let memories = [];
  try { memories = await window.Storage.loadMemory(); } catch (e) {}
  const container = document.getElementById('chat-history');
  if (!container) return;
  container.innerHTML = '';
  if (memories.length === 0) {
    showWelcome();
  } else {
    memories.forEach(m => appendMessage(m.role, m.content, false));
    scrollChat();
  }
}

function showWelcome() {
  const c = document.getElementById('chat-history');
  if (!c) return;
  const el = document.createElement('div');
  el.id = 'chat-welcome';
  el.className = 'chat-welcome';
  el.innerHTML = `
    <div class="welcome-paw">🐾</div>
    <div class="welcome-text">Your companion is waiting.<br/>Say hello, feed them, or just chat.</div>
    <div class="welcome-hint">Add your OpenAI key in ⚙ Settings for full AI responses.</div>
  `;
  c.appendChild(el);
}

function removeWelcome() { document.getElementById('chat-welcome')?.remove(); }

function appendMessage(role, content, scroll = true) {
  removeWelcome();
  const c = document.getElementById('chat-history');
  if (!c) return;
  const row    = document.createElement('div');
  row.className = `chat-msg ${role === 'user' ? 'msg-user' : 'msg-dog'}`;
  const bubble  = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  row.appendChild(bubble);
  c.appendChild(row);
  if (scroll) scrollChat();
}

function scrollChat() {
  const c = document.getElementById('chat-history');
  if (c) c.scrollTop = c.scrollHeight;
}

function showTyping() {
  const id = `typing-${Date.now()}`;
  const c  = document.getElementById('chat-history');
  if (!c) return id;
  const row = document.createElement('div');
  row.id = id;
  row.className = 'chat-msg msg-dog';
  row.innerHTML = '<div class="bubble typing-bubble"><span></span><span></span><span></span></div>';
  c.appendChild(row);
  scrollChat();
  return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

// ═══════════════════════════════════════════════════════════════════════════
// SEND
// ═══════════════════════════════════════════════════════════════════════════
let _sendLock = false;

async function handleSend() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg || _sendLock) return;

  _sendLock      = true;
  input.value    = '';
  input.disabled = true;

  appendMessage('user', msg);

  try { await window.Storage.addMemory({ role: 'user', content: msg }); } catch (e) {}

  let state = null;
  try { state = await window.Engine.dispatch({ type: 'CHAT' }); } catch (e) {}
  state = state || window.Engine.getState() || { expression: 'idle', name: 'Rex' };

  playAudio(state.expression);

  let memories = [];
  try { memories = await window.Storage.loadMemory(); } catch (e) {}

  const typingId = showTyping();

  let response = null;
  try {
    if (!window.AI.isBusy()) {
      response = await window.AI.ask(msg, state, memories);
    }
  } catch (e) {}

  removeTyping(typingId);
  const reply = response || window.AI.getFallback(state.expression);
  appendMessage('dog', reply);

  try { await window.Storage.addMemory({ role: 'dog', content: reply }); } catch (e) {}
  try { await window.Storage.enforceMemoryCap(); } catch (e) {}

  input.disabled = false;
  input.focus();
  _sendLock = false;
}

async function handleAction(type, displayMsg, audioExpr) {
  let state = null;
  try { state = await window.Engine.dispatch({ type }); } catch (e) {}
  playAudio(audioExpr || state?.expression || 'idle');
  appendMessage('dog', displayMsg);
  try { await window.Storage.addMemory({ role: 'dog', content: displayMsg }); } catch (e) {}
  try { await window.Storage.enforceMemoryCap(); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  const $  = (id) => document.getElementById(id);

  $('send-btn')?.addEventListener('click', handleSend);
  $('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Tap dog to pet
  $('dog-stage')?.addEventListener('click', async () => {
    let state = null;
    try { state = await window.Engine.dispatch({ type: 'PET' }); } catch (e) {}
    playAudio(state?.expression || 'idle');
    const name = state?.name || 'Rex';
    showToast(`${name} loves the attention! 🐾`);
    renderDog('excited');
    setTimeout(() => renderDog(state?.expression || 'idle'), 900);
  });

  $('btn-feed')?.addEventListener('click', () =>
    handleAction('FEED', '🍖 *gobbles up the food and wags tail happily*', 'happy'));
  $('btn-play')?.addEventListener('click', () =>
    handleAction('PLAY', '🎾 *zooms around excitedly and fetches the ball!*', 'excited'));
  $('btn-rest')?.addEventListener('click', () =>
    handleAction('REST', '💤 *curls up in a cozy spot and sighs contentedly*', 'idle'));

  $('settings-btn')?.addEventListener('click', openSettings);
  $('close-settings')?.addEventListener('click', closeSettings);
  $('settings-overlay')?.addEventListener('click', e => {
    if (e.target === $('settings-overlay')) closeSettings();
  });

  $('save-api-key')?.addEventListener('click', () => {
    const key = $('api-key-input')?.value.trim();
    if (key) {
      window.AI.setApiKey(key);
      try { localStorage.setItem('immortail_api_key', key); } catch (e) {}
      setApiStatus(true);
      showToast('API key saved ✓');
    }
  });

  $('clear-api-key')?.addEventListener('click', () => {
    window.AI.setApiKey(null);
    try { localStorage.removeItem('immortail_api_key'); } catch (e) {}
    if ($('api-key-input')) $('api-key-input').value = '';
    setApiStatus(false);
    showToast('API key cleared');
  });

  $('save-name')?.addEventListener('click', async () => {
    const name = $('dog-name-input')?.value.trim();
    if (name) {
      try { await window.Engine.dispatch({ type: 'RENAME', name }); } catch (e) {}
      showToast(`Renamed to ${name} ✓`);
    }
  });

  $('export-btn')?.addEventListener('click', async () => {
    try {
      const key = await window.Storage.exportKey();
      if ($('export-output')) $('export-output').value = key;
      showToast('Migration key ready ✓');
    } catch (e) { showToast('Export failed: ' + e.message, true); }
  });

  $('copy-export')?.addEventListener('click', () => {
    const val = $('export-output')?.value;
    if (val) navigator.clipboard?.writeText(val).then(() => showToast('Copied ✓')).catch(() => {});
  });

  $('import-btn')?.addEventListener('click', async () => {
    const keyStr = $('import-input')?.value.trim();
    if (!keyStr) { showToast('Paste a migration key first', true); return; }
    const existing = window.Engine.getState();
    if (existing?.totalInteractions > 0) {
      if (!window.confirm(`⚠ This will overwrite ${existing.name} (${existing.totalInteractions} interactions). Continue?`)) return;
    }
    try {
      await window.Storage.importKey(keyStr);
      showToast('Imported! Reloading…');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { showToast('Import failed: ' + e.message, true); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function openSettings() {
  document.getElementById('settings-overlay')?.classList.add('open');
  const s = window.Engine.getState();
  const ni = document.getElementById('dog-name-input');
  if (ni && s) ni.value = s.name || '';
  try {
    if (localStorage.getItem('immortail_api_key')) {
      const ki = document.getElementById('api-key-input');
      if (ki) ki.placeholder = 'sk-••••••••••••••••';
    }
  } catch (e) {}
}

function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

function setApiStatus(on) {
  const dot   = document.getElementById('api-status-dot');
  const label = document.getElementById('api-status-label');
  if (dot)   dot.className     = 'status-dot ' + (on ? 'connected' : 'disconnected');
  if (label) label.textContent = on ? 'AI Connected' : 'Fallback Mode';
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════
function showToast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className   = 'toast' + (isError ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 2800);
}

// ═══════════════════════════════════════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════════════════════════════════════
function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.style.opacity = '0';
  setTimeout(() => s.remove(), 580);
}

function showSplashError(msg) {
  const s = document.getElementById('splash');
  const r = document.getElementById('splash-ring');
  if (r) r.style.display = 'none';
  const err = document.createElement('div');
  err.className   = 'splash-error';
  err.textContent = msg;
  if (s) s.appendChild(err);
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-AI SETTINGS UI (appended to app.js)
// ═══════════════════════════════════════════════════════════════════════════

function bindAISettings() {
  const $ = (id) => document.getElementById(id);

  // Provider tab switching
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.provider-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      const panel = $(`panel-${tab.dataset.provider}`);
      if (panel) panel.classList.remove('hidden');
    });
  });

  // Save key buttons (OpenAI, OpenRouter, Groq)
  document.querySelectorAll('[data-save-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const provider = btn.dataset.saveKey;
      const keyEl    = $(`key-${provider}`);
      const key      = keyEl?.value.trim();
      if (!key) { showToast('Enter a key first', true); return; }
      window.AI.setKey(provider, key);
      window.AI.saveConfig();
      showToast(`${provider} key saved ✓`);
    });
  });

  // Ollama ping
  $('ollama-ping')?.addEventListener('click', async () => {
    const statusEl = $('ollama-status');
    const baseUrl  = $('key-ollama')?.value.trim() || 'http://localhost:11434';
    if (statusEl) statusEl.textContent = 'Pinging…';
    const result = await window.AI.pingOllama(baseUrl);
    if (result.ok) {
      window.AI.setKey('ollama', baseUrl);
      window.AI.saveConfig();
      const modelSel = $('model-ollama');
      // Populate with live models if we got them
      if (result.models.length && modelSel) {
        modelSel.innerHTML = result.models
          .map(m => `<option value="${m}">${m}</option>`).join('');
      }
      if (statusEl) statusEl.innerHTML = `<span style="color:#4ade80">✓ Connected — ${result.models.length} model(s) available</span>`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">✗ Not reachable — is Ollama running?</span>`;
    }
  });

  // Activate provider
  $('activate-provider')?.addEventListener('click', () => {
    const activeTab = document.querySelector('.provider-tab.active');
    if (!activeTab) return;
    const provider = activeTab.dataset.provider;
    const modelSel = $(`model-${provider}`);
    const model    = modelSel?.value || null;
    window.AI.setProvider(provider, model);
    window.AI.saveConfig();
    updateAIChip();
    showToast(`${provider} activated ✓`);
    closeSettings();
  });

  // Restore saved UI state
  const cfg = window.AI;
  const savedProvider = cfg.getProvider?.() || 'openai';
  const tab = document.querySelector(`[data-provider="${savedProvider}"]`);
  if (tab) tab.click();
}

function updateAIChip() {
  const dot   = document.getElementById('api-status-dot');
  const label = document.getElementById('api-status-label');
  const prov  = window.AI.getProvider?.();
  const provs = window.AI.getProviders?.() || {};
  const info  = provs[prov];

  // Check if provider has credentials
  const hasKey = prov === 'ollama'
    ? true  // Ollama doesn't need a key
    : !!localStorage.getItem('immortail_ai_config');

  if (dot)   dot.className     = `status-dot ${hasKey ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = hasKey ? (info?.label || prov) : 'No AI';
}

// Check which assets are present and show dots in settings
function checkAssets() {
  const assets = [
    { id: 'ast-body_idle',   src: 'assets/dog/body_idle.png' },
    { id: 'ast-body_happy',  src: 'assets/dog/body_happy.png' },
    { id: 'ast-body_sad',    src: 'assets/dog/body_sad.png' },
    { id: 'ast-eyes_idle',   src: 'assets/dog/eyes_idle.png' },
    { id: 'ast-eyes_happy',  src: 'assets/dog/eyes_happy.png' },
    { id: 'ast-eyes_sad',    src: 'assets/dog/eyes_sad.png' },
    { id: 'ast-tail_wag',    src: 'assets/dog/tail_wag.webm' },
    { id: 'ast-blink',       src: 'assets/dog/blink.webm' },
    { id: 'ast-bounce',      src: 'assets/dog/bounce.webm' },
  ];
  assets.forEach(({ id, src }) => {
    const dot = document.getElementById(id);
    if (!dot) return;
    const img = new Image();
    img.onload  = () => { dot.classList.add('dot-ok');  };
    img.onerror = () => { dot.classList.add('dot-missing'); };
    img.src = src + '?t=' + Date.now();
  });
}

// Hook into existing openSettings / bindEvents
const _origOpenSettings = openSettings;
openSettings = function() {
  _origOpenSettings();
  checkAssets();
  // Restore key field hints
  ['openai','openrouter','groq'].forEach(p => {
    const el = document.getElementById(`key-${p}`);
    if (el) el.placeholder = el.placeholder; // keep as-is
  });
};

// Run after bindEvents
document.addEventListener('DOMContentLoaded', () => {}, false);
// Extend bindEvents — called from boot
const _origBind = bindEvents;
bindEvents = function() {
  _origBind();
  bindAISettings();
  updateAIChip();
};
