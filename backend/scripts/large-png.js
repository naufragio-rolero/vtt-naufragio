import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
function crc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return(crc^0xffffffff)>>>0;}
function chunk(type,bytes){const header=Buffer.alloc(8),crc=Buffer.alloc(4);header.writeUInt32BE(bytes.length);header.write(type,4);crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),bytes])));return Buffer.concat([header,bytes,crc]);}
export function largePng(){
  const width=1740,height=1740,stride=width*4+1,raw=randomBytes(stride*height);
  for(let y=0;y<height;y++)raw[y*stride]=0;
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const signature=Buffer.from('89504e470d0a1a0a','hex'),head=chunk('IHDR',ihdr),image=chunk('IDAT',deflateSync(raw,{level:1})),end=chunk('IEND',Buffer.alloc(0));
  const size=12*1024*1024,pad=size-signature.length-head.length-image.length-end.length-12;
  if(pad<0)throw new Error('PNG_PADDING');return Buffer.concat([signature,head,image,chunk('npAD',Buffer.alloc(pad)),end]);
}
