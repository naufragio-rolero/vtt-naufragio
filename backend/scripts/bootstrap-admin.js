import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../src/config.js';
import { openStorage } from '../src/storage.js';
import { createAuthService } from '../src/auth/service.js';
import { readHidden } from './hidden-input.js';

let store;
try {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error();
  const config = loadConfig();
  if (config.databasePath === ':memory:') throw new Error();
  store = openStorage(config.databasePath);
  const auth = createAuthService(store, config);
  if (!auth.bootstrapAvailable()) throw new Error();
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try { username = await terminal.question('Usuario administrador (3–32 caracteres): '); }
  finally { terminal.close(); }
  const password = await readHidden('Contraseña (15–128 caracteres; no se muestra): ');
  const confirmation = await readHidden('Repetir contraseña: ');
  if (password !== confirmation) throw new Error();
  await auth.bootstrap({ username, password });
  console.log('Administrador inicial creado. Inicia sesión mediante la API.');
} catch {
  console.error('BOOTSTRAP_FAILED: requiere terminal interactiva, base vacía y datos válidos; no se admiten argumentos ni contraseñas por entorno.');
  process.exitCode = 1;
} finally { store?.close(); }
