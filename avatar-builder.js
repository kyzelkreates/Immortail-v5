// IMMORTAIL™ AvatarBuilder v2
// IDB blob store for all user-uploaded dog assets + AI virtual copy metadata
// Stores: images, videos, audio per expression slot + generated virtual copies

const AB_DB_NAME    = 'immortail_avatars';
const AB_DB_VERSION = 2; // bumped: adds virtual_copies store
const STORE_ASSETS  = 'assets';
const STORE_VIRTUAL = 'virtual_copies'; // AI-generated versions

const SLOTS = {
  'body:idle':     { type:'image', layer:'body',  expression:'idle',    label:'Body — Idle',     icon:'🐶' },
  'body:happy':    { type:'image', layer:'body',  expression:'happy',   label:'Body — Happy',    icon:'🐶' },
  'body:sad':      { type:'image', layer:'body',  expression:'sad',     label:'Body — Sad',      icon:'🐶' },
  'body:excited':  { type:'image', layer:'body',  expression:'excited', label:'Body — Excited',  icon:'🐶' },
  'face:idle':     { type:'image', layer:'face',  expression:'idle',    label:'Face — Idle',     icon:'👁' },
  'face:happy':    { type:'image', layer:'face',  expression:'happy',   label:'Face — Happy',    icon:'👁' },
  'face:sad':      { type:'image', layer:'face',  expression:'sad',     label:'Face — Sad',      icon:'👁' },
  'face:excited':  { type:'image', layer:'face',  expression:'excited', label:'Face — Excited',  icon:'👁' },
  'video:idle':    { type:'video', layer:'video', expression:'idle',    label:'Animation — Idle',    icon:'🎬' },
  'video:happy':   { type:'video', layer:'video', expression:'happy',   label:'Animation — Happy',   icon:'🎬' },
  'video:sad':     { type:'video', layer:'video', expression:'sad',     label:'Animation — Sad',     icon:'🎬' },
  'video:excited': { type:'video', layer:'video', expression:'excited', label:'Animation — Excited', icon:'🎬' },
  'audio:idle':    { type:'audio', layer:'audio', expression:'idle',    label:'Sound — Idle',    icon:'🔊' },
  'audio:happy':   { type:'audio', layer:'audio', expression:'happy',   label:'Sound — Happy',   icon:'🔊' },
  'audio:sad':     { type:'audio', layer:'audio', expression:'sad',     label:'Sound — Sad',     icon:'🔊' },
  'audio:excited': { type:'audio', layer:'audio', expression:'excited', label:'Sound — Excited', icon:'🔊' },
};

let _db          = null;
let _worker      = null;
let _workerReady = false;
let _pending     = new Map();
let _nextId      = 1;
const _urlCache  = new Map();

// ── DB ─────────────────────────────────────────────────────────────────────
function _openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(AB_DB_NAME, AB_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS))
        db.createObjectStore(STORE_ASSETS, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(STORE_VIRTUAL))
        db.createObjectStore(STORE_VIRTUAL, { keyPath: 'id' });
    };
    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

async function _saveAsset(slot, data) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put({ slot, ...data, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function _getAsset(slot) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS).get(slot);
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function _listAssets() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function _deleteAsset(slot) {
  if (_urlCache.has(slot)) { URL.revokeObjectURL(_urlCache.get(slot)); _urlCache.delete(slot); }
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── Virtual copies store ───────────────────────────────────────────────────
async function saveVirtualCopy(data) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIRTUAL, 'readwrite');
    tx.objectStore(STORE_VIRTUAL).put({ ...data, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function listVirtualCopies() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_VIRTUAL, 'readonly').objectStore(STORE_VIRTUAL).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function deleteVirtualCopy(id) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIRTUAL, 'readwrite');
    tx.objectStore(STORE_VIRTUAL).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── Worker bridge ──────────────────────────────────────────────────────────
function _initWorker() {
  if (_worker) return;
  try {
    _worker = new Worker('worker.js');
    _worker.onmessage = e => {
      const { id, ok, result, error } = e.data;
      const p = _pending.get(id); if (!p) return;
      _pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    _worker.onerror = () => { _workerReady = false; };
    _workerSend('PING', {}).then(() => { _workerReady = true; }).catch(() => {});
  } catch (e) { console.warn('[AB] Worker:', e.message); }
}

function _workerSend(type, payload) {
  return new Promise((resolve, reject) => {
    if (!_worker) { reject(new Error('No worker')); return; }
    const id = String(_nextId++);
    _pending.set(id, { resolve, reject });
    _worker.postMessage({ id, type, payload });
    setTimeout(() => { if (_pending.has(id)) { _pending.delete(id); reject(new Error('Timeout')); } }, 30000);
  });
}

// ── URL cache ──────────────────────────────────────────────────────────────
function _blobToURL(blob, slot) {
  if (_urlCache.has(slot)) URL.revokeObjectURL(_urlCache.get(slot));
  const url = URL.createObjectURL(blob);
  _urlCache.set(slot, url);
  return url;
}

// ── Storage usage ──────────────────────────────────────────────────────────
async function getStorageStats() {
  const assets  = await _listAssets();
  const virtual = await listVirtualCopies();
  let totalBytes = 0;
  assets.forEach(a => { if (a.blob) totalBytes += a.blob.size || 0; });
  const quota = await navigator.storage?.estimate?.() || { usage: 0, quota: 0 };
  return {
    assetCount:   assets.length,
    virtualCount: virtual.length,
    assetBytes:   totalBytes,
    usageBytes:   quota.usage  || 0,
    quotaBytes:   quota.quota  || 0,
    percent:      quota.quota  ? Math.round((quota.usage / quota.quota) * 100) : 0
  };
}

// ── Core: add media ────────────────────────────────────────────────────────
async function addMedia(file, slot) {
  if (!SLOTS[slot]) throw new Error('Unknown slot: ' + slot);
  const buffer            = await file.arrayBuffer();
  const [layer, expression] = slot.split(':');
  let blob;

  if ((layer === 'body' || layer === 'face') && _workerReady) {
    try {
      const r = await _workerSend('PROCESS_IMAGE', { buffer, targetSize: 512, expression, slot: layer });
      blob = new Blob([r.buffer], { type: 'image/webp' });
    } catch (_) { blob = new Blob([buffer], { type: file.type }); }
  } else {
    blob = new Blob([buffer], { type: file.type });
  }

  await _saveAsset(slot, { blob, mimeType: blob.type, originalName: file.name, expression, layer, size: blob.size });
  _blobToURL(blob, slot);
  window.dispatchEvent(new CustomEvent('immortail:asset-updated', { detail: { slot } }));
  return { slot, ok: true, size: blob.size };
}

async function getAssetURL(slot) {
  if (_urlCache.has(slot)) return _urlCache.get(slot);
  const a = await _getAsset(slot);
  if (!a?.blob) return null;
  return _blobToURL(a.blob, slot);
}

async function getSlotStatus() {
  const assets = await _listAssets();
  const filled = new Set(assets.map(a => a.slot));
  return Object.entries(SLOTS).map(([slot, def]) => ({
    slot, ...def,
    filled:  filled.has(slot),
    asset:   assets.find(a => a.slot === slot) || null
  }));
}

function cleanup() {
  _urlCache.forEach(u => URL.revokeObjectURL(u)); _urlCache.clear();
  if (_worker) { _worker.terminate(); _worker = null; }
}

async function init() {
  await _openDB();
  _initWorker();
  const assets = await _listAssets();
  for (const a of assets) { if (a.blob) _blobToURL(a.blob, a.slot); }
  return { slots: SLOTS, workerReady: _workerReady };
}

window.addEventListener('unload', cleanup);

window.AvatarBuilder = {
  init, addMedia,
  getAsset: _getAsset, getAssetURL, listAssets: _listAssets,
  deleteAsset: _deleteAsset, getSlotStatus, getStorageStats,
  saveVirtualCopy, listVirtualCopies, deleteVirtualCopy,
  SLOTS, cleanup,
  get workerReady() { return _workerReady; }
};
