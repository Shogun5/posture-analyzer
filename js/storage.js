// storage.js — IndexedDB：儲存每次（每天）的拍攝紀錄與 0° 基準；資料只存在本機瀏覽器
const DB = 'posture-analyzer', VER = 1;

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('subject', 'subject');
      }
      if (!db.objectStoreNames.contains('baselines')) db.createObjectStore('baselines', { keyPath: 'subject' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const saveSession = s => tx('sessions', 'readwrite', st => st.put(s));
export const getSession = id => tx('sessions', 'readonly', st => st.get(id));
export const deleteSession = id => tx('sessions', 'readwrite', st => st.delete(id));
/** 列出（不含大型欄位的）摘要，依日期排序 */
export async function listSessions() {
  const all = await tx('sessions', 'readonly', st => st.getAll());
  return (all || []).sort((a, b) => a.date.localeCompare(b.date));
}
export const saveBaseline = b => tx('baselines', 'readwrite', st => st.put(b));
export const getBaseline = subject => tx('baselines', 'readonly', st => st.get(subject));
export const deleteBaseline = subject => tx('baselines', 'readwrite', st => st.delete(subject));

/** 要求持久儲存，避免瀏覽器清除（iOS 7 天未使用可能被清） */
export async function requestPersist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }
