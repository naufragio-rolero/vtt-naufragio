import { readFile } from 'node:fs/promises';
import { validateSiteConfig } from '../public/site-config.js';

try {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file || args.some(arg => arg.startsWith('--') && arg !== '--development')) throw new Error();
  validateSiteConfig(JSON.parse(await readFile(file, 'utf8')), { development: args.includes('--development') });
  console.log('Configuración pública válida.');
} catch {
  console.error('Configuración pública no válida. Uso: npm run validate:site -- archivo.json [--development]');
  process.exitCode = 1;
}
