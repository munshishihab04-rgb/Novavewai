import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {qrMatrix,qrSvg} from '../src/qr.ts';
// The QR encoder is dependency-free, so it is checked against matrices from an independent encoder (segno, Python) for the
// same text/mode/ECC level. Mask selection is the encoder's only freedom: the result must equal exactly one of the 8 masked references.
test('qrMatrix equals an independent encoder (byte mode, ECC M) for ASCII, URL with query and multi-script UTF-8 text',async()=>{
 const ref=JSON.parse(await readFile(new URL('./fixtures/qr-reference.json',import.meta.url),'utf8'));
 for(const [text,item] of Object.entries<any>(ref.items)){
  const m=qrMatrix(text);const rows=m.map(r=>r.map(c=>c?'1':'0').join(''));
  assert.equal(m.length,item.size,'version/size '+text);
  const hits=Object.entries<string[]>(item.masks).filter(([,r])=>r.join('\n')===rows.join('\n')).map(([k])=>k);
  assert.equal(hits.length,1,'must match exactly one reference mask for '+text+' (got '+hits.join(',')+')');
 }
});
test('qrSvg is square with a 4-module quiet zone and only 1x1 dark modules; too-long input throws instead of truncating',()=>{
 const svg=qrSvg('https://licenzpol.it/nova/download/nova.apk');const s=Number(/viewBox="0 0 (\d+) (\d+)"/.exec(svg)![1]);
 assert.equal(/viewBox="0 0 (\d+) (\d+)"/.exec(svg)![2],String(s));assert.equal(s,33+8);
 for(const [,x,y] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)){assert.ok(Number(x)>=4&&Number(x)<s-4&&Number(y)>=4&&Number(y)<s-4,'module inside quiet zone')}
 assert.ok(!/<script|javascript:/i.test(svg));
 assert.throws(()=>qrMatrix('x'.repeat(3000)),RangeError);
});
