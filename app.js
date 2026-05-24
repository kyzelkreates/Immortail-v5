// IMMORTAIL™ App v5
// Full installable PWA — config in IndexedDB, offline-first, SW update flow

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
let _pwaSettings       = {};
let _deferredInstall   = null; // PWA install prompt event

// ═══════════════════════════════════════════════════════════════════════════
// BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('load', async () => {

  // Step 1 — Service Worker + update detection
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      // Detect SW update available
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW?.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
      // Page reload after SW takes control
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    } catch (e) {
      console.warn('[Boot] SW:', e.message);
    }
  }

  // Step 2 — IndexedDB
  try {
    await window.Storage.init();
  } catch (e) {
    console.error('[Boot] Storage failed:', e.message);
    showSplashError('Storage unavailable — try a different browser or disable private mode.');
    return;
  }

  // Step 3 — Load PWA settings from IDB
  try {
    _pwaSettings = await window.Storage.loadPWASettings();
  } catch (e) {
    _pwaSettings = {};
  }

  // Step 4 — Load AI config from IDB
  try {
    await window.AI.loadConfig();
  } catch (e) {
    console.warn('[Boot] AI config load failed:', e.message);
  }

  // Step 5 — Engine init
  let initialState = null;
  try {
    initialState = await window.Engine.init(onStateChange);
  } catch (e) {
    console.error('[Boot] Engine failed:', e.message);
    showSplashError('Engine failed to start — try refreshing, or clear site data.');
    return;
  }

  // Step 6 — UI render
  try {
    applyPWASettings(_pwaSettings);
    renderState(initialState);
    await loadAndRenderMemory();
  } catch (e) {
    console.warn('[Boot] UI partial failure:', e.message);
  }

  hideSplash();
  initAudio();
  bindEvents();
  checkInstallability();
  handleURLActions(); // handle ?action= shortcuts
});

// ═══════════════════════════════════════════════════════════════════════════
// PWA INSTALL
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
  // Show install button in settings
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
  showToast('IMMORTAIL™ installed! 🐾');
});

function checkInstallability() {
  // Show install button if prompt is available OR on iOS (where we explain manually)
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;

  if (!isStandalone) {
    const btn = document.getElementById('install-btn');
    if (btn && (isIOS || _deferredInstall)) btn.style.display = 'flex';

    if (isIOS) {
      // iOS: show instruction (no prompt API)
      const btn2 = document.getElementById('install-btn');
      if (btn2) {
        btn2.addEventListener('click', () => {
          showToast('Tap Share → "Add to Home Screen" in Safari to install 🐾');
        });
      }
    }
  }
}

async function triggerInstall() {
  if (!_deferredInstall) return;
  _deferredInstall.prompt();
  const { outcome } = await _deferredInstall.userChoice;
  if (outcome === 'accepted') _deferredInstall = null;
}

function showUpdateBanner() {
  const existing = document.getElementById('update-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>🔄 Update available</span>
    <button id="update-apply">Reload & Update</button>
    <button id="update-dismiss">✕</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('update-apply')?.addEventListener('click', () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
  });
  document.getElementById('update-dismiss')?.addEventListener('click', () => banner.remove());
}

// Handle ?action= URL params (from manifest shortcuts)
function handleURLActions() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (!action) return;
  // Clear the param from URL without reload
  window.history.replaceState({}, '', '/');
  // Dispatch action after short delay (let UI settle)
  setTimeout(() => {
    if (action === 'feed') handleAction('FEED', '🍖 *gobbles up the food happily!*', 'happy');
    if (action === 'play') handleAction('PLAY', '🎾 *zooms around excitedly!*', 'excited');
  }, 800);
}

// ═══════════════════════════════════════════════════════════════════════════
// PWA SETTINGS — applied from IDB config
// ═══════════════════════════════════════════════════════════════════════════
function applyPWASettings(s) {
  _pwaSettings = s || {};
  if (_audioEl) _audioEl.volume = s.audioVolume ?? 0.45;
  if (!s.animationsEnabled) {
    document.documentElement.style.setProperty('--anim-speed', '0.01s');
  } else {
    document.documentElement.style.removeProperty('--anim-speed');
  }
  if (s.theme === 'light') document.body.classList.add('theme-light');
  else document.body.classList.remove('theme-light');
}

async function savePWASettings(overrides) {
  _pwaSettings = { ..._pwaSettings, ...overrides };
  applyPWASettings(_pwaSettings);
  await window.Storage.savePWASettings(_pwaSettings);
}

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
    if (_pwaSettings.animationsEnabled !== false) {
      _setVideoSrc(document.getElementById('dog-video-overlay'), MEDIA.videos[expression] || null);
    }
    _updateSVGExpression(expression);
  } catch (e) {
    console.warn('[Render]', e.message);
  }
}

function _setImageSrc(el, src) {
  if (!el || !src) return;
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  const img = new Image();
  img.onload = () => {
    el.src = src; el.style.display = 'block'; el.style.opacity = '0';
    requestAnimationFrame(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '1'; });
  };
  img.onerror = () => { el.style.display = 'none'; };
  img.src = src;
}

function _setVideoSrc(el, src) {
  if (!el) return;
  if (!src) { el.pause(); el.removeAttribute('src'); el.style.display = 'none'; return; }
  if (el.getAttribute('data-src') === src) return;
  el.setAttribute('data-src', src);
  el.style.display = 'none'; el.src = src; el.load();
  el.oncanplay = () => { el.style.display = 'block'; el.play().catch(() => { el.style.display = 'none'; }); };
  el.onerror   = () => { el.style.display = 'none'; };
}

function _updateSVGExpression(expression) {
  const cfg = {
    idle:    { mouth: 'M 43 63 Q 55 67 67 63', eyeRy: 5,   tailDur: '1.1s',  browY: 0,  tongue: false },
    happy:   { mouth: 'M 40 61 Q 55 74 70 61', eyeRy: 4,   tailDur: '0.35s', browY: -2, tongue: true  },
    sad:     { mouth: 'M 40 66 Q 55 58 70 66', eyeRy: 2.5, tailDur: '2.2s',  browY: 3,  tongue: false },
    excited: { mouth: 'M 39 60 Q 55 76 71 60', eyeRy: 5,   tailDur: '0.22s', browY: -3, tongue: true  }
  }[expression] || { mouth: 'M 43 63 Q 55 67 67 63', eyeRy: 5, tailDur: '1.1s', browY: 0, tongue: false };

  const $ = (id) => document.getElementById(id);
  $('svg-mouth')?.setAttribute('d', cfg.mouth);
  $('svg-eye-l')?.setAttribute('ry', cfg.eyeRy);
  $('svg-eye-r')?.setAttribute('ry', cfg.eyeRy);
  const tail = $('svg-tail')?.querySelector('animateTransform');
  if (tail) tail.setAttribute('dur', cfg.tailDur);
  $('svg-brow-l')?.setAttribute('transform', `translate(0,${cfg.browY})`);
  $('svg-brow-r')?.setAttribute('transform', `translate(0,${cfg.browY})`);
  const tongue = $('svg-tongue');
  if (tongue) tongue.style.display = cfg.tongue ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════════════════
function initAudio() {
  try { _audioEl = new Audio(); _audioEl.volume = _pwaSettings.audioVolume ?? 0.45; }
  catch (e) { _audioEl = null; }
}

function playAudio(expression) {
  if (!_audioEl || _pwaSettings.audioEnabled === false) return;
  const now = Date.now();
  if (now - _lastAudioTime < AUDIO_THROTTLE_MS) return;
  const src = MEDIA.audio[expression];
  if (!src) return;
  _lastAudioTime = now;
  try {
    _audioEl.pause(); _audioEl.src = src;
    _audioEl.volume = expression === 'excited' ? Math.min(1, (_pwaSettings.audioVolume ?? 0.45) * 1.3) : (_pwaSettings.audioVolume ?? 0.45);
    _audioEl.load(); _audioEl.play().catch(() => {});
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE → UI
// ═══════════════════════════════════════════════════════════════════════════
function onStateChange(state) { renderState(state); }

function renderState(state) {
  if (!state) return;
  const $ = (id) => document.getElementById(id);
  const nameEl = $('dog-name-display');
  if (nameEl) nameEl.textContent = state.name || 'Rex';
  const badges = { idle: '😐 Idle', happy: '😄 Happy', sad: '😢 Sad', excited: '🐾 Excited' };
  const badge  = $('mood-badge');
  if (badge) badge.textContent = badges[state.expression] || '😐 Idle';
  setBar('energy-bar', state.energy);
  setBar('bond-bar',   state.bond);
  const ev = $('energy-val'), bv = $('bond-val');
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
  const c = document.getElementById('chat-history');
  if (!c) return;
  c.innerHTML = '';
  if (!memories.length) showWelcome();
  else { memories.forEach(m => appendMessage(m.role, m.content, false)); scrollChat(); }
}

function showWelcome() {
  const c = document.getElementById('chat-history');
  if (!c) return;
  c.innerHTML = `
    <div id="chat-welcome" class="chat-welcome">
      <div class="welcome-paw">🐾</div>
      <div class="welcome-text">Your companion is waiting.<br/>Say hello, feed them, or just chat.</div>
      <div class="welcome-hint">Add an AI key in ⚙ Settings for full AI responses.</div>
    </div>`;
}
function removeWelcome() { document.getElementById('chat-welcome')?.remove(); }

function appendMessage(role, content, scroll = true) {
  removeWelcome();
  const c = document.getElementById('chat-history');
  if (!c) return;
  const row    = document.createElement('div');
  row.className = `chat-msg ${role === 'user' ? 'msg-user' : 'msg-dog'}`;
  const bubble  = document.createElement('div');
  bubble.className  = 'bubble';
  bubble.textContent = content;
  row.appendChild(bubble);
  c.appendChild(row);
  if (scroll) scrollChat();
}

function scrollChat() { const c = document.getElementById('chat-history'); if (c) c.scrollTop = c.scrollHeight; }

function showTyping() {
  const id = `typing-${Date.now()}`;
  const c  = document.getElementById('chat-history');
  if (!c) return id;
  const row = document.createElement('div');
  row.id = id; row.className = 'chat-msg msg-dog';
  row.innerHTML = '<div class="bubble typing-bubble"><span></span><span></span><span></span></div>';
  c.appendChild(row); scrollChat(); return id;
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
  _sendLock = true; input.value = ''; input.disabled = true;

  appendMessage('user', msg);
  try { await window.Storage.addMemory({ role: 'user', content: msg }); } catch (e) {}

  let state = null;
  try { state = await window.Engine.dispatch({ type: 'CHAT' }); } catch (e) {}
  state = state || window.Engine.getState() || { expression: 'idle', name: 'Rex' };
  playAudio(state.expression);

  let memories = [];
  try { memories = await window.Storage.loadMemory(); } catch (e) {}

  const typingId = showTyping();
  let response   = null;
  try { if (!window.AI.isBusy()) response = await window.AI.ask(msg, state, memories); } catch (e) {}
  removeTyping(typingId);

  const reply = response || window.AI.getFallback(state.expression);
  appendMessage('dog', reply);
  try { await window.Storage.addMemory({ role: 'dog', content: reply }); } catch (e) {}
  try { await window.Storage.enforceMemoryCap(); } catch (e) {}

  input.disabled = false; input.focus(); _sendLock = false;
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
  const $ = (id) => document.getElementById(id);

  $('send-btn')?.addEventListener('click', handleSend);
  $('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  $('dog-stage')?.addEventListener('click', async () => {
    let state = null;
    try { state = await window.Engine.dispatch({ type: 'PET' }); } catch (e) {}
    playAudio(state?.expression || 'idle');
    showToast(`${state?.name || 'Rex'} loves the attention! 🐾`);
    renderDog('excited');
    setTimeout(() => renderDog(state?.expression || 'idle'), 900);
  });

  $('btn-feed')?.addEventListener('click', () => handleAction('FEED', '🍖 *gobbles up the food and wags tail happily*', 'happy'));
  $('btn-play')?.addEventListener('click', () => handleAction('PLAY', '🎾 *zooms around excitedly and fetches the ball!*', 'excited'));
  $('btn-rest')?.addEventListener('click', () => handleAction('REST', '💤 *curls up in a cozy spot and sighs contentedly*', 'idle'));

  $('settings-btn')?.addEventListener('click', openSettings);
  $('close-settings')?.addEventListener('click', closeSettings);
  $('settings-overlay')?.addEventListener('click', e => { if (e.target === $('settings-overlay')) closeSettings(); });

  // Install button
  $('install-btn')?.addEventListener('click', triggerInstall);

  // Companion name
  $('save-name')?.addEventListener('click', async () => {
    const name = $('dog-name-input')?.value.trim();
    if (!name) return;
    try { await window.Engine.dispatch({ type: 'RENAME', name }); } catch (e) {}
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
      const provider = btn.dataset.saveKey;
      const key      = $(`key-${provider}`)?.value.trim();
      if (!key) { showToast('Enter a key first', true); return; }
      window.AI.setKey(provider, key);
      await window.AI.saveConfig();
      updateAIChip();
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
      await window.AI.saveConfig();
      const sel = $('model-ollama');
      if (result.models.length && sel) {
        sel.innerHTML = result.models.map(m => `<option value="${m}">${m}</option>`).join('');
      }
      if (statusEl) statusEl.innerHTML = `<span style="color:#4ade80">✓ ${result.models.length} model(s) available</span>`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:#f87171">✗ Not reachable — is Ollama running?</span>`;
    }
  });

  // Activate provider
  $('activate-provider')?.addEventListener('click', async () => {
    const activeTab = document.querySelector('.provider-tab.active');
    if (!activeTab) return;
    const provider = activeTab.dataset.provider;
    const model    = $(`model-${provider}`)?.value || null;
    window.AI.setProvider(provider, model);
    await window.AI.saveConfig();
    updateAIChip();
    showToast(`${provider} activated ✓`);
    closeSettings();
  });

  // PWA settings toggles
  $('toggle-audio')?.addEventListener('change', async (e) => {
    await savePWASettings({ audioEnabled: e.target.checked });
  });
  $('range-volume')?.addEventListener('input', async (e) => {
    await savePWASettings({ audioVolume: parseFloat(e.target.value) });
    if (_audioEl) _audioEl.volume = parseFloat(e.target.value);
  });
  $('toggle-animations')?.addEventListener('change', async (e) => {
    await savePWASettings({ animationsEnabled: e.target.checked });
  });
  $('toggle-notifications')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    if (on && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; showToast('Notification permission denied', true); return; }
    }
    await savePWASettings({ notificationsEnabled: on });
  });

  // Clear memory
  $('clear-memory-btn')?.addEventListener('click', async () => {
    if (!window.confirm('Clear all chat history?')) return;
    try { await window.Storage.clearMemory(); } catch (e) {}
    await loadAndRenderMemory();
    showToast('Chat history cleared');
  });

  // Export / Import
  $('export-btn')?.addEventListener('click', async () => {
    try {
      const key = await window.Storage.exportKey();
      if ($('export-output')) $('export-output').value = key;
      showToast('Migration key ready ✓');
    } catch (e) { showToast('Export failed', true); }
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
      if (!window.confirm(`⚠ Overwrite ${existing.name} (${existing.totalInteractions} interactions)?`)) return;
    }
    try {
      await window.Storage.importKey(keyStr);
      showToast('Imported! Reloading…');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { showToast('Import failed: ' + e.message, true); }
  });

  // Cache status in settings
  $('check-cache-btn')?.addEventListener('click', async () => {
    const status = await window.Storage.getCacheStatus();
    renderCacheStatus(status);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay?.classList.add('open');
  // Restore state into UI
  const s   = window.Engine.getState();
  const ni  = document.getElementById('dog-name-input');
  if (ni && s) ni.value = s.name || '';
  // Restore PWA toggles
  const ta = document.getElementById('toggle-audio');
  const tv = document.getElementById('range-volume');
  const tan = document.getElementById('toggle-animations');
  const tn = document.getElementById('toggle-notifications');
  if (ta)  ta.checked   = _pwaSettings.audioEnabled !== false;
  if (tv)  tv.value     = _pwaSettings.audioVolume ?? 0.45;
  if (tan) tan.checked  = _pwaSettings.animationsEnabled !== false;
  if (tn)  tn.checked   = !!_pwaSettings.notificationsEnabled;
  // Restore provider tab
  const prov = window.AI.getProvider?.() || 'openai';
  const tab  = document.querySelector(`[data-provider="${prov}"]`);
  if (tab) tab.click();
}

function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

function updateAIChip() {
  const dot    = document.getElementById('api-status-dot');
  const label  = document.getElementById('api-status-label');
  const prov   = window.AI.getProvider?.();
  const provs  = window.AI.getProviders?.() || {};
  const info   = provs[prov];
  // Consider Ollama always "connected" if selected (no key needed)
  const hasKey = prov === 'ollama' || !!(
    prov === 'openai'     ? window.AI._keys?.openai :
    prov === 'openrouter' ? window.AI._keys?.openrouter :
    prov === 'groq'       ? window.AI._keys?.groq : false
  );
  if (dot)   dot.className     = `status-dot ${hasKey ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = info ? `${info.label}` : 'No AI';
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE STATUS UI
// ═══════════════════════════════════════════════════════════════════════════
function renderCacheStatus(statusArr) {
  const container = document.getElementById('cache-status-list');
  if (!container) return;
  if (!statusArr?.length) { container.innerHTML = '<div class="asset-row" style="color:var(--text-muted)">SW not active yet — install the app first</div>'; return; }
  const ok      = statusArr.filter(s => s.cached).length;
  const total   = statusArr.length;
  container.innerHTML = `
    <div class="cache-summary">${ok}/${total} files cached offline</div>
    ${statusArr.map(s => `
      <div class="asset-row">
        <span class="asset-dot ${s.cached ? 'dot-ok' : 'dot-missing'}"></span>
        <span style="font-size:0.68rem">${s.url}</span>
      </div>`).join('')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST + SPLASH
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

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.style.opacity = '0';
  setTimeout(() => s.remove(), 580);
}

function showSplashError(msg) {
  const s = document.getElementById('splash');
  document.getElementById('splash-ring')?.remove();
  const err = document.createElement('div');
  err.className = 'splash-error'; err.textContent = msg;
  s?.appendChild(err);
}
