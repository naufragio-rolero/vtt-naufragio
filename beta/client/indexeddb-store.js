// A private browser store for the signing key and atomic current/staged journal.
// No session tokens, passwords or server credentials belong in this database.
export function createIndexedDbStore(roomId, { databaseName = 'naufragio-vtt-authority-v1' } = {}) {
  let connection;
  let unlock;
  async function acquire() {
    if (unlock) throw new Error('LOCAL_STATE_IN_USE');
    if (!globalThis.navigator?.locks) throw new Error('LOCAL_LOCK_UNAVAILABLE');
    await new Promise((resolve, reject) => {
      navigator.locks.request(`naufragio-vtt:${databaseName}:${roomId}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('LOCAL_STATE_IN_USE')); return; }
        await new Promise(release => { unlock = release; resolve(); });
      }).catch(() => reject(new Error('LOCAL_LOCK_UNAVAILABLE')));
    });
  }
  function release() { unlock?.(); unlock = null; }
  async function open() {
    if (connection) return connection;
    connection = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('authority');
      request.onerror = () => reject(new Error('LOCAL_STORAGE_UNAVAILABLE'));
      request.onblocked = () => reject(new Error('LOCAL_STORAGE_BLOCKED'));
      request.onsuccess = () => resolve(request.result);
    });
    connection.onversionchange = () => { connection.close(); connection = null; };
    return connection;
  }
  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('authority', mode, { durability: 'strict' });
      let result;
      const request = work(tx.objectStore('authority'));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result ?? null);
      tx.onerror = tx.onabort = () => reject(new Error('LOCAL_STORAGE_FAILED'));
    });
  }
  return {
    acquire,
    release,
    load: () => transaction('readonly', store => store.get(roomId)),
    save: record => transaction('readwrite', store => store.put(record, roomId)),
    close() { release(); connection?.close(); connection = null; }
  };
}
