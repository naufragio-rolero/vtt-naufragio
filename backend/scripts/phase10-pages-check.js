// Read-only snapshot of the currently published beta; never requests a Pages build.
import { execFileSync } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(root,'artifacts/phase10-validation/pages-before');
const ref='4a6ba2c10fbb0bd0a0dd660ad165b152e9ca0000';
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,...args],{cwd:root,maxBuffer:10*1024*1024});
const paths=git('ls-tree','-r','--name-only',ref,'beta/').toString().trim().split('\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
await mkdir(out,{recursive:true});
for(const path of paths) {
  if(!/^beta\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..'))throw new Error('INVALID_PUBLISHED_PATH');
  const expected=git('show',`${ref}:${path}`);
  const response=await fetch(`https://naufragio-rolero.github.io/vtt-naufragio/${path}`,{redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  const target=resolve(out,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
  checks.push({path,status:response.status,sha256:sha(bytes),expectedSha256:sha(expected),matches:response.ok&&sha(bytes)===sha(expected)});
}
const api=await fetch('https://api.naufragio.net/health',{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
const report={at:new Date().toISOString(),ref,files:checks,allMatch:checks.every(c=>c.matches),apiHealthStatus:api.status,publishedByThisRun:false};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({files:checks.length,allMatch:report.allMatch,apiHealthStatus:api.status,publishedByThisRun:false}));
if(!report.allMatch)process.exitCode=1;
