import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';

export const origin = 'http://localhost:8080';
export async function fixture(t, overrides = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: origin, ...overrides });
  const app = createBackend(config);
  const address = await app.listen(0);
  t.after(() => app.close());
  return { app, config, url: `http://127.0.0.1:${address.port}` };
}
