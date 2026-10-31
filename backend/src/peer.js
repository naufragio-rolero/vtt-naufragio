import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

function normalize(value) {
  if (!isIP(value)) throw new HttpError(403, 'PROXY_DENIED');
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) value = value.slice(7);
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}
function single(request, name) {
  const count = (request.rawHeaders ?? []).filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
  const value = request.headers[name];
  if (count !== 1 || typeof value !== 'string' || value.includes(',') || value.trim() !== value) throw new HttpError(403, 'PROXY_DENIED');
  return value;
}
export function clientAddress(request, config) {
  const peer = normalize(request.socket.remoteAddress);
  if (!config.trustProxyLoopback) return peer;
  if (!['127.0.0.1', '::1', '::ffff:7f00:1'].includes(peer)) throw new HttpError(403, 'PROXY_DENIED');
  const supplied = single(request, 'x-naufragio-proxy-token');
  const expected = config.proxyToken;
  if (!/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new HttpError(403, 'PROXY_DENIED');
  if (single(request, 'x-forwarded-proto') !== 'https') throw new HttpError(403, 'PROXY_DENIED');
  return normalize(single(request, 'x-forwarded-for'));
}
