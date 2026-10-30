// IndexedDB key/value store. Everything the app knows lives here, on this phone.

const DB_NAME = 'multitool';
const STORE = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked. Close other tabs of The Sheet and try again.'));
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was cancelled.'));
  }));
}

export function getAll() {
  return tx('readonly', (store) => new Promise((resolve) => {
    const out = {};
    const req = store.openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
    req.onerror = () => resolve(out);
  }));
}

export const put = (key, value) => tx('readwrite', (store) => { store.put(value, key); });
export const del = (key) => tx('readwrite', (store) => { store.delete(key); });
export const clearAll = () => tx('readwrite', (store) => { store.clear(); });

/* Ask Chrome not to evict our data when the phone runs low on space. Installed apps usually get this. */
export async function persist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}
export async function persisted() {
  try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { return null; }
}
