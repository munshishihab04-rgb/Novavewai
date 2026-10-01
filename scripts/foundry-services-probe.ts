// Live bounded probe of Foundry services on the exact supplied resource. Synthetic data only.
// Usage: node_modules/.bin/tsx scripts/foundry-services-probe.ts  (reads NOVA_REVIEW_FOUNDRY_KEY from .hermes/.env via child env only)
// Each service: exactly one operation, bounded polling, no retries. Writes sanitized JSON to evidence/foundry-services-1/live/.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {analyzeDocument,FOUNDRY_ENDPOINT,type AnalyzerId} from '../src/foundry-documents.ts';
const root=new URL('../',import.meta.url).pathname;const out=root+'evidence/foundry-services-1/live/';mkdirSync(out,{recursive:true});
function loadKey(){if(process.env.NOVA_REVIEW_FOUNDRY_KEY)return process.env.NOVA_REVIEW_FOUNDRY_KEY;const line=readFileSync('/home/azureuser/.hermes/.env','utf8').split('\n').find(l=>l.startsWith('NOVA_REVIEW_FOUNDRY_KEY='));return line?line.slice('NOVA_REVIEW_FOUNDRY_KEY='.length).trim().replace(/^["']|["']$/g,''):''}
const key=loadKey();if(!key){console.error('credential missing');process.exit(2)}
const sanitize=(s:string)=>s.split(key).join('[REDACTED]');
const SYNTH_TEXT='ACME TEST 123\nSample Widget 2 x 10.00\nTotal 20.00 EUR';
// Synthetic image rendered locally (fake, non-personal text).
const png=root+'evidence/foundry-services-1/live/synthetic.png';
execFileSync(root+'.venv-docs/bin/python',['-I','-c',`
from PIL import Image,ImageDraw,ImageFont;import sys
im=Image.new('RGB',(420,140),'white');d=ImageDraw.Draw(im)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
except Exception: f=ImageFont.load_default()
y=10
for line in ${JSON.stringify(SYNTH_TEXT)}.split('\\n'): d.text((12,y),line,fill='black',font=f); y+=40
im.save(sys.argv[1])`,png]);
const bytes=readFileSync(png);
const matrix:any={endpoint:FOUNDRY_ENDPOINT,checkedAt:new Date().toISOString(),syntheticInput:{pngBytes:bytes.length,text:SYNTH_TEXT},services:{}};
for(const analyzerId of ['prebuilt-read','prebuilt-layout'] as AnalyzerId[]){
 const r=await analyzeDocument({analyzerId,bytes,mime:'image/png'});
 matrix.services[analyzerId]={...r,...(r.status==='extracted'?{textPreview:r.text.slice(0,300)}:{})};
 if(r.status==='extracted')delete matrix.services[analyzerId].text;
 console.log(analyzerId,r.status,r.status==='extracted'?`pages=${r.pageCount} text=${JSON.stringify(r.text.slice(0,80))}`:`${r.reason} http=${r.httpStatus??''} code=${r.errorCode??''}`);
}
async function one(name:string,url:string,init:RequestInit){
 const ac=new AbortController();const t=setTimeout(()=>ac.abort(),20000);
 try{const r=await fetch(url,{...init,redirect:'error',signal:ac.signal,headers:{'ocp-apim-subscription-key':key,'content-type':'application/json',...(init.headers as any??{})}});const raw=(await r.text()).slice(0,4000);
  let body:any;try{body=JSON.parse(raw)}catch{body=raw}
  matrix.services[name]={httpStatus:r.status,operationLocation:r.headers.get('operation-location')?'present':null,body:JSON.parse(sanitize(JSON.stringify(body)))};console.log(name,r.status,sanitize(raw).slice(0,200).replace(/\s+/g,' '));
 }catch(e:any){matrix.services[name]={status:'unavailable',reason:sanitize(String(e?.message??e))};console.log(name,'error',matrix.services[name].reason)}finally{clearTimeout(t)}
}
const docs=[{id:'1',language:'en',text:'The quick brown fox visits the test office on Monday. Contact: test.person@example.com'}];
await one('language-detect',`${FOUNDRY_ENDPOINT}/language/:analyze-text?api-version=2024-11-01`,{method:'POST',body:JSON.stringify({kind:'LanguageDetection',parameters:{modelVersion:'latest'},analysisInput:{documents:[{id:'1',text:'Buongiorno, questo è un testo di prova sintetico.'}]}})});
await one('pii-detect',`${FOUNDRY_ENDPOINT}/language/:analyze-text?api-version=2024-11-01`,{method:'POST',body:JSON.stringify({kind:'PiiEntityRecognition',parameters:{modelVersion:'latest',domain:'none'},analysisInput:{documents:docs}})});
await one('translator',`${FOUNDRY_ENDPOINT}/translator/text/v3.0/translate?api-version=3.0&to=it`,{method:'POST',body:JSON.stringify([{Text:'This is a short synthetic test sentence.'}])});
writeFileSync(out+'service-matrix.json',sanitize(JSON.stringify(matrix,null,2)));
console.log('written',out+'service-matrix.json');
