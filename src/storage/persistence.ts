import { sanitizeWorkspace, scrubMap } from '../io/json';
import type { Workspace } from '../model/workspace';

const DB_NAME = 'smart-mindmap';
const STORE = 'kv';
const KEY = 'workspace';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  await run('readwrite', (s) => s.put({ ...ws, maps: ws.maps.map(scrubMap) }, KEY));
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const raw = await run<unknown>('readonly', (s) => s.get(KEY));
  return raw === undefined ? null : sanitizeWorkspace(raw);
}

export async function clearWorkspace(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY));
}
