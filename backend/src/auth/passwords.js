import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../errors.js';

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3';
const format = /^scrypt\$32768\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

export function validateNewPassword(password) {
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 ||
      Buffer.byteLength(password, 'utf8') > 512) throw new HttpError(400, 'INVALID_PASSWORD');
}

// One derivation at a time, at most four waiting. No unbounded libuv work queue.
export function createPasswordHasher() {
  let busy = false;
  const waiting = [];
  async function limited(work) {
    if (busy) {
      if (waiting.length >= 4) throw new HttpError(503, 'AUTH_BUSY');
      await new Promise(resolve => waiting.push(resolve));
    } else busy = true;
    try { return await work(); }
    finally {
      if (waiting.length) waiting.shift()();
      else busy = false;
    }
  }
  return {
    async hash(password) {
      validateNewPassword(password);
      return limited(async () => {
        const salt = randomBytes(16);
        const hash = await derive(password, salt, 64, parameters);
        return `${prefix}$${salt.toString('hex')}$${hash.toString('hex')}`;
      });
    },
    async verify(password, encoded) {
      const match = typeof encoded === 'string' ? format.exec(encoded) : null;
      // Missing users take the same KDF path. This dummy cannot create a session.
      const salt = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(16);
      const expected = match ? Buffer.from(match[2], 'hex') : Buffer.alloc(64);
      return limited(async () => {
        const actual = await derive(password, salt, 64, parameters);
        const equal = timingSafeEqual(actual, expected);
        return match !== null && equal;
      });
    }
  };
}

export const passwords = createPasswordHasher();
