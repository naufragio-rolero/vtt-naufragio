import { readFile, writeFile, mkdir, lstat, realpath, rm, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSiteConfig } from '../public/site-config.js';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const publicFiles = Object.freeze([
  ['index.html', 'index.html'], ['app.js', 'app.js'], ['styles.css', 'styles.css'],
  ['frontend/multiplayer.js', 'frontend/multiplayer.js'], ['frontend/board-model.js', 'frontend/board-model.js'],
  ['frontend/room-media-store.js', 'frontend/room-media-store.js'],
  ['frontend/vendor/socket.io-4.8.4.esm.min.js', 'frontend/vendor/socket.io-4.8.4.esm.min.js'],
  ['frontend/vendor/socket.io-LICENSE.txt', 'frontend/vendor/socket.io-LICENSE.txt'],
  ['backend/client/token-client.js', 'client/token-client.js'], ['backend/client/asset-client.js', 'client/asset-client.js'],
  ['backend/client/indexeddb-store.js', 'client/indexeddb-store.js'],
  ['backend/shared/token-state.js', 'shared/token-state.js'],
  ...['settings.html', 'settings.js', 'settings.css', 'site-config.js', 'site.config.example.json', 'site.config.schema.json']
    .map(name => [`backend/public/${name}`, `settings/${name}`])
]);
const generator = 'naufragio-public-frontend-v1';
export async function buildFrontend({ outputRoot = sourceRoot, configPath } = {}) {
  const parent = await realpath(outputRoot);
  const target = join(parent, 'dist');
  // Only replace our own generated directory; never traverse a junction/symlink.
  const existing = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory() || await realpath(target) !== target ||
      JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).generator !== generator)) throw new Error('UNSAFE_DIST_TARGET');
  let config;
  if (configPath) {
    const value = JSON.parse(await readFile(configPath, 'utf8'));
    // Exact schema rejects extra fields, credentials and URL query strings.
    config = validateSiteConfig(value, { development: true });
  }
  const stage = join(parent, `.dist-stage-${randomUUID()}`);
  await mkdir(stage);
  const files = [];
  const put = async (name, bytes) => {
    await mkdir(dirname(join(stage, name)), { recursive: true });
    await writeFile(join(stage, name), bytes);
    files.push({ path: name, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
  };
  try {
    for (const [from, to] of publicFiles) {
      let bytes = await readFile(resolve(sourceRoot, from));
      if (['index.html', 'frontend/multiplayer.js', 'frontend/board-model.js'].includes(to)) {
        bytes = bytes.toString('utf8').replaceAll('./backend/public/', './settings/')
          .replaceAll('../backend/public/', '../settings/').replaceAll('../backend/client/', '../client/').replaceAll('../backend/shared/', '../shared/');
      }
      if (to === 'settings/settings.js') bytes = bytes.toString('utf8').replace("'../../site.config.json'", "'../site.config.json'");
      await put(to, bytes);
    }
    if (config) await put('site.config.json', `${JSON.stringify(config, null, 2)}\n`);
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    await writeFile(join(stage, 'manifest.json'), `${JSON.stringify({ generator, files }, null, 2)}\n`);
    // target and stage are fixed children of the resolved parent, verified above.
    if (existing) await rm(target, { recursive: true });
    await rename(stage, target);
    return { directory: target, files: files.length };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('INVALID_ARGUMENTS');
    const result = await buildFrontend({ configPath: args[1] });
    console.log(`dist/: ${result.files} archivos públicos y manifest.json.`);
  } catch { console.error('BUILD_FAILED: revisa el destino dist y la configuración pública.'); process.exitCode = 1; }
}
