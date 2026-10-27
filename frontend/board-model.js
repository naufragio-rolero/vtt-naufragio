import { uuid, MAX_TOKENS } from '../backend/shared/token-state.js';

export const COLORS = ['#85dcd2', '#e7c47e', '#dd8e88', '#a6a1e9', '#a8c984', '#90b7e7'];
// A copy for a new room. Legacy IDs/content are never overwritten or truncated.
export function initialRoomTokens(tokens, generateId = () => crypto.randomUUID()) {
  if (!Array.isArray(tokens) || tokens.length > MAX_TOKENS) throw new Error('TOKEN_LIMIT');
  const used = new Set();
  return tokens.map(token => {
    let id = uuid(token.id) && !used.has(token.id) ? token.id : generateId();
    if (!uuid(id) || used.has(id)) throw new Error('INVALID_TOKEN_ID');
    used.add(id);
    if (![token.x, token.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1000000)) throw new Error('INVALID_POSITION');
    return { id, tokenVersion: 0, x: token.x, y: token.y };
  });
}
export function publicTokens(snapshot) {
  return [...snapshot.tokens].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((token, index) => ({
    ...token, code: `T${index + 1}`, name: `Token ${index + 1}`, color: COLORS[index % COLORS.length]
  }));
}
export function socketDestination(config) {
  const url = new URL(config.realtimeBaseUrl);
  const path = url.pathname.replace(/\/$/, '') + config.socketPath;
  url.pathname = '/';
  return { origin: url.origin.replace(/^ws/, 'http'), path };
}
