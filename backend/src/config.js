import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadConfig(env = process.env) {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  const host = env.HOST ?? '127.0.0.1';
  if (!isIP(host) && host !== 'localhost') throw new Error('Invalid HOST');
  const integer = (name, fallback, min, max) => {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
      throw new Error(`Invalid ${name}`);
    }
    return Number(value);
  };
  const origins = env.ALLOWED_ORIGINS ?? (mode === 'production' ? '' : 'http://localhost:8080,http://127.0.0.1:8080');
  const allowedOrigins = origins.split(',').map(value => value.trim());
  for (const origin of allowedOrigins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('Invalid ALLOWED_ORIGINS'); }
    if (url.origin !== origin || url.username || url.password ||
        !(url.protocol === 'https:' || (mode !== 'production' && url.protocol === 'http:' && localHosts.has(url.hostname)))) {
      throw new Error('Invalid ALLOWED_ORIGINS');
    }
  }
  const socketPath = env.SOCKET_PATH ?? '/socket.io';
  if (socketPath.length > 200 || !/^\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(socketPath) ||
      socketPath.split('/').some(segment => segment === '.' || segment === '..') ||
      /^\/(health|settings|auth|rooms|room-invitations|invitations|users|roles|resources)(\/|$)/.test(socketPath)) throw new Error('Invalid SOCKET_PATH');
  const diagnostics = env.ENABLE_DIAGNOSTICS ?? 'false';
  if (!['true', 'false'].includes(diagnostics) || (mode === 'production' && diagnostics === 'true')) {
    throw new Error('Invalid ENABLE_DIAGNOSTICS');
  }
  const databasePath = env.DATABASE_PATH ?? (mode === 'test' ? ':memory:' : fileURLToPath(new URL('../data/naufragio.sqlite', import.meta.url)));
  if (typeof databasePath !== 'string' || !databasePath.trim() || /[\u0000\r\n]/.test(databasePath) ||
      (mode === 'production' && databasePath === ':memory:')) throw new Error('Invalid DATABASE_PATH');
  return Object.freeze({
    mode, host, port: integer('PORT', 3400, 1, 65535),
    allowedOrigins: Object.freeze([...new Set(allowedOrigins)]), socketPath,
    maxBodyBytes: integer('MAX_BODY_BYTES', 16384, 256, 1048576),
    maxMessageBytes: integer('MAX_MESSAGE_BYTES', 16384, 256, 1048576),
    rateWindowMs: integer('RATE_WINDOW_MS', 60000, 100, 3600000),
    httpRateLimit: integer('HTTP_RATE_LIMIT', 120, 1, 10000),
    handshakeRateLimit: integer('HANDSHAKE_RATE_LIMIT', 20, 1, 1000),
    eventRateLimit: integer('EVENT_RATE_LIMIT', 120, 1, 1000),
    connectionLimit: integer('CONNECTION_LIMIT', 32, 1, 1000),
    databasePath,
    authRateLimit: integer('AUTH_RATE_LIMIT', 10, 1, 100),
    authWindowMs: integer('AUTH_WINDOW_MS', 300000, 100, 3600000),
    sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 1800, 60, 3600),
    invitationTtlSeconds: integer('INVITATION_TTL_SECONDS', 86400, 60, 604800),
    roomCodeTtlSeconds: integer('ROOM_CODE_TTL_SECONDS', 86400, 60, 604800),
    roomInvitationTtlSeconds: integer('ROOM_INVITATION_TTL_SECONDS', 86400, 60, 604800),
    roomJoinRateLimit: integer('ROOM_JOIN_RATE_LIMIT', 10, 1, 100),
    diagnostics: diagnostics === 'true'
  });
}
