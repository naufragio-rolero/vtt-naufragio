import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildFrontend, publicFiles } from '../scripts/build-frontend.js';
import { createDistServer } from '../scripts/serve-dist.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'naufragio-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('dist contains only allowlisted browser files with reproducible hashes and no backend directory', async t => {
  const root = await fixture(t);
  await writeFile(join(root, '.env'), 'SYNTHETIC_NOT_PUBLIC=true');
  await buildFrontend({ outputRoot: root });
  const directory = join(root, 'dist');
  const before = await readFile(join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(before);
  assert.equal(manifest.files.length, publicFiles.length);
  assert.equal((await readdir(directory)).includes('backend'), false);
  for (const file of manifest.files) {
    const bytes = await readFile(join(directory, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.includes(Buffer.from('SYNTHETIC_NOT_PUBLIC')), false);
    assert.equal(/^(backend|src|scripts|tests|node_modules|\.git|\.env)(\/|$)/.test(file.path), false);
  }
  assert.match(await readFile(join(directory, 'index.html'), 'utf8'), /\.\/settings\/settings.html/);
  assert.doesNotMatch(await readFile(join(directory, 'frontend/multiplayer.js'), 'utf8'), /\.\.\/backend\//);
  assert.match(await readFile(join(directory, 'settings/settings.js'), 'utf8'), /'\.\.\/site.config.json'/);
  await buildFrontend({ outputRoot: root });
  assert.equal(await readFile(join(directory, 'manifest.json'), 'utf8'), before);
});
test('dist refuses unrecognized existing content and invalid public config without deleting it', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/keep.txt'), 'keep');
  await assert.rejects(buildFrontend({ outputRoot: root }));
  assert.equal(await readFile(join(root, 'dist/keep.txt'), 'utf8'), 'keep');
  await rm(join(root, 'dist'), { recursive: true });
  const configPath = join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ secret: 'SYNTHETIC' }));
  await assert.rejects(buildFrontend({ outputRoot: root, configPath }));
  assert.equal((await readdir(root)).includes('dist'), false);
});
test('dist validates explicit public config and serves only generated public files in a subdirectory', async t => {
  const root = await fixture(t);
  const configPath = join(root, 'public.json');
  const config = JSON.parse(await readFile(new URL('../public/site.config.example.json', import.meta.url), 'utf8'));
  await writeFile(configPath, JSON.stringify(config));
  await buildFrontend({ outputRoot: root, configPath });
  const directory = join(root, 'dist');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'site.config.json'), 'utf8')), config);
  const server = await createDistServer({ directory, basePath: '/vtt/' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['index.html', 'client/token-client.js', 'shared/token-state.js', 'settings/settings.html', 'site.config.json']) {
    assert.equal((await fetch(`${base}/vtt/${name}`)).status, 200);
  }
  for (const path of ['/index.html', '/vtt/backend/src/server.js', '/vtt/.env', '/vtt/../public.json', '/vtt/manifest.json']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  await writeFile(configPath, JSON.stringify({ ...config, password: 'SYNTHETIC' }));
  await assert.rejects(buildFrontend({ outputRoot: root, configPath }));
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'site.config.json'), 'utf8')), config);
});
