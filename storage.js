// IMMORTAIL™ Storage v2
// IndexedDB — single source of truth
// Stores: dog state + chat memory
// Export/Import: base64-encoded migration key

const DB_NAME    = 'immortail_db';
const DB_VERSION = 2;
const STORE_STATE  = 'dog_state';
const STORE_MEMORY = 'memory';
const MEMORY_CAP   = 200;

let _db = null;

// ── Open DB ────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY)) {
        db.createObjectStore(STORE_MEMORY, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
    req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
  });
}

// ── State ──────────────────────────────────────────────────────────────────
async function saveState(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_STATE, 'readwrite');
    const store = tx.objectStore(STORE_STATE);
    store.put({ key: 'main', ...state });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
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

// ── Export / Import ────────────────────────────────────────────────────────
async function exportKey() {
  const [state, memory] = await Promise.all([loadState(), loadMemory()]);
  const payload = { v: 2, ts: Date.now(), state: state || {}, memory: memory || [] };
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
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_MEMORY, 'readwrite');
    const store = tx.objectStore(STORE_MEMORY);
    (payload.memory || []).forEach(m => {
      const { id, ...entry } = m;
      store.add(entry);
    });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

window.Storage = {
  init: openDB,
  saveState, loadState,
  addMemory, loadMemory, enforceMemoryCap, clearMemory,
  exportKey, importKey
};
