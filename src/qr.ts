// Minimal QR Code encoder (byte mode, error-correction level M, versions 1–40, automatic mask) used to render the
// Android app download link as an SVG for desktop visitors. Pure, dependency-free, deterministic; the module output
// is checked against reference matrices (tests/fixtures/qr-reference.json) produced by an independent encoder.
// Geometry follows ISO/IEC 18004; structure after Project Nayuki's qrcodegen (MIT).
const ECC_M_CODEWORDS_PER_BLOCK=[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const ECC_M_NUM_BLOCKS=[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
function rawDataModules(v:number){let r=(16*v+128)*v+64;if(v>=2){const a=Math.floor(v/7)+2;r-=(25*a-10)*a-55;if(v>=7)r-=36}return r}
function dataCapacityBytes(v:number){return Math.floor(rawDataModules(v)/8)-ECC_M_CODEWORDS_PER_BLOCK[v]*ECC_M_NUM_BLOCKS[v]}
function rsDivisor(degree:number){const r=new Array(degree).fill(0);r[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){r[j]=gfMul(r[j],root);if(j+1<degree)r[j]^=r[j+1]}root=gfMul(root,2)}return r}
function rsRemainder(data:number[],divisor:number[]){const r=new Array(divisor.length).fill(0);for(const b of data){const f=b^r.shift()!;r.push(0);divisor.forEach((c,i)=>r[i]^=gfMul(c,f))}return r}
function gfMul(x:number,y:number){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x}return z}
function alignmentPositions(v:number){if(v===1)return[];const n=Math.floor(v/7)+2,step=v===32?26:Math.ceil((v*4+4)/(n*2-2))*2;const r=[6];for(let p=v*4+10;r.length<n;p-=step)r.splice(1,0,p);return r}
export function qrMatrix(text:string):boolean[][]{
 const bytes=[...new TextEncoder().encode(text)];
 let version=1;while(version<=40){const cap=dataCapacityBytes(version)*8,bits=4+(version<10?8:16)+bytes.length*8;if(bits<=cap)break;version++}
 if(version>40)throw RangeError('qr: text too long');
 // Segment: byte mode indicator 0100, count, data, terminator, pad to codewords
 const bb:number[]=[];const push=(val:number,len:number)=>{for(let i=len-1;i>=0;i--)bb.push((val>>>i)&1)};
 push(4,4);push(bytes.length,version<10?8:16);for(const b of bytes)push(b,8);
 const cap=dataCapacityBytes(version)*8;push(0,Math.min(4,cap-bb.length));push(0,(8-bb.length%8)%8);
 for(let pad=0xEC;bb.length<cap;pad^=0xEC^0x11)push(pad,8);
 const data:number[]=[];for(let i=0;i<bb.length;i+=8)data.push(parseInt(bb.slice(i,i+8).join(''),2));
 // Error correction, interleaved
 const nb=ECC_M_NUM_BLOCKS[version],ecl=ECC_M_CODEWORDS_PER_BLOCK[version],raw=Math.floor(rawDataModules(version)/8),nshort=nb-raw%nb,shortLen=Math.floor(raw/nb);
 const blocks:number[][]=[];const div=rsDivisor(ecl);for(let i=0,k=0;i<nb;i++){const len=shortLen-ecl+(i<nshort?0:1);const dat=data.slice(k,k+len);k+=len;blocks.push([...dat,...(i<nshort?[0]:[]),...rsRemainder(dat,div)])}
 const codewords:number[]=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-ecl||j>=nshort)codewords.push(b[i])});
 // Modules
 const size=version*4+17;const m:boolean[][]=Array.from({length:size},()=>new Array(size).fill(false));const fn:boolean[][]=Array.from({length:size},()=>new Array(size).fill(false));
 const set=(x:number,y:number,v:boolean)=>{m[y][x]=v;fn[y][x]=true};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
 const finder=(x:number,y:number)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)set(xx,yy,d!==2&&d!==4)}};
 finder(3,3);finder(size-4,3);finder(3,size-4);
 const ap=alignmentPositions(version);for(let i=0;i<ap.length;i++)for(let j=0;j<ap.length;j++){if((i===0&&j===0)||(i===0&&j===ap.length-1)||(i===ap.length-1&&j===0))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ap[i]+dx,ap[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}
 const drawFormat=(mask:number)=>{const d=(0<<3)|mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const bits=((d<<10)|r)^0x5412;const bit=(i:number)=>((bits>>>i)&1)!==0;
  for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
  for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true)};
 drawFormat(0);
 if(version>=7){let r=version;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const bits=(version<<12)|r;for(let i=0;i<18;i++){const b=((bits>>>i)&1)!==0,a=size-11+i%3,c=Math.floor(i/3);set(a,c,b);set(c,a,b)}}
 // Data placement (zigzag)
 let i=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,upward=((right+1)&2)===0,y=upward?size-1-vert:vert;if(!fn[y][x]&&i<codewords.length*8){m[y][x]=((codewords[i>>>3]>>>(7-(i&7)))&1)!==0;i++}}}
 // Mask selection by penalty
 const applyMask=(mask:number)=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++){if(fn[y][x])continue;let inv=false;switch(mask){case 0:inv=(x+y)%2===0;break;case 1:inv=y%2===0;break;case 2:inv=x%3===0;break;case 3:inv=(x+y)%3===0;break;case 4:inv=(Math.floor(x/3)+Math.floor(y/2))%2===0;break;case 5:inv=x*y%2+x*y%3===0;break;case 6:inv=(x*y%2+x*y%3)%2===0;break;case 7:inv=((x+y)%2+x*y%3)%2===0;break}if(inv)m[y][x]=!m[y][x]}};
 const penalty=()=>{let res=0;
  const finderPenalty=(hist:number[])=>{const n=hist[1];const core=n>0&&hist[2]===n&&hist[3]===n*3&&hist[4]===n&&hist[5]===n;return (core&&hist[0]>=n*4&&hist[6]>=n?1:0)+(core&&hist[6]>=n*4&&hist[0]>=n?1:0)};
  const scan=(get:(a:number,b:number)=>boolean)=>{for(let a=0;a<size;a++){let runColor=false,runX=0;const hist=[0,0,0,0,0,0,0];for(let b=0;b<size;b++){if(get(a,b)===runColor){runX++;if(runX===5)res+=3;else if(runX>5)res++}else{hist.shift();hist.push(runX);if(!runColor)res+=finderPenalty(hist)*40;runColor=get(a,b);runX=1}}hist.shift();hist.push(runX+(runColor?0:size));res+=finderPenalty(hist)*40}};
  scan((y,x)=>m[y][x]);scan((x,y)=>m[y][x]);
  for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=m[y][x];if(c===m[y][x+1]&&c===m[y+1][x]&&c===m[y+1][x+1])res+=3}
  let dark=0;for(const row of m)for(const c of row)if(c)dark++;const total=size*size;res+=(Math.ceil(Math.abs(dark*20-total*10)/total)-1)*10;return res};
 let best=0,bestScore=Infinity;for(let mask=0;mask<8;mask++){applyMask(mask);drawFormat(mask);const s=penalty();if(s<bestScore){bestScore=s;best=mask}applyMask(mask)}
 applyMask(best);drawFormat(best);
 return m;
}
/** SVG (square, 4-module quiet zone) suitable for <img>; colours via currentColor-free fixed values for print/dark backgrounds. */
export function qrSvg(text:string,options:{dark?:string,light?:string}={}):string{
 const m=qrMatrix(text),n=m.length,q=4,s=n+q*2;const d:string[]=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(m[y][x])d.push(`M${x+q} ${y+q}h1v1h-1z`);
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${s}" height="${s}" fill="${options.light??'#ffffff'}"/><path d="${d.join('')}" fill="${options.dark??'#000000'}"/></svg>`;
}
