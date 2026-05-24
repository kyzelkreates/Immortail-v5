// IMMORTAIL™ Engine v3
// Single queue-based controller. Defensive init. No race conditions.

const TICK_INTERVAL_MS = 60_000;
const ENERGY_DECAY     = 0.4;
const BOND_DECAY       = 0.08;

const DEFAULT_STATE = {
  key:               'main',
  name:              'Rex',
  expression:        'idle',
  energy:            75,
  bond:              30,
  lastInteraction:   null,
  totalInteractions: 0,
  lastSeen:          Date.now(),
  createdAt:         Date.now()
};

let _state         = null;
let _queue         = [];
let _processing    = false;
let _tickTimer     = null;
let _onStateChange = null;

// ── Helpers ────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function deriveExpression(s) {
  if (s.energy < 20)               return 'sad';
  if (s.lastInteraction === 'play') return 'excited';
  if (s.bond > 70)                  return 'happy';
  return 'idle';
}

// ── Passive tick ───────────────────────────────────────────────────────────
function tick() {
  if (!_state) return;
  _state.energy     = clamp(_state.energy - ENERGY_DECAY, 0, 100);
  _state.bond       = clamp(_state.bond   - BOND_DECAY,   0, 100);
  _state.expression = deriveExpression(_state);
  _state.lastSeen   = Date.now();
  try { window.Storage.saveState(_state); } catch(e) {}
  if (_onStateChange) _onStateChange({ ..._state });
}

// ── Queue dispatch — iterative, never recursive ────────────────────────────
function dispatch(action) {
  return new Promise((resolve) => {
    _queue.push({ action, resolve });
    if (!_processing) _pump();
  });
}

function _pump() {
  if (_processing || _queue.length === 0) return;
  _processing = true;
  const { action, resolve } = _queue.shift();

  _execute(action)
    .then(result => { resolve(result); })
    .catch(err   => { console.error('[Engine]', err); resolve(null); })
    .finally(()  => {
      _processing = false;
      // schedule next tick via setTimeout to keep the call stack flat
      if (_queue.length > 0) setTimeout(_pump, 0);
    });
}

// ── Action executor ────────────────────────────────────────────────────────
async function _execute(action) {
  if (!_state) return null;

  switch (action.type) {
    case 'CHAT':
      _state.bond              = clamp(_state.bond + 2, 0, 100);
      _state.energy            = clamp(_state.energy + 0.5, 0, 100);
      _state.totalInteractions += 1;
      _state.lastInteraction   = 'chat';
      _state.lastSeen          = Date.now();
      _state.expression        = deriveExpression(_state);
      break;

    case 'FEED':
      _state.energy          = clamp(_state.energy + 22, 0, 100);
      _state.bond            = clamp(_state.bond + 5, 0, 100);
      _state.lastInteraction = 'feed';
      _state.expression      = deriveExpression(_state);
      break;

    case 'PLAY':
      _state.energy          = clamp(_state.energy - 10, 0, 100);
      _state.bond            = clamp(_state.bond + 12, 0, 100);
      _state.lastInteraction = 'play';
      _state.expression      = 'excited';
      break;

    case 'REST':
      _state.energy          = clamp(_state.energy + 30, 0, 100);
      _state.lastInteraction = 'rest';
      _state.expression      = deriveExpression(_state);
      break;

    case 'PET':
      _state.bond            = clamp(_state.bond + 8, 0, 100);
      _state.lastInteraction = 'pet';
      _state.expression      = _state.bond > 50 ? 'happy' : 'idle';
      break;

    case 'RENAME':
      if (action.name && action.name.trim()) {
        _state.name = action.name.trim().slice(0, 24);
      }
      break;

    case 'GET_STATE':
      return { ..._state };

    default:
      console.warn('[Engine] Unknown action:', action.type);
      return null;
  }

  _state.lastSeen = _state.lastSeen || Date.now();
  await window.Storage.saveState(_state);
  if (_onStateChange) _onStateChange({ ..._state });
  return { ..._state };
}

// ── Offline decay ──────────────────────────────────────────────────────────
function applyOfflineDecay(state) {
  const awayMs   = Date.now() - (state.lastSeen || Date.now());
  const awayMins = Math.floor(awayMs / 60_000);
  if (awayMins < 1) return state;
  const ticks = Math.min(awayMins, 1440); // cap at 24h worth
  state.energy    = clamp(state.energy - ENERGY_DECAY * ticks, 0, 100);
  state.bond      = clamp(state.bond   - BOND_DECAY   * ticks, 0, 100);
  state.expression = deriveExpression(state);
  return state;
}

// ── Init — fully defensive ─────────────────────────────────────────────────
async function init(onStateChange) {
  _onStateChange = onStateChange || null;

  // Guard: Storage must exist
  if (!window.Storage || typeof window.Storage.loadState !== 'function') {
    throw new Error('Storage not ready');
  }

  let saved = null;
  try {
    saved = await window.Storage.loadState();
  } catch (e) {
    console.warn('[Engine] Could not load saved state, using defaults:', e);
  }

  if (saved && typeof saved === 'object') {
    _state = applyOfflineDecay({ ...DEFAULT_STATE, ...saved });
  } else {
    _state = { ...DEFAULT_STATE, lastSeen: Date.now(), createdAt: Date.now() };
  }

  try {
    await window.Storage.saveState(_state);
  } catch (e) {
    console.warn('[Engine] Could not persist initial state:', e);
  }

  if (_tickTimer) clearInterval(_tickTimer);
  _tickTimer = setInterval(tick, TICK_INTERVAL_MS);

  return { ..._state };
}

function getState() { return _state ? { ..._state } : null; }
function stop()     { if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; } }

window.Engine = { init, dispatch, getState, stop };
