import { readFile, copyFile, mkdir } from 'node:fs/promises';
const dependency = new URL('../node_modules/socket.io-client/', import.meta.url);
const output = new URL('../../frontend/vendor/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', dependency), 'utf8'));
if (metadata.version !== '4.8.4') throw new Error('REVIEW_BROWSER_CLIENT_VERSION');
await mkdir(output, { recursive: true });
await copyFile(new URL('dist/socket.io.esm.min.js', dependency), new URL('socket.io-4.8.4.esm.min.js', output));
await copyFile(new URL('LICENSE', dependency), new URL('socket.io-LICENSE.txt', output));
console.log('Cliente público Socket.IO 4.8.4 preparado desde el lockfile.');
