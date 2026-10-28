// Private, per-origin/per-account/per-room director image originals.
// Never included in the public build and never exported into site.config.json.
export function createRoomMediaStore(identity) {
  if (typeof identity !== 'string' || identity.length > 600 || !identity) throw new Error('INVALID_ROOM_MEDIA_ID');
  const key = 'room:' + identity;
  async function transact(mode, action) {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('naufragio-vtt-room-media-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('rooms');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('rooms', mode, { durability: 'strict' });
        const request = action(tx.objectStore('rooms'));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error || new Error('MEDIA_STORE_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('MEDIA_STORE_ABORTED'));
      });
    } finally { db.close(); }
  }
  return {
    load() { return transact('readonly', store => store.get(key)); },
    save(data) { return transact('readwrite', store => store.put(structuredClone(data), key)); }
  };
}
