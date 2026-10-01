// Bounded reads of permitted job-listing pages and schema.org JobPosting JSON-LD extraction.
// Page bytes are untrusted data: only structured fields are copied, sanitized and bounded; no text
// from the page is ever passed to the model as instructions.
import {isIP} from 'node:net';
import {JOB_BOT_USER_AGENT,OriginPermissionGate,type PermissionDecision} from './jobs-permission.ts';
export const POSTING_MAX_BYTES=1_500_000,POSTING_TIMEOUT_MS=10_000,POSTING_MAX_PAGES=6;
export type JobPostingRecord={title:string;hiringOrganization:string|null;locality:string|null;region:string|null;country:string|null;datePosted:string|null;validThrough:string|null;employmentType:string|null;directApply:boolean|null;validity:'CURRENT'|'EXPIRED'|'UNKNOWN'};
export type PostingRead={url:string;permission:PermissionDecision;outcome:'JSONLD_VERIFIED'|'NO_JSONLD'|'NOT_PERMITTED'|'UNAVAILABLE'|'REDIRECTED'|'BLOCKED';reason:string;observedAt:string;posting?:JobPostingRecord};
const strip=(v:unknown,max:number)=>typeof v==='string'?v.replace(/(?:\+?\d[\d\s().-]{7,}\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[omesso]').replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||null:null;
const text=(v:unknown,max=160):string|null=>{if(typeof v==='string')return strip(v,max);if(Array.isArray(v))return text(v[0],max);if(v&&typeof v==='object'){const o=v as Record<string,unknown>;return text(o.name??o['@value'],max)}return null};
const isoDate=(v:unknown):string|null=>{if(typeof v!=='string')return null;const s=v.trim().slice(0,40);const t=Date.parse(s);if(!Number.isFinite(t))return null;const y=new Date(t).getUTCFullYear();return y<2000||y>2100?null:new Date(t).toISOString()};
const types=(node:Record<string,unknown>)=>{const t=node['@type'];return (Array.isArray(t)?t:[t]).filter((x):x is string=>typeof x==='string').map(x=>x.replace(/^.*[\/#:]/,'').toLowerCase())};
function* nodes(value:unknown,depth=0):Generator<Record<string,unknown>>{
 if(depth>6||!value||typeof value!=='object')return;
 if(Array.isArray(value)){for(const v of value.slice(0,50))yield* nodes(v,depth+1);return}
 const node=value as Record<string,unknown>;yield node;
 if(Array.isArray(node['@graph']))yield* nodes(node['@graph'],depth+1);
 if(node.mainEntity)yield* nodes(node.mainEntity,depth+1);
}
export function publicHttpsUrl(raw:string):URL|null{
 let u:URL;try{u=new URL(raw)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 const h=u.hostname.toLowerCase().replace(/\.$/,'');
 if(isIP(h.replace(/^\[|\]$/g,''))||h==='localhost'||!h.includes('.')||/\.(?:local|internal|localhost|home|lan)$/.test(h))return null;
 return u;
}
// Detail-shaped: a listing page has a path beyond the root/section and is not a keyword search.
export function looksLikeDetailPage(u:URL){const p=u.pathname.replace(/\/$/,'');return !u.searchParams.has('q')&&!u.searchParams.has('query')&&!u.searchParams.has('search')&&p.split('/').filter(Boolean).length>=2&&/\d|[a-z0-9]{6,}-[a-z0-9]/.test(p)}
export function extractJobPosting(html:string,now=Date.now()):JobPostingRecord|null{
 const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)].slice(0,30);
 for(const m of scripts){
  let parsed:unknown;try{parsed=JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g,'').trim())}catch{continue}
  for(const node of nodes(parsed)){
   if(!types(node).includes('jobposting'))continue;
   const title=text(node.title,160);if(!title)continue;
   const org=node.hiringOrganization as Record<string,unknown>|string|undefined;
   const first=(v:unknown)=>Array.isArray(v)?v[0]:v;
   const loc=first(node.jobLocation) as Record<string,unknown>|undefined;
   // Both jobLocation and address may be arrays (public employment service Emilia-Romagna, observed 2026-09-30).
   const address=(loc&&typeof loc==='object'?(typeof first(loc.address)==='object'&&first(loc.address)?first(loc.address):loc):undefined) as Record<string,unknown>|undefined;
   const datePosted=isoDate(node.datePosted),validThrough=isoDate(node.validThrough);
   const employment=node.employmentType;const employmentType=Array.isArray(employment)?employment.filter(x=>typeof x==='string').slice(0,3).join(', ')||null:text(typeof employment==='string'?employment.replace(/^\[|\]$/g,''):employment,60);
   return {title,hiringOrganization:text(org,120),locality:text(address?.addressLocality,80),region:text(address?.addressRegion,80),country:text(address?.addressCountry,40),datePosted,validThrough,employmentType,directApply:typeof node.directApply==='boolean'?node.directApply:node.directApply==='true'?true:node.directApply==='false'?false:null,validity:validThrough?Date.parse(validThrough)<now?'EXPIRED':'CURRENT':'UNKNOWN'};
  }
 }
 return null;
}
// Italian province codes → capoluogo, so an addressRegion "BO" next to a comune like Castel Maggiore
// is honestly classified as province of Bologna rather than the requested city.
export const PROVINCE_CODES:Record<string,string>={AG:'Agrigento',AL:'Alessandria',AN:'Ancona',AO:'Aosta',AR:'Arezzo',AP:'Ascoli Piceno',AT:'Asti',AV:'Avellino',BA:'Bari',BT:'Barletta',BL:'Belluno',BN:'Benevento',BG:'Bergamo',BI:'Biella',BO:'Bologna',BZ:'Bolzano',BS:'Brescia',BR:'Brindisi',CA:'Cagliari',CL:'Caltanissetta',CB:'Campobasso',CE:'Caserta',CT:'Catania',CZ:'Catanzaro',CH:'Chieti',CO:'Como',CS:'Cosenza',CR:'Cremona',KR:'Crotone',CN:'Cuneo',EN:'Enna',FM:'Fermo',FE:'Ferrara',FI:'Firenze',FG:'Foggia',FC:'Forlì',FR:'Frosinone',GE:'Genova',GO:'Gorizia',GR:'Grosseto',IM:'Imperia',IS:'Isernia',SP:'La Spezia',AQ:"L'Aquila",LT:'Latina',LE:'Lecce',LC:'Lecco',LI:'Livorno',LO:'Lodi',LU:'Lucca',MC:'Macerata',MN:'Mantova',MS:'Massa',MT:'Matera',ME:'Messina',MI:'Milano',MO:'Modena',MB:'Monza',NA:'Napoli',NO:'Novara',NU:'Nuoro',OR:'Oristano',PD:'Padova',PA:'Palermo',PR:'Parma',PV:'Pavia',PG:'Perugia',PU:'Pesaro',PE:'Pescara',PC:'Piacenza',PI:'Pisa',PT:'Pistoia',PN:'Pordenone',PZ:'Potenza',PO:'Prato',RG:'Ragusa',RA:'Ravenna',RC:'Reggio Calabria',RE:'Reggio Emilia',RI:'Rieti',RN:'Rimini',RM:'Roma',RO:'Rovigo',SA:'Salerno',SS:'Sassari',SV:'Savona',SI:'Siena',SR:'Siracusa',SO:'Sondrio',SU:'Sud Sardegna',TA:'Taranto',TE:'Teramo',TR:'Terni',TO:'Torino',TP:'Trapani',TN:'Trento',TV:'Treviso',TS:'Trieste',UD:'Udine',VA:'Varese',VE:'Venezia',VB:'Verbania',VC:'Vercelli',VR:'Verona',VV:'Vibo Valentia',VI:'Vicenza',VT:'Viterbo'};
// Requested city against the observed locality: exact comune → CITY; a different comune inside the
// requested city's province (addressRegion code/name or "provincia di") → PROVINCE_OR_REGION; else MISMATCH.
export function classifyLocation(requestedCity:string,posting:Pick<JobPostingRecord,'locality'|'region'>):'CITY'|'PROVINCE_OR_REGION'|'MISMATCH'|'UNKNOWN'{
 const norm=(s:string|null)=>(s??'').normalize('NFKC').toLowerCase().replace(/\s*\([a-z]{2}\)\s*$/,'').replace(/[^a-z0-9àèéìòù' ]/g,' ').replace(/\s+/g,' ').trim();
 const city=norm(requestedCity),loc=norm(posting.locality);
 const rawRegion=(posting.region??'').trim();const region=norm(/^[A-Za-z]{2}$/.test(rawRegion)?PROVINCE_CODES[rawRegion.toUpperCase()]??rawRegion:rawRegion);
 if(!city)return 'UNKNOWN';if(!loc&&!region)return 'UNKNOWN';
 if(loc===city)return 'CITY';
 if(loc&&new RegExp(`^(?:provincia di |prov\\.? |zona )${city}$|^${city} (?:provincia|e provincia|zona)$`).test(loc))return 'PROVINCE_OR_REGION';
 if(region===city||region===`provincia di ${city}`)return 'PROVINCE_OR_REGION';
 return loc?'MISMATCH':'UNKNOWN';
}
export class JobPostingReader{
 constructor(private options:{gate:OriginPermissionGate;fetcher?:typeof fetch;now?:()=>number;sleep?:(ms:number)=>Promise<void>;maxPages?:number}){}
 async read(urls:readonly string[],signal:AbortSignal,beforeIO?:()=>Promise<void>):Promise<PostingRead[]>{
  const out:PostingRead[]=[];const seen=new Set<string>();const fetcher=this.options.fetcher??fetch;const sleep=this.options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  const lastHit=new Map<string,number>();const max=this.options.maxPages??POSTING_MAX_PAGES;
  for(const raw of urls){
   if(out.length>=max)break;
   const u=publicHttpsUrl(raw);if(!u||seen.has(u.href))continue;seen.add(u.href);u.hash='';
   signal.throwIfAborted();
   const permission=await this.options.gate.check(u,signal);const observedAt=new Date(this.options.now?.()??Date.now()).toISOString();
   if(!permission.permitted){out.push({url:u.href,permission,outcome:'NOT_PERMITTED',reason:permission.reason,observedAt});continue}
   const wait=(lastHit.get(u.origin)??-Infinity)+permission.crawlDelayMs-(this.options.now?.()??Date.now());if(wait>0)await sleep(wait);
   if(beforeIO)await beforeIO();signal.throwIfAborted();
   lastHit.set(u.origin,this.options.now?.()??Date.now());
   let res:Response,body:string;
   try{res=await fetcher(u,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(POSTING_TIMEOUT_MS)]),headers:{'user-agent':JOB_BOT_USER_AGENT,accept:'text/html'}});
    const len=Number(res.headers.get('content-length'));if(Number.isFinite(len)&&len>POSTING_MAX_BYTES){out.push({url:u.href,permission,outcome:'UNAVAILABLE',reason:'body over size cap',observedAt});continue}
    body=await res.text()}
   catch(e){if(signal.aborted)throw e;out.push({url:u.href,permission,outcome:'UNAVAILABLE',reason:String(e instanceof Error?e.message:e).slice(0,120),observedAt});continue}
   if(res.status>=300&&res.status<400){out.push({url:u.href,permission,outcome:'REDIRECTED',reason:`http ${res.status}; redirect not followed`,observedAt});continue}
   if(res.status===401||res.status===403||res.status===429){out.push({url:u.href,permission,outcome:'BLOCKED',reason:`http ${res.status}: access restricted by source; not bypassed`,observedAt});continue}
   if(!res.ok){out.push({url:u.href,permission,outcome:'UNAVAILABLE',reason:`http ${res.status}`,observedAt});continue}
   if(body.length>POSTING_MAX_BYTES){out.push({url:u.href,permission,outcome:'UNAVAILABLE',reason:'body over size cap',observedAt});continue}
   const posting=extractJobPosting(body,this.options.now?.()??Date.now());
   if(!posting){out.push({url:u.href,permission,outcome:'NO_JSONLD',reason:'no schema.org JobPosting JSON-LD on page',observedAt});continue}
   out.push({url:u.href,permission,outcome:'JSONLD_VERIFIED',reason:'JobPosting JSON-LD extracted',observedAt,posting});
  }
  return out;
 }
}
