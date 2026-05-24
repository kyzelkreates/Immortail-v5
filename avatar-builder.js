// IMMORTAIL™ Avatar Builder v1
// Manages user-provided media — stores blobs in IndexedDB, processes via worker
// Slots: body:idle/happy/sad/excited, face:..., video:..., audio:...

const AB_DB_NAME    = 'immortail_avatars';
const AB_DB_VERSION = 1;
const STORE_ASSETS  = 'assets';

const SLOTS = {
  'body:idle':    { type:'image', layer:'body',  expression:'idle',    label:'Body (Idle)'     },
  'body:happy':   { type:'image', layer:'body',  expression:'happy',   label:'Body (Happy)'    },
  'body:sad':     { type:'image', layer:'body',  expression:'sad',     label:'Body (Sad)'      },
  'body:excited': { type:'image', layer:'body',  expression:'excited', label:'Body (Excited)'  },
  'face:idle':    { type:'image', layer:'face',  expression:'idle',    label:'Face (Idle)'     },
  'face:happy':   { type:'image', layer:'face',  expression:'happy',   label:'Face (Happy)'    },
  'face:sad':     { type:'image', layer:'face',  expression:'sad',     label:'Face (Sad)'      },
  'face:excited': { type:'image', layer:'face',  expression:'excited', label:'Face (Excited)'  },
  'video:idle':   { type:'video', layer:'video', expression:'idle',    label:'Animation (Idle)' },
  'video:happy':  { type:'video', layer:'video', expression:'happy',   label:'Animation (Happy)' },
  'video:sad':    { type:'video', layer:'video', expression:'sad',     label:'Animation (Sad)'  },
  'video:excited':{ type:'video', layer:'video', expression:'excited', label:'Animation (Excited)' },
  'audio:idle':   { type:'audio', layer:'audio', expression:'idle',    label:'Sound (Idle)'    },
  'audio:happy':  { type:'audio', layer:'audio', expression:'happy',   label:'Sound (Happy)'   },
  'audio:sad':    { type:'audio', layer:'audio', expression:'sad',     label:'Sound (Sad)'     },
  'audio:excited':{ type:'audio', layer:'audio', expression:'excited', label:'Sound (Excited)' },
};

let _db     = null;
let _worker = null;
let _workerReady = false;
let _pending = new Map();
let _nextId  = 1;
const _urlCache = new Map();

// ── DB ─────────────────────────────────────────────────────────────────────
function _openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(AB_DB_NAME, AB_DB_VERSION);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(STORE_ASSETS))
        e.target.result.createObjectStore(STORE_ASSETS, { keyPath:'slot' });
    };
    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

async function _saveAsset(slot, data) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS,'readwrite');
    tx.objectStore(STORE_ASSETS).put({ slot, ...data, updatedAt: Date.now() });
    tx.oncomplete = ()=>resolve(); tx.onerror = e=>reject(e.target.error);
  });
}

async function _getAsset(slot) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS,'readonly').objectStore(STORE_ASSETS).get(slot);
    req.onsuccess = e=>resolve(e.target.result||null); req.onerror = e=>reject(e.target.error);
  });
}

async function _listAssets() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS,'readonly').objectStore(STORE_ASSETS).getAll();
    req.onsuccess = e=>resolve(e.target.result||[]); req.onerror = e=>reject(e.target.error);
  });
}

async function _deleteAsset(slot) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS,'readwrite');
    tx.objectStore(STORE_ASSETS).delete(slot);
    tx.oncomplete = ()=>resolve(); tx.onerror = e=>reject(e.target.error);
  });
}

// ── Worker ─────────────────────────────────────────────────────────────────
function _initWorker() {
  if (_worker) return;
  try {
    _worker = new Worker('worker.js');
    _worker.onmessage = e => {
      const { id, ok, result, error } = e.data;
      if (id === 'ready') { _workerReady = true; return; }
      const p = _pending.get(id);
      if (!p) return;
      _pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    _worker.onerror = () => { _workerReady = false; };
    _workerSend('PING',{}).then(()=>{ _workerReady=true; }).catch(()=>{});
  } catch (e) { console.warn('[AvatarBuilder] Worker unavailable:', e.message); }
}

function _workerSend(type, payload) {
  return new Promise((resolve, reject) => {
    if (!_worker) { reject(new Error('Worker not available')); return; }
    const id = String(_nextId++);
    _pending.set(id, { resolve, reject });
    _worker.postMessage({ id, type, payload });
    setTimeout(() => {
      if (_pending.has(id)) { _pending.delete(id); reject(new Error('Worker timeout')); }
    }, 30000);
  });
}

// ── URL cache ──────────────────────────────────────────────────────────────
function _blobToURL(blob, slot) {
  if (_urlCache.has(slot)) URL.revokeObjectURL(_urlCache.get(slot));
  const url = URL.createObjectURL(blob);
  _urlCache.set(slot, url);
  return url;
}

// ── Public API ─────────────────────────────────────────────────────────────
async function addMedia(file, slot) {
  if (!SLOTS[slot]) throw new Error('Unknown slot: ' + slot);
  const buffer   = await file.arrayBuffer();
  const mimeType = file.type;
  const [layer, expression] = slot.split(':');

  let blob;
  if ((layer==='body'||layer==='face') && _workerReady) {
    try {
      const processed = await _workerSend('PROCESS_IMAGE', { buffer, targetSize:512, expression, slot:layer });
      blob = new Blob([processed.buffer], { type:'image/webp' });
    } catch (_) {
      blob = new Blob([buffer], { type: mimeType });
    }
  } else {
    blob = new Blob([buffer], { type: mimeType });
  }

  await _saveAsset(slot, { blob, mimeType: blob.type, originalName: file.name, expression, layer });
  _blobToURL(blob, slot); // pre-cache URL
  window.dispatchEvent(new CustomEvent('immortail:asset-updated', { detail:{ slot } }));
  return { slot, ok: true };
}

async function getAssetURL(slot) {
  if (_urlCache.has(slot)) return _urlCache.get(slot);
  const asset = await _getAsset(slot);
  if (!asset?.blob) return null;
  return _blobToURL(asset.blob, slot);
}

async function getSlotStatus() {
  const assets = await _listAssets();
  const filled = new Set(assets.map(a=>a.slot));
  return Object.entries(SLOTS).map(([slot, def]) => ({
    slot, ...def, filled: filled.has(slot), asset: assets.find(a=>a.slot===slot)||null
  }));
}

function cleanup() {
  _urlCache.forEach(u=>URL.revokeObjectURL(u)); _urlCache.clear();
  if (_worker) { _worker.terminate(); _worker=null; }
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
  init,
  addMedia,
  getAsset:     _getAsset,
  getAssetURL,
  listAssets:   _listAssets,
  deleteAsset:  _deleteAsset,
  getSlotStatus,
  SLOTS,
  cleanup,
  get workerReady() { return _workerReady; }
};
