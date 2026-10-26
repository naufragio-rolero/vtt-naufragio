// Bounded per-peer state. Forwarded headers are intentionally never trusted.
export function createLimiter(limit, windowMs, { maxKeys = 4096, clock = Date.now } = {}) {
  const peers = new Map();
  return key => {
    const now = clock();
    let entry = peers.get(key);
    if (!entry || entry.until <= now) {
      for (const [peer, value] of peers) if (value.until <= now) peers.delete(peer);
      if (peers.size >= maxKeys && !peers.has(key)) return false;
      entry = { count: 0, until: now + windowMs };
      peers.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}
