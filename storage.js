// IMMORTAIL™ Storage v3
// IndexedDB — fully defensive, never throws to caller on missing data
// Export/Import: base64-encoded migration key

const DB_NAME      = 'immortail_db';
const DB_VERSION   = 2;
const STORE_STATE  = 'dog_state';
const STORE_MEMORY = 'memory';
const MEMORY_CAP   = 200;

let _db = null;

// ── Open DB — with timeout guard ───────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }

    // Bail if IndexedDB not available (private mode on some browsers)
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported in this browser/mode'));
      return;
    }

    let settled = false;
    const done = (fn) => (...args) => { if (!settled) { settled = true; fn(...args); } };

    // 8 second timeout — prevents hanging forever if IDB is locked
    const timer = setTimeout(
      done(reject.bind(null, new Error('IndexedDB open timed out'))),
      8000
    );

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

    req.onsuccess = (e) => {
      clearTimeout(timer);
      _db = e.target.result;

      // Handle unexpected DB close (e.g. browser wipes storage)
      _db.onversionchange = () => { _db.close(); _db = null; };
      _db.onclose = () => { _db = null; };

      done(resolve)(_db);
    };

    req.onerror  = (e) => { clearTimeout(timer); done(reject)(e.target.error); };
    req.onblocked = () => { clearTimeout(timer); done(reject)(new Error('IndexedDB blocked — close other tabs and retry')); };
  });
}

// ── State ──────────────────────────────────────────────────────────────────
async function saveState(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put({ key: 'main', ...state });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
    tx.onabort    = (e) => reject(new Error('saveState transaction aborted'));
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
  if (!payload || !payload.v || !payload.state) {
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
