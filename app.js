// IMMORTAIL™ App v2
// Boot sequence + Media Composite Avatar Engine + UI

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA MANIFEST
// Maps expression → asset paths for images, video overlays, audio
// When real assets exist at these paths, they load automatically.
// When missing, the SVG fallback system kicks in — no errors thrown.
// ═══════════════════════════════════════════════════════════════════════════
const MEDIA = {
  images: {
    idle:    'assets/dog/body_idle.png',
    happy:   'assets/dog/body_happy.png',
    sad:     'assets/dog/body_sad.png',
    excited: 'assets/dog/body_happy.png'   // reuse happy until dedicated asset exists
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

// Audio throttle — min ms between audio plays
const AUDIO_THROTTLE_MS = 4000;
let _lastAudioTime = 0;
let _audioEl = null;

// Current rendered expression (avoid redundant re-renders)
let _currentExpression = null;

// ═══════════════════════════════════════════════════════════════════════════
// BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('load', async () => {

  // 1. Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(e =>
      console.warn('[Boot] SW registration failed:', e)
    );
  }

  // 2. IndexedDB
  try {
    await window.Storage.init();
  } catch (e) {
    console.error('[Boot] Storage init failed:', e);
    showFatalError('Storage unavailable. Please use a modern browser.');
    return;
  }

  // 3 + 4. Load state → Engine init
  let initialState;
  try {
    initialState = await window.Engine.init(onStateChange);
  } catch (e) {
    console.error('[Boot] Engine init failed:', e);
    showFatalError('Engine failed to start. Please refresh.');
    return;
  }

  // 5. UI render
  renderState(initialState);
  await loadAndRenderMemory();
  hideSplash();

  // 6. AI enable
  const savedKey = localStorage.getItem('immortail_api_key');
  if (savedKey) {
    window.AI.setApiKey(savedKey);
    setApiStatus(true);
  }

  bindEvents();
  initAudio();
});

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA COMPOSITE AVATAR ENGINE
// Renders dog as layered DOM elements: base image → face → video overlay
// Falls back gracefully to SVG if real assets are absent
// ═══════════════════════════════════════════════════════════════════════════

function renderDog(expression) {
  if (_currentExpression === expression) return; // no-op if no change
  _currentExpression = expression;

  const stage = document.getElementById('dog-stage');

  // ── Base body image ──────────────────────────────────────────────────────
  const baseEl = document.getElementById('dog-base-img');
  const baseSrc = MEDIA.images[expression] || MEDIA.images.idle;
  _setImageSrc(baseEl, baseSrc);

  // ── Face/eyes overlay image ──────────────────────────────────────────────
  const faceEl = document.getElementById('dog-face-img');
  const faceSrc = MEDIA.faces[expression] || MEDIA.faces.idle;
  _setImageSrc(faceEl, faceSrc);

  // ── Video overlay (micro loop) ───────────────────────────────────────────
  const videoEl = document.getElementById('dog-video-overlay');
  const videoSrc = MEDIA.videos[expression];
  _setVideoSrc(videoEl, videoSrc);

  // ── SVG fallback expressions ─────────────────────────────────────────────
  _updateSVGExpression(expression);

  // ── Stage glow class ─────────────────────────────────────────────────────
  stage.className = `dog-stage expr-${expression}`;
  document.body.className = `mood-${expression}`;
}

function _setImageSrc(el, src) {
  if (!el || !src) return;
  if (el.getAttribute('data-src') === src) return; // already set
  el.setAttribute('data-src', src);

  const img = new Image();
  img.onload = () => {
    el.src = src;
    el.style.display = 'block';
    el.style.opacity = '0';
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  };
  img.onerror = () => {
    // Real asset missing — SVG fallback is already showing
    el.style.display = 'none';
  };
  img.src = src;
}

function _setVideoSrc(el, src) {
  if (!el) return;
  if (!src) {
    el.pause();
    el.style.display = 'none';
    return;
  }
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  el.style.display = 'none';

  el.src = src;
  el.load();

  el.oncanplay = () => {
    el.style.display = 'block';
    el.play().catch(() => { el.style.display = 'none'; });
  };
  el.onerror = () => {
    el.style.display = 'none'; // video missing — SVG animations cover this
  };
}

// SVG expressions — always visible as base, enhanced by real assets when available
function _updateSVGExpression(expression) {
  const mouth     = document.getElementById('svg-mouth');
  const leftEye   = document.getElementById('svg-eye-l');
  const rightEye  = document.getElementById('svg-eye-r');
  const tail      = document.getElementById('svg-tail');
  const brow_l    = document.getElementById('svg-brow-l');
  const brow_r    = document.getElementById('svg-brow-r');
  const tongue    = document.getElementById('svg-tongue');

  const configs = {
    idle: {
      mouth:   'M 40 63 Q 50 67 60 63',
      eyeRy:   5,
      tailDur: '1.1s',
      browY:   0,
      tongue:  false
    },
    happy: {
      mouth:   'M 37 61 Q 50 74 63 61',
      eyeRy:   4,
      tailDur: '0.35s',
      browY:   -2,
      tongue:  true
    },
    sad: {
      mouth:   'M 37 66 Q 50 58 63 66',
      eyeRy:   2.5,
      tailDur: '2.2s',
      browY:   3,
      tongue:  false
    },
    excited: {
      mouth:   'M 36 60 Q 50 76 64 60',
      eyeRy:   5,
      tailDur: '0.22s',
      browY:   -3,
      tongue:  true
    }
  };

  const cfg = configs[expression] || configs.idle;

  if (mouth)   mouth.setAttribute('d', cfg.mouth);
  if (leftEye) leftEye.setAttribute('ry', cfg.eyeRy);
  if (rightEye) rightEye.setAttribute('ry', cfg.eyeRy);
  if (tail)    { const anim = tail.querySelector('animateTransform'); if (anim) anim.setAttribute('dur', cfg.tailDur); }
  if (brow_l)  brow_l.setAttribute('transform', `translate(0, ${cfg.browY})`);
  if (brow_r)  brow_r.setAttribute('transform', `translate(0, ${cfg.browY})`);
  if (tongue)  tongue.style.display = cfg.tongue ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO SYSTEM — throttled, non-overlapping
// ═══════════════════════════════════════════════════════════════════════════
function initAudio() {
  _audioEl = new Audio();
  _audioEl.volume = 0.45;
  // Preconnect audio context on user gesture (Safari requirement)
  document.body.addEventListener('click', () => {
    if (_audioEl && _audioEl.paused && !_audioEl.src) {
      _audioEl.load(); // prime it
    }
  }, { once: true });
}

function playAudio(expression) {
  const now = Date.now();
  if (now - _lastAudioTime < AUDIO_THROTTLE_MS) return;
  if (!_audioEl) return;

  const src = MEDIA.audio[expression];
  if (!src) return;

  _lastAudioTime = now;
  _audioEl.pause();
  _audioEl.src    = src;
  _audioEl.volume = expression === 'excited' ? 0.6 : 0.4;

  _audioEl.load();
  _audioEl.play().catch(() => {}); // silently fail if audio missing
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE → UI
// ═══════════════════════════════════════════════════════════════════════════
function onStateChange(state) {
  renderState(state);
}

function renderState(state) {
  if (!state) return;

  // Dog name
  document.getElementById('dog-name-display').textContent = state.name || 'Rex';

  // Expression label + badge
  const badges = { idle: '😐 Idle', happy: '😄 Happy', sad: '😢 Sad', excited: '🐾 Excited' };
  document.getElementById('mood-badge').textContent = badges[state.expression] || '😐 Idle';

  // Stats
  setBar('energy-bar', state.energy);
  setBar('bond-bar',   state.bond);
  document.getElementById('energy-val').textContent = Math.round(state.energy);
  document.getElementById('bond-val').textContent   = Math.round(state.bond);

  // Dog avatar
  renderDog(state.expression);
}

function setBar(id, val) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.round(Math.min(100, Math.max(0, val)))}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAT + MESSAGE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
async function loadAndRenderMemory() {
  const memories = await window.Storage.loadMemory();
  const container = document.getElementById('chat-history');
  container.innerHTML = '';
  if (memories.length === 0) {
    showWelcome();
  } else {
    memories.forEach(m => appendMessage(m.role, m.content, false));
    scrollChat();
  }
}

function showWelcome() {
  const container = document.getElementById('chat-history');
  const el = document.createElement('div');
  el.id = 'chat-welcome';
  el.className = 'chat-welcome';
  el.innerHTML = `
    <div class="welcome-paw">🐾</div>
    <div class="welcome-text">Your companion is waiting.<br/>Say hello, feed them, or just chat.</div>
    <div class="welcome-hint">Add your OpenAI key in Settings for full AI responses.</div>
  `;
  container.appendChild(el);
}

function removeWelcome() {
  document.getElementById('chat-welcome')?.remove();
}

function appendMessage(role, content, scroll = true) {
  removeWelcome();
  const container = document.getElementById('chat-history');
  const row = document.createElement('div');
  row.className = `chat-msg ${role === 'user' ? 'msg-user' : 'msg-dog'}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  row.appendChild(bubble);
  container.appendChild(row);
  if (scroll) scrollChat();
}

function scrollChat() {
  const c = document.getElementById('chat-history');
  c.scrollTop = c.scrollHeight;
}

// ── Typing indicator ───────────────────────────────────────────────────────
function showTyping() {
  const id = `typing-${Date.now()}`;
  const container = document.getElementById('chat-history');
  const row = document.createElement('div');
  row.id = id;
  row.className = 'chat-msg msg-dog';
  row.innerHTML = '<div class="bubble typing-bubble"><span></span><span></span><span></span></div>';
  container.appendChild(row);
  scrollChat();
  return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

// ═══════════════════════════════════════════════════════════════════════════
// SEND FLOW
// ═══════════════════════════════════════════════════════════════════════════
let _sendLock = false;

async function handleSend() {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg || _sendLock) return;

  _sendLock = true;
  input.value    = '';
  input.disabled = true;

  // 1. Show user message
  appendMessage('user', msg);
  await window.Storage.addMemory({ role: 'user', content: msg });

  // 2. Engine: register interaction
  const state = await window.Engine.dispatch({ type: 'CHAT' });

  // 3. Play audio for current expression
  playAudio(state?.expression || 'idle');

  // 4. Get updated memories for AI context
  const memories = await window.Storage.loadMemory();

  // 5. AI request
  const typingId = showTyping();
  let response;
  if (window.AI.isBusy()) {
    response = window.AI.getFallback(state?.expression || 'idle');
  } else {
    response = await window.AI.ask(msg, state || window.Engine.getState(), memories);
  }

  removeTyping(typingId);
  const dogReply = response || window.AI.getFallback(state?.expression || 'idle');
  appendMessage('dog', dogReply);

  // 6. Save dog reply + enforce cap
  await window.Storage.addMemory({ role: 'dog', content: dogReply });
  await window.Storage.enforceMemoryCap();

  input.disabled = false;
  input.focus();
  _sendLock = false;
}

// ── Action buttons ─────────────────────────────────────────────────────────
async function handleAction(type, displayMsg, audioOverride) {
  const state = await window.Engine.dispatch({ type });
  playAudio(audioOverride || state?.expression || 'idle');
  appendMessage('dog', displayMsg);
  await window.Storage.addMemory({ role: 'dog', content: displayMsg });
  await window.Storage.enforceMemoryCap();
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // Chat
  document.getElementById('send-btn').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Pet the dog (tap the stage)
  document.getElementById('dog-stage').addEventListener('click', async () => {
    const state = await window.Engine.dispatch({ type: 'PET' });
    playAudio(state?.expression || 'idle');
    showToast(`${state?.name || 'Rex'} loves the attention! 🐾`);
    // brief excited override
    renderDog('excited');
    setTimeout(() => renderDog(state?.expression || 'idle'), 800);
  });

  // Action buttons
  document.getElementById('btn-feed').addEventListener('click', () =>
    handleAction('FEED', '🍖 *gobbles up the food and wags tail happily*', 'happy')
  );
  document.getElementById('btn-play').addEventListener('click', () =>
    handleAction('PLAY', '🎾 *zooms around excitedly and fetches the ball!*', 'excited')
  );
  document.getElementById('btn-rest').addEventListener('click', () =>
    handleAction('REST', '💤 *curls up in a cozy spot and sighs contentedly*', 'idle')
  );

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-overlay')) closeSettings();
  });

  // API Key
  document.getElementById('save-api-key').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      window.AI.setApiKey(key);
      localStorage.setItem('immortail_api_key', key);
      setApiStatus(true);
      showToast('API key saved ✓');
    }
  });
  document.getElementById('clear-api-key').addEventListener('click', () => {
    window.AI.setApiKey(null);
    localStorage.removeItem('immortail_api_key');
    document.getElementById('api-key-input').value = '';
    setApiStatus(false);
    showToast('API key removed');
  });

  // Rename
  document.getElementById('save-name').addEventListener('click', async () => {
    const name = document.getElementById('dog-name-input').value.trim();
    if (name) {
      await window.Engine.dispatch({ type: 'RENAME', name });
      showToast(`Renamed to ${name} ✓`);
    }
  });

  // Export
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const key = await window.Storage.exportKey();
      document.getElementById('export-output').value = key;
      showToast('Migration key ready ✓');
    } catch (e) {
      showToast('Export failed: ' + e.message, true);
    }
  });
  document.getElementById('copy-export').addEventListener('click', () => {
    const val = document.getElementById('export-output').value;
    if (val) navigator.clipboard.writeText(val).then(() => showToast('Copied ✓'));
  });

  // Import
  document.getElementById('import-btn').addEventListener('click', async () => {
    const keyStr = document.getElementById('import-input').value.trim();
    if (!keyStr) { showToast('Paste a migration key first', true); return; }

    const existing = window.Engine.getState();
    if (existing?.totalInteractions > 0) {
      const ok = window.confirm(
        `⚠ This will overwrite ${existing.name} (${existing.totalInteractions} interactions). Continue?`
      );
      if (!ok) return;
    }
    try {
      await window.Storage.importKey(keyStr);
      showToast('Imported! Reloading…');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showToast('Import failed: ' + e.message, true);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
  const s = window.Engine.getState();
  if (s) document.getElementById('dog-name-input').value = s.name || '';
  if (localStorage.getItem('immortail_api_key')) {
    document.getElementById('api-key-input').placeholder = 'sk-••••••••••••••••';
  }
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function setApiStatus(on) {
  const dot   = document.getElementById('api-status-dot');
  const label = document.getElementById('api-status-label');
  if (dot)   dot.className  = 'status-dot ' + (on ? 'connected' : 'disconnected');
  if (label) label.textContent = on ? 'AI Connected' : 'Fallback Mode';
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════
function showToast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 2800);
}

// ═══════════════════════════════════════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════════════════════════════════════
function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.style.opacity = '0';
  setTimeout(() => s.remove(), 600);
}

function showFatalError(msg) {
  const s = document.getElementById('splash');
  if (s) s.innerHTML = `<div class="splash-error">${msg}</div>`;
}
