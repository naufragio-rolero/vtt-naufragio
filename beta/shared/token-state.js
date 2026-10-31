// Browser/Node shared wire format. Only the public token movement set belongs here.
export const PROTOCOL = 1;
export const MAX_TOKENS = 64;
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const counter = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('INVALID_MESSAGE');
}
export function position(value) {
  exact(value, ['x', 'y']);
  if (![value.x, value.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000)) throw new Error('INVALID_MESSAGE');
  return { x: value.x === 0 ? 0 : value.x, y: value.y === 0 ? 0 : value.y };
}
export function snapshot(value) {
  exact(value, ['stateId', 'revision', 'tokens']);
  if (!uuid(value.stateId) || !counter(value.revision) || !Array.isArray(value.tokens) || value.tokens.length > MAX_TOKENS) throw new Error('INVALID_MESSAGE');
  const seen = new Set();
  const tokens = value.tokens.map(token => {
    exact(token, ['id', 'tokenVersion', 'x', 'y']);
    if (!uuid(token.id) || !counter(token.tokenVersion) || seen.has(token.id)) throw new Error('INVALID_MESSAGE');
    seen.add(token.id);
    const point = position({ x: token.x, y: token.y });
    return { id: token.id, tokenVersion: token.tokenVersion, ...point };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { stateId: value.stateId, revision: value.revision, tokens };
}
export const tokenText = token => JSON.stringify([token.id, token.tokenVersion, token.x, token.y]);
export const checkpointText = (stateId, revision, entries) => JSON.stringify([stateId, revision,
  [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entry => [entry.id, entry.tokenVersion, entry.digest])]);
export const claimText = (roomId, challenge, stateId, revision, digest) =>
  JSON.stringify(['naufragio-vtt-authority-v1', roomId, challenge, stateId, revision, digest]);
