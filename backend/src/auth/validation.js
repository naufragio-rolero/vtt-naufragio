import { HttpError } from '../errors.js';

export const roles = Object.freeze(['admin', 'director', 'user']);
export function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...required, ...optional].includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT');
  }
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(value)) throw new HttpError(400, 'INVALID_INPUT');
  return value.toLowerCase();
}
export function role(value) {
  if (!roles.includes(value)) throw new HttpError(400, 'INVALID_INPUT');
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new HttpError(400, 'INVALID_INPUT');
  }
  return value;
}
export function loginInput(value) {
  fields(value, ['username', 'password']);
  const name = username(value.username);
  if (typeof value.password !== 'string' || Buffer.byteLength(value.password) < 1 || Buffer.byteLength(value.password) > 512) {
    throw new HttpError(400, 'INVALID_INPUT');
  }
  return name;
}
