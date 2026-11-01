// Prepare a local candidate; no network, SSH, service control or publication.
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontend } from './build-frontend.js';

const args=process.argv.slice(2);
if (args.length && (args.length!==2 || args[0]!=='--config')) throw new Error('INVALID_ARGUMENTS');
const outputRoot=fileURLToPath(new URL('../../artifacts/phase10/',import.meta.url));
await mkdir(outputRoot,{recursive:true});
const result=await buildFrontend({outputRoot,storageNamespace:'phase9-beta',...(args.length?{configPath:resolve(args[1])}:{})});
await writeFile(resolve(outputRoot,'LEER-ANTES-DE-PUBLICAR.txt'),
  'Candidato local Fase 10. NO PUBLICADO.\nNamespace conservado: phase9-beta.\nRequiere backend y frontend coordinados, SQLite v7, ventana sin participantes y autorización del propietario.\nSeguir docs/FASE10-UX-MULTIJUGADOR.md para backup, validación y rollback.\n');
console.log(JSON.stringify({...result,storageNamespace:'phase9-beta',published:false}));
