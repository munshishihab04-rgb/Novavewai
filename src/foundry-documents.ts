// Bounded Foundry Content Understanding adapter for NOVA document capability.
// Fixed endpoint, allowlisted prebuilt analyzers, byte input only (never model-supplied URLs),
// single operation with bounded polling, explicit error states, page evidence with confidence.
// API schema: POST {endpoint}/contentunderstanding/analyzers/{analyzerId}:analyzeBinary?api-version=2025-11-01
//   -> 202 + Operation-Location; GET {endpoint}/contentunderstanding/analyzerResults/{operationId}?api-version=2025-11-01
//   (learn.microsoft.com/rest/api/contentunderstanding, 2025-11-01, key auth header Ocp-Apim-Subscription-Key)
// Credential: process.env.NOVA_REVIEW_FOUNDRY_KEY only, read at call time, never logged or returned.
export const FOUNDRY_ENDPOINT='https://foundryn.services.ai.azure.com';
export const CU_API_VERSION='2025-11-01';
export const ALLOWED_ANALYZERS=new Set(['prebuilt-read','prebuilt-layout'] as const);
export type AnalyzerId='prebuilt-read'|'prebuilt-layout';
export const LIMITS={maxBytes:4*1024*1024,maxPolls:20,pollMs:1500,requestTimeoutMs:20000,maxResultBytes:2*1024*1024,maxTextChars:60000};
// Magic-number allowlist. Content Understanding accepts more formats; NOVA only forwards these.
const MAGIC:Array<{mime:string,test:(b:Buffer)=>boolean}>=[
 {mime:'application/pdf',test:b=>b.subarray(0,5).toString('latin1')==='%PDF-'},
 {mime:'image/png',test:b=>b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))},
 {mime:'image/jpeg',test:b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff},
 {mime:'image/tiff',test:b=>b.subarray(0,4).equals(Buffer.from([0x49,0x49,0x2a,0x00]))||b.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0x00,0x2a]))},
];
export type PageEvidence={pageNumber:number,words:number,lines:number,meanWordConfidence:number,minWordConfidence:number,lowConfidenceWords:number};
export type DocumentAnalysis=
 |{status:'extracted',analyzerId:AnalyzerId,method:'foundry-content-understanding',text:string,pages:PageEvidence[],pageCount:number,truncated:boolean,operationId:string,executed:false,trust:'user_supplied',endpoint:string,elapsedMs:number}
 |{status:'unsupported'|'unavailable'|'denied'|'throttled'|'failed'|'timeout'|'cancelled',reason:string,httpStatus?:number,errorCode?:string,operationId?:string,elapsedMs:number};
export type AnalyzeInput={analyzerId:AnalyzerId,bytes:Buffer,mime?:string,signal?:AbortSignal};
export type Deps={fetch?:typeof fetch,key?:string,sleep?:(ms:number)=>Promise<void>,signal?:AbortSignal};
const defaultSleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function fail(status:Exclude<DocumentAnalysis['status'],'extracted'>,reason:string,started:number,extra:Partial<{httpStatus:number,errorCode:string,operationId:string}>={}):DocumentAnalysis{return {status,reason,elapsedMs:Date.now()-started,...extra}}
function httpState(code:number):'denied'|'throttled'|'unavailable'|'failed'{if(code===401||code===403)return 'denied';if(code===429)return 'throttled';if(code>=500)return 'unavailable';return 'failed'}
async function errorCode(r:Response){try{const d=await r.json() as any;return typeof d?.error?.code==='string'?d.error.code.slice(0,80):undefined}catch{return undefined}}
function withTimeout(signal:AbortSignal|undefined,ms:number){const ac=new AbortController();const t=setTimeout(()=>ac.abort(new DOMException('timeout','TimeoutError')),ms);const onAbort=()=>ac.abort(signal!.reason);if(signal){if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true})}return {signal:ac.signal,clear(){clearTimeout(t);signal?.removeEventListener('abort',onAbort)}}}
export async function analyzeDocument(input:AnalyzeInput,deps:Deps={}):Promise<DocumentAnalysis>{
 const started=Date.now();const f=deps.fetch??fetch;const sleep=deps.sleep??defaultSleep;const signal=deps.signal??input.signal;
 if(!ALLOWED_ANALYZERS.has(input.analyzerId as any))return fail('unsupported',`Analyzer not in NOVA allowlist: ${String(input.analyzerId).slice(0,40)}`,started);
 if('url' in (input as any)||!Buffer.isBuffer(input.bytes))return fail('unsupported','Only uploaded bytes are analyzed; URLs are never fetched on behalf of the model.',started);
 if(input.bytes.length===0||input.bytes.length>LIMITS.maxBytes)return fail('unsupported',`Document must be 1 byte to ${LIMITS.maxBytes} bytes.`,started);
 const detected=MAGIC.find(m=>m.test(input.bytes));if(!detected)return fail('unsupported','Only PDF, PNG, JPEG and TIFF bytes are sent for OCR/layout; other formats are stored only.',started);
 const key=deps.key??process.env.NOVA_REVIEW_FOUNDRY_KEY??'';if(!key)return fail('unavailable','Foundry document credential not configured.',started);
 const headers={'ocp-apim-subscription-key':key,'content-type':'application/octet-stream'};
 let opUrl:string,operationId:string;
 try{
  const t=withTimeout(signal,LIMITS.requestTimeoutMs);let r:Response;
  try{r=await f(`${FOUNDRY_ENDPOINT}/contentunderstanding/analyzers/${input.analyzerId}:analyzeBinary?api-version=${CU_API_VERSION}`,{method:'POST',headers,body:new Uint8Array(input.bytes),redirect:'error',signal:t.signal})}finally{t.clear()}
  if(r.status!==202&&r.status!==200)return fail(httpState(r.status),`Analyze request rejected (HTTP ${r.status}); no retry.`,started,{httpStatus:r.status,errorCode:await errorCode(r)});
  const loc=r.headers.get('operation-location')??'';const prefix=`${FOUNDRY_ENDPOINT}/contentunderstanding/analyzerResults/`;
  if(!loc.startsWith(prefix))return fail('failed','Operation-Location outside fixed endpoint; not followed.',started,{httpStatus:r.status});
  operationId=loc.slice(prefix.length).split('?')[0];if(!/^[A-Za-z0-9._-]{1,128}$/.test(operationId))return fail('failed','Malformed operation id.',started);
  opUrl=`${prefix}${operationId}?api-version=${CU_API_VERSION}`;
 }catch(e:any){return fail(isAbort(e)?'cancelled':'unavailable',isAbort(e)?'Cancelled before analysis completed.':'Network failure contacting Foundry.',started)}
 for(let i=0;i<LIMITS.maxPolls;i++){
  if(signal?.aborted)return fail('cancelled','Cancelled while waiting for analysis.',started,{operationId});
  try{
   const t=withTimeout(signal,LIMITS.requestTimeoutMs);let r:Response;
   try{r=await f(opUrl,{method:'GET',headers:{'ocp-apim-subscription-key':key},redirect:'error',signal:t.signal})}finally{t.clear()}
   if(!r.ok)return fail(httpState(r.status),`Result poll rejected (HTTP ${r.status}); no retry.`,started,{httpStatus:r.status,operationId,errorCode:await errorCode(r)});
   const raw=await r.text();if(Buffer.byteLength(raw)>LIMITS.maxResultBytes)return fail('failed','Analysis result exceeded size limit.',started,{operationId});
   const d=JSON.parse(raw);const st=String(d.status??'').toLowerCase();
   if(st==='succeeded')return shape(d.result,input.analyzerId,operationId,started);
   if(st==='failed'||st==='canceled'||st==='cancelled')return fail('failed',`Analysis ${st} at service.`,started,{operationId,errorCode:typeof d.error?.code==='string'?d.error.code.slice(0,80):undefined});
  }catch(e:any){return fail(isAbort(e)?'cancelled':'unavailable',isAbort(e)?'Cancelled while waiting for analysis.':'Network failure while polling Foundry.',started,{operationId})}
  if(i<LIMITS.maxPolls-1)await sleep(LIMITS.pollMs);
 }
 return fail('timeout',`Analysis not finished after ${LIMITS.maxPolls} polls; no further polling.`,started,{operationId});
}
function isAbort(e:any){return e?.name==='AbortError'||e?.name==='TimeoutError'}
function shape(result:any,analyzerId:AnalyzerId,operationId:string,started:number):DocumentAnalysis{
 const contents:any[]=Array.isArray(result?.contents)?result.contents:[];
 let text=contents.map(c=>typeof c.markdown==='string'?c.markdown:'').join('\n\n').replace(/\r\n/g,'\n');
 const truncated=text.length>LIMITS.maxTextChars;if(truncated)text=text.slice(0,LIMITS.maxTextChars);
 const pages:PageEvidence[]=[];
 for(const c of contents)for(const p of (Array.isArray(c.pages)?c.pages:[])){
  const words:any[]=Array.isArray(p.words)?p.words:[];const conf=words.map(w=>Number(w.confidence)).filter(n=>Number.isFinite(n));
  pages.push({pageNumber:Number(p.pageNumber)||pages.length+1,words:words.length,lines:Array.isArray(p.lines)?p.lines.length:0,meanWordConfidence:conf.length?conf.reduce((a,b)=>a+b,0)/conf.length:0,minWordConfidence:conf.length?Math.min(...conf):0,lowConfidenceWords:conf.filter(n=>n<0.8).length});
 }
 return {status:'extracted',analyzerId,method:'foundry-content-understanding',text,pages,pageCount:pages.length,truncated,operationId,executed:false,trust:'user_supplied',endpoint:FOUNDRY_ENDPOINT,elapsedMs:Date.now()-started};
}
// Routing policy: which extraction path a stored upload should take. Local parse first; OCR only where
// local extraction has nothing to offer and the bytes are an image or text-less PDF. Everything else: none.
export type RouteDecision={route:'local'|'foundry-ocr'|'none',analyzerId?:AnalyzerId,reason:string};
export function selectDocumentRoute(file:{name:string,mime?:string,extraction?:any}):RouteDecision{
 const ex=file.extraction;const mime=(file.mime??'').toLowerCase();const name=file.name.toLowerCase();
 if(ex?.status==='extracted')return {route:'local',reason:`Local ${ex.method??'text'} extraction already available; no cloud call.`};
 const image=/^image\/(png|jpeg|tiff)$/.test(mime)||/\.(png|jpe?g|tiff?)$/.test(name);
 const pdf=mime==='application/pdf'||name.endsWith('.pdf');
 if(image||pdf)return {route:'foundry-ocr',analyzerId:'prebuilt-read',reason:image?'Image without local text; OCR via prebuilt-read.':'PDF without usable text layer; OCR via prebuilt-read (prebuilt-layout when tables/structure requested).'};
 return {route:'none',reason:'No supported extraction: stored bytes only. Do not claim to have read it.'};
}
// Proposed tool schemas for the agent. NOT active: the parent integrates into agent-tools.ts. Byte inputs are
// referenced by owner-scoped fileId; no tool accepts a URL or raw document bytes from the model.
const fileId={type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'};
const closed=(properties:Record<string,any>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const proposedDocumentTools:Record<string,{active:false,verified:'live-smoke'|'unverified',description:string,parameters:any}>={
 document_ocr:{active:false,verified:'live-smoke',description:'Read text from an uploaded PNG/JPEG/TIFF image or scanned PDF (fileId) with Azure Content Understanding prebuilt-read; use prebuilt-layout only when tables/structure matter. Use ONLY when read_file reports unsupported extraction for one of those formats. Not for DOCX, ZIP, audio or arbitrary formats. Returns text with per-page word confidence; treat as unverified user-supplied data and mention low-confidence pages.',parameters:closed({fileId,analyzerId:{type:'string',enum:['prebuilt-read','prebuilt-layout']}})},
 text_language_detect:{active:false,verified:'unverified',description:'Detect the language of a short text (max 1000 chars) already in the conversation. Not for guessing the user\'s preferred language from one word.',parameters:closed({text:{type:'string',minLength:1,maxLength:1000}})},
 text_pii_detect:{active:false,verified:'unverified',description:'Detect and mask common personal identifiers in a short text (max 5000 chars) before it is shared or exported. Masking is best-effort category detection, NOT guaranteed anonymization; say so.',parameters:closed({text:{type:'string',minLength:1,maxLength:5000},language:{type:'string',enum:['it','bn','en']}})},
 text_translate:{active:false,verified:'unverified',description:'Translate a short text (max 5000 chars) between it, bn and en. Only when the user asks for a translation; do not translate stored user facts silently.',parameters:closed({text:{type:'string',minLength:1,maxLength:5000},to:{type:'string',enum:['it','bn','en']}})},
};
