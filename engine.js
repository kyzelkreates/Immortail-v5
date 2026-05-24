// IMMORTAIL™ Engine v2
// Single queue-based controller. All state flows through dispatch().
// No parallel execution. No race conditions.

// ── Constants ──────────────────────────────────────────────────────────────
const TICK_INTERVAL_MS  = 60_000; // passive decay every 60 seconds
const ENERGY_DECAY      = 0.4;
const BOND_DECAY        = 0.08;
const MEMORY_CAP        = 200;

// ── Default state ──────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  key:               'main',
  name:              'Rex',
  expression:        'idle',   // idle | happy | sad | excited
  energy:            75,
  bond:              30,
  lastInteraction:   null,     // 'chat' | 'play' | 'feed' | 'rest'
  totalInteractions: 0,
  lastSeen:          Date.now(),
  createdAt:         Date.now()
};

let _state          = null;
let _queue          = [];
let _processing     = false;
let _tickTimer      = null;
let _onStateChange  = null;

// ── Helpers ────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function deriveExpression(state) {
  if (state.energy < 20)                         return 'sad';
  if (state.lastInteraction === 'play')          return 'excited';
  if (state.bond > 70)                           return 'happy';
  return 'idle';
}

// ── Tick: passive decay ────────────────────────────────────────────────────
function tick() {
  if (!_state) return;
  _state.energy   = clamp(_state.energy - ENERGY_DECAY, 0, 100);
  _state.bond     = clamp(_state.bond   - BOND_DECAY,   0, 100);
  _state.expression = deriveExpression(_state);
  _state.lastSeen   = Date.now();
  window.Storage.saveState(_state);
  _onStateChange?.({ ..._state });
}

// ── Queue-based dispatch ───────────────────────────────────────────────────
function dispatch(action) {
  return new Promise((resolve) => {
    _queue.push({ action, resolve });
    _drain();
  });
}

async function _drain() {
  if (_processing || _queue.length === 0) return;
  _processing = true;
  const { action, resolve } = _queue.shift();
  try {
    const result = await _execute(action);
    resolve(result);
  } catch (err) {
    console.error('[Engine] Action error:', err);
    resolve(null);
  }
  _processing = false;
  _drain();
}

// ── Action executor ────────────────────────────────────────────────────────
async function _execute(action) {
  switch (action.type) {

    case 'CHAT': {
      _state.bond              = clamp(_state.bond + 2, 0, 100);
      _state.energy            = clamp(_state.energy + 0.5, 0, 100);
      _state.totalInteractions += 1;
      _state.lastInteraction   = 'chat';
      _state.lastSeen          = Date.now();
      _state.expression        = deriveExpression(_state);
      break;
    }

    case 'FEED': {
      _state.energy          = clamp(_state.energy + 22, 0, 100);
      _state.bond            = clamp(_state.bond + 5, 0, 100);
      _state.lastInteraction = 'feed';
      _state.expression      = deriveExpression(_state);
      break;
    }

    case 'PLAY': {
      _state.energy          = clamp(_state.energy - 10, 0, 100);
      _state.bond            = clamp(_state.bond + 12, 0, 100);
      _state.lastInteraction = 'play';
      _state.expression      = 'excited'; // direct override for play
      break;
    }

    case 'REST': {
      _state.energy          = clamp(_state.energy + 30, 0, 100);
      _state.lastInteraction = 'rest';
      _state.expression      = deriveExpression(_state);
      break;
    }

    case 'PET': {
      _state.bond            = clamp(_state.bond + 8, 0, 100);
      _state.lastInteraction = 'pet';
      _state.expression      = _state.bond > 50 ? 'happy' : 'idle';
      break;
    }

    case 'RENAME': {
      if (action.name?.trim()) {
        _state.name = action.name.trim().slice(0, 24);
      }
      break;
    }

    case 'GET_STATE':
      return { ..._state };

    default:
      console.warn('[Engine] Unknown action:', action.type);
      return null;
  }

  await window.Storage.saveState(_state);
  _onStateChange?.({ ..._state });
  return { ..._state };
}

// ── Apply offline decay on boot ────────────────────────────────────────────
function applyOfflineDecay(state) {
  const awayMs   = Date.now() - (state.lastSeen || Date.now());
  const awayMins = Math.floor(awayMs / 60_000);
  if (awayMins < 1) return state;
  state.energy    = clamp(state.energy - ENERGY_DECAY * awayMins, 0, 100);
  state.bond      = clamp(state.bond   - BOND_DECAY   * awayMins, 0, 100);
  state.expression = deriveExpression(state);
  return state;
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init(onStateChange) {
  _onStateChange = onStateChange;

  const saved = await window.Storage.loadState();
  if (saved) {
    _state = applyOfflineDecay({ ...DEFAULT_STATE, ...saved });
  } else {
    _state = { ...DEFAULT_STATE };
  }

  await window.Storage.saveState(_state);
  _tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  return { ..._state };
}

function getState()  { return _state ? { ..._state } : null; }
function stop()      { if (_tickTimer) clearInterval(_tickTimer); }

window.Engine = { init, dispatch, getState, stop };
