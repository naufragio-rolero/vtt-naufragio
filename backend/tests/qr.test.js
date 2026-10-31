import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import jsQR from 'jsqr';
import { invitationLink,drawQr } from '../../frontend/qr.js';

test('vendored QR module is byte-identical to pinned MIT dependency',async()=>{
  const require=createRequire(import.meta.url);
  assert.deepEqual(await readFile(new URL('../../frontend/vendor/qrcode-generator-2.0.4.js',import.meta.url)),await readFile(new URL('./qrcode.mjs',pathToFileURL(require.resolve('qrcode-generator')))));
  assert.match(await readFile(new URL('../../frontend/vendor/qrcode-LICENSE.txt',import.meta.url),'utf8'),/MIT/);
});
test('QR decodes root and subdirectory links, with no credential or backend in query',()=>{
  for(const base of ['https://example.invalid/','https://example.invalid/vtt/index.html?ignored=yes']){
    const token='qr_'+randomBytes(32).toString('base64url'),link=invitationLink(base,token);
    const url=new URL(link);assert.equal(url.search,'');assert.equal(url.hash,'#join='+token);assert.ok(url.pathname.endsWith('/join.html'));
    const canvas={width:0,height:0,getContext(){return {fillStyle:'',fillRect(x,y,w,h){
      if(!canvas.pixels)canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4).fill(255);
      if(this.fillStyle==='#000')for(let r=y;r<y+h;r++)for(let c=x;c<x+w;c++){const i=(r*canvas.width+c)*4;canvas.pixels[i]=canvas.pixels[i+1]=canvas.pixels[i+2]=0;}
    }}}};
    drawQr(canvas,link);assert.ok(jsQR(canvas.pixels,canvas.width,canvas.height)?.data===link);
  }
  for(const value of ['sess_'+randomBytes(32).toString('base64url'),'bad','qr_'+randomBytes(32).toString('base64url')+'&api=evil'])assert.throws(()=>invitationLink('https://example.invalid/',value));
});
