import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDocument,selectDocumentRoute,proposedDocumentTools,FOUNDRY_ENDPOINT,ALLOWED_ANALYZERS,LIMITS} from '../src/foundry-documents.ts';

const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64)]);
const cuResult={status:'Succeeded',result:{analyzerId:'prebuilt-read',contents:[{kind:'document',markdown:'ACME TEST 123',startPageNumber:1,endPageNumber:1,pages:[{pageNumber:1,width:8.5,height:11,unit:'inch',words:[{content:'ACME',confidence:0.99,span:{offset:0,length:4}},{content:'TEST',confidence:0.5,span:{offset:5,length:4}}],lines:[{content:'ACME TEST 123',span:{offset:0,length:13}}]}]}]}};
function fakeFetch(plan:Array<{status:number,body?:any,headers?:Record<string,string>}>,log:any[]=[]){
 return async(url:any,init:any)=>{log.push({url:String(url),method:init?.method??'GET',headers:init?.headers,bodyLen:init?.body?.length});const step=plan.shift();if(!step)throw Error('unexpected_fetch');
  return new Response(step.body===undefined?null:JSON.stringify(step.body),{status:step.status,headers:step.headers??{}})};
}
const deps=(fetch:any,extra:any={})=>({fetch,key:'k',sleep:async()=>{},...extra});

test('adapter fixes endpoint and refuses analyzers outside the allowlist',async()=>{
 assert.equal(FOUNDRY_ENDPOINT,'https://foundryn.services.ai.azure.com');
 assert.deepEqual([...ALLOWED_ANALYZERS],['prebuilt-read','prebuilt-layout']);
 const log:any[]=[];
 const r=await analyzeDocument({analyzerId:'prebuilt-invoice' as any,bytes:PNG,mime:'image/png'},deps(fakeFetch([],log)));
 assert.equal(r.status,'unsupported');assert.equal(log.length,0);
});
test('ocr success returns page evidence, word confidence and markdown text without leaking the key',async()=>{
 const log:any[]=[];
 const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},deps(fakeFetch([{status:202,headers:{'operation-location':FOUNDRY_ENDPOINT+'/contentunderstanding/analyzerResults/op-1?api-version=2025-11-01'}},{status:200,body:{status:'Running'}},{status:200,body:cuResult}],log)));
 assert.equal(r.status,'extracted');if(r.status!=='extracted')return;
 assert.equal(r.text,'ACME TEST 123');assert.equal(r.analyzerId,'prebuilt-read');assert.equal(r.method,'foundry-content-understanding');
 assert.equal(r.pages.length,1);assert.equal(r.pages[0].pageNumber,1);assert.equal(r.pages[0].words,2);assert.ok(Math.abs(r.pages[0].meanWordConfidence-0.745)<1e-9);assert.equal(r.pages[0].minWordConfidence,0.5);
 assert.equal(r.executed,false);assert.equal(r.trust,'user_supplied');assert.equal(r.operationId,'op-1');
 assert.equal(log[0].url,FOUNDRY_ENDPOINT+'/contentunderstanding/analyzers/prebuilt-read:analyzeBinary?api-version=2025-11-01');
 assert.equal(log[0].headers['ocp-apim-subscription-key'],'k');assert.equal(log[0].headers['content-type'],'application/octet-stream');
 assert.equal(log[1].url,FOUNDRY_ENDPOINT+'/contentunderstanding/analyzerResults/op-1?api-version=2025-11-01');
 assert.ok(!JSON.stringify(r).includes('"k"'));
});
test('operation-location outside the fixed endpoint is rejected, never followed',async()=>{
 const log:any[]=[];
 const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},deps(fakeFetch([{status:202,headers:{'operation-location':'https://evil.example/contentunderstanding/analyzerResults/x?api-version=2025-11-01'}}],log)));
 assert.equal(r.status,'failed');assert.equal(log.length,1);
});
test('403 429 and 5xx map to explicit states without retry',async()=>{
 for(const [status,expected] of [[403,'denied'],[401,'denied'],[429,'throttled'],[503,'unavailable']] as const){
  const log:any[]=[];const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},deps(fakeFetch([{status,body:{error:{code:'x'}}}],log)));
  assert.equal(r.status,expected);assert.equal(r.httpStatus,status);assert.equal(log.length,1);
 }
});
test('polling is bounded and reports timeout',async()=>{
 const plan=[{status:202,headers:{'operation-location':FOUNDRY_ENDPOINT+'/contentunderstanding/analyzerResults/op-2?api-version=2025-11-01'}}];
 for(let i=0;i<LIMITS.maxPolls+5;i++)plan.push({status:200,body:{status:'Running'}} as any);
 const log:any[]=[];const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},deps(fakeFetch(plan,log)));
 assert.equal(r.status,'timeout');assert.equal(log.length,1+LIMITS.maxPolls);
});
test('cancellation via AbortSignal yields cancelled state',async()=>{
 const ac=new AbortController();ac.abort();
 const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},deps(async()=>{throw new DOMException('aborted','AbortError')},{signal:ac.signal}));
 assert.equal(r.status,'cancelled');
});
test('rejects oversize bytes, unknown magic and any url-like input before network',async()=>{
 const log:any[]=[];
 const big=await analyzeDocument({analyzerId:'prebuilt-read',bytes:Buffer.alloc(LIMITS.maxBytes+1),mime:'image/png'},deps(fakeFetch([],log)));
 assert.equal(big.status,'unsupported');
 const svg=await analyzeDocument({analyzerId:'prebuilt-read',bytes:Buffer.from('<svg/>'),mime:'image/svg+xml'},deps(fakeFetch([],log)));
 assert.equal(svg.status,'unsupported');
 const url=await analyzeDocument({analyzerId:'prebuilt-read',url:'https://example.com/a.png'} as any,deps(fakeFetch([],log)));
 assert.equal(url.status,'unsupported');assert.equal(log.length,0);
});
test('missing credential yields unavailable without network',async()=>{
 const log:any[]=[];const r=await analyzeDocument({analyzerId:'prebuilt-read',bytes:PNG,mime:'image/png'},{fetch:fakeFetch([],log),key:'',sleep:async()=>{}});
 assert.equal(r.status,'unavailable');assert.equal(log.length,0);
});
test('route policy prefers local parse, uses OCR only for images and textless pdf, never claims universal formats',()=>{
 assert.equal(selectDocumentRoute({name:'a.txt',mime:'text/plain',extraction:{status:'extracted',method:'utf8'}}).route,'local');
 assert.equal(selectDocumentRoute({name:'a.pdf',mime:'application/pdf',extraction:{status:'extracted',method:'text-layer',coverage:'all-pages'}}).route,'local');
 assert.equal(selectDocumentRoute({name:'scan.png',mime:'image/png',extraction:{status:'unsupported'}}).route,'foundry-ocr');
 assert.equal(selectDocumentRoute({name:'scan.pdf',mime:'application/pdf',extraction:{status:'unsupported'}}).route,'foundry-ocr');
 assert.equal(selectDocumentRoute({name:'a.zip',mime:'application/zip',extraction:{status:'unsupported'}}).route,'none');
 assert.equal(selectDocumentRoute({name:'a.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',extraction:{status:'unsupported'}}).route,'none');
});
test('proposed tools are schemas only, inactive, and none accepts a url',()=>{
 assert.deepEqual(Object.keys(proposedDocumentTools).sort(),['document_ocr','text_language_detect','text_pii_detect','text_translate']);
 for(const t of Object.values(proposedDocumentTools)){assert.equal(t.active,false);assert.ok(!JSON.stringify(t.parameters).includes('url'));assert.ok(t.description.length<600);assert.equal(t.parameters.additionalProperties,false);}
 assert.deepEqual(proposedDocumentTools.document_ocr.parameters.properties.analyzerId.enum,['prebuilt-read','prebuilt-layout']);
});
