// IMMORTAIL™ Storage v4
// IndexedDB — single source of truth for ALL persistent data
// Stores: dog_state · memory · config (AI keys, provider, settings)
// localStorage is NOT used — everything lives in IndexedDB

const DB_NAME    = 'immortail_db';
const DB_VERSION = 3;  // bumped to add config store

const STORE_STATE  = 'dog_state';
const STORE_MEMORY = 'memory';
const STORE_CONFIG = 'config';   // NEW — all app config

const MEMORY_CAP = 200;

let _db = null;

// ── Open DB ────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }

    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    let settled = false;
    const done = (fn) => (...args) => { if (!settled) { settled = true; fn(...args); } };
    const timer = setTimeout(
      done(reject.bind(null, new Error('IndexedDB open timed out'))),
      8000
    );

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db      = e.target.result;
      const oldVer  = e.oldVersion;

      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY)) {
        db.createObjectStore(STORE_MEMORY, { keyPath: 'id', autoIncrement: true });
      }
      // v3: config store
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
      }

      // Migrate: if upgrading from v1/v2, pull localStorage keys into IDB
      if (oldVer < 3 && typeof localStorage !== 'undefined') {
        try {
          const oldAI = localStorage.getItem('immortail_ai_config');
          if (oldAI) {
            const tx = e.target.transaction;
            if (tx) {
              const store = tx.objectStore(STORE_CONFIG);
              store.put({ key: 'ai_config', value: JSON.parse(oldAI) });
            }
          }
        } catch (_) {}
      }
    };

    req.onsuccess = (e) => {
      clearTimeout(timer);
      _db = e.target.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      _db.onclose = () => { _db = null; };
      done(resolve)(_db);
    };

    req.onerror   = (e) => { clearTimeout(timer); done(reject)(e.target.error); };
    req.onblocked = ()  => { clearTimeout(timer); done(reject)(new Error('IndexedDB blocked — close other tabs')); };
  });
}

// ── Generic config helpers ─────────────────────────────────────────────────
async function setConfig(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function getConfig(key, defaultValue = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_CONFIG, 'readonly');
    const req = tx.objectStore(STORE_CONFIG).get(key);
    req.onsuccess = (e) => resolve(e.target.result?.value ?? defaultValue);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getAllConfig() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).getAll();
    req.onsuccess = (e) => {
      const out = {};
      (e.target.result || []).forEach(r => { out[r.key] = r.value; });
      resolve(out);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteConfig(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ── AI config (provider, model, keys) ─────────────────────────────────────
async function saveAIConfig(cfg) {
  // Never store raw keys in plaintext beyond what user already has in IDB
  await setConfig('ai_config', cfg);
}

async function loadAIConfig() {
  return getConfig('ai_config', null);
}

// ── PWA settings ───────────────────────────────────────────────────────────
async function savePWASettings(settings) {
  await setConfig('pwa_settings', settings);
}

async function loadPWASettings() {
  return getConfig('pwa_settings', {
    audioEnabled:    true,
    audioVolume:     0.45,
    animationsEnabled: true,
    theme:           'dark',
    notificationsEnabled: false
  });
}

// ── Dog state ──────────────────────────────────────────────────────────────
async function saveState(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put({ key: 'main', ...state });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
    tx.onabort    = ()  => reject(new Error('saveState aborted'));
  });
}

async function loadState() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get('main');
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Memory ─────────────────────────────────────────────────────────────────
async function addMemory(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY, 'readwrite');
    tx.objectStore(STORE_MEMORY).add({ ...entry, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function loadMemory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_MEMORY, 'readonly')
                  .objectStore(STORE_MEMORY).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function enforceMemoryCap() {
  const all = await loadMemory();
  if (all.length <= MEMORY_CAP) return;
  const toDelete = all.slice(0, all.length - MEMORY_CAP);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_MEMORY);
    toDelete.forEach(e => store.delete(e.id));
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function clearMemory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY, 'readwrite');
    tx.objectStore(STORE_MEMORY).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ── Environment persistence ────────────────────────────────────────────────
async function saveEnv(envId) {
  await setConfig('selected_env', envId);
}

async function loadEnv() {
  return getConfig('selected_env', 'home');
}

// ── Export / Import — full backup including config ─────────────────────────
async function exportKey() {
  const [state, memory, config] = await Promise.all([
    loadState(), loadMemory(), getAllConfig()
  ]);
  const payload = {
    v: 3, ts: Date.now(),
    state:  state  || {},
    memory: memory || [],
    config: config || {}
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

async function importKey(keyStr) {
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(escape(atob(keyStr.trim()))));
  } catch {
    throw new Error('Invalid migration key — cannot decode.');
  }
  if (!payload?.v || !payload?.state) {
    throw new Error('Invalid migration key — missing required fields.');
  }

  await saveState(payload.state);
  await clearMemory();

  const db = await openDB();

  // Restore memory
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_MEMORY);
    (payload.memory || []).forEach(m => { const { id, ...e } = m; store.add(e); });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });

  // Restore config (v3 exports only)
  if (payload.config && typeof payload.config === 'object') {
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_CONFIG, 'readwrite');
      const store = tx.objectStore(STORE_CONFIG);
      store.clear();
      Object.entries(payload.config).forEach(([key, value]) => {
        store.put({ key, value });
      });
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
    });
  }
}

// ── Cache status (for Settings asset panel) ────────────────────────────────
function getCacheStatus() {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker?.controller) { resolve([]); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      if (e.data?.type === 'CACHE_STATUS') resolve(e.data.status);
    };
    navigator.serviceWorker.controller.postMessage(
      { type: 'GET_CACHE_STATUS' },
      [channel.port2]
    );
    setTimeout(() => resolve([]), 2000); // timeout fallback
  });
}

window.Storage = {
  init: openDB,
  // State
  saveState, loadState,
  // Memory
  addMemory, loadMemory, enforceMemoryCap, clearMemory,
  // Config — everything in IDB
  setConfig, getConfig, getAllConfig, deleteConfig,
  saveAIConfig, loadAIConfig,
  savePWASettings, loadPWASettings,
  saveEnv, loadEnv,
  // Export/Import
  exportKey, importKey,
  // PWA
  getCacheStatus
};
