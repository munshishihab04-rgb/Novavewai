import type {Opportunity} from './jobs-discovery.ts';
export type JobLead={title:string;url:string};
export type LivePageStatus={url:string;title:string;status:'EXPIRED'|'UNAVAILABLE'|'MISMATCH'|'REDIRECTED'|'STALE_DATE';reason:string;observedAt:string;observedLocation?:string|null};
export type LiveOpportunity=Opportunity&{publishedAt?:string;company?:string;sourceName:string};
// Fixed, human-reviewed public origins. Public HTML on them is untrusted data; the model never
// chooses arbitrary URLs — leads are filtered against this registry before any I/O.
// sourceType describes the HOSTING page kind, not the publisher of a given listing.
export type JobSource={origin:string;name:string;sourceType:'JOB_BOARD'|'DIRECT_EMPLOYER';detail:RegExp;robots:string;reviewedAt:string;hostOperatorIsAgency?:boolean};
export const JOB_SOURCE_REGISTRY:readonly JobSource[]=[
 {origin:'https://www.lavoroturismo.it',name:'LavoroTurismo',sourceType:'JOB_BOARD',detail:/^\/offerte-lavoro\/offerta-[a-z0-9-]+$/,robots:'Disallow: /*?* — detail paths without query string permitted; sitemap-offers.xml lists listings',reviewedAt:'2026-09-30',hostOperatorIsAgency:true},
 {origin:'https://www.restworld.it',name:'Restworld',sourceType:'JOB_BOARD',detail:/^\/posizione\/[a-z0-9_-]+$/,robots:'Allow: / except /api/,/_next/,/admin/,/showcase,/lp/,legal pages',reviewedAt:'2026-09-30'},
 {origin:'https://www.jobintourism.it',name:'Job in Tourism',sourceType:'JOB_BOARD',detail:/^\/offerta\/[a-z0-9-]+\/?$/,robots:'Allow: / except wp-admin/wp-login/wp-includes/uploads',reviewedAt:'2026-09-30'},
 {origin:'https://job.hnh.it',name:'HNH Hospitality (employer ATS)',sourceType:'DIRECT_EMPLOYER',detail:/^\/jobs\/[A-Za-z0-9._-]+\.htm$/,robots:'User-agent: * Allow: *',reviewedAt:'2026-09-30'},
 {origin:'https://www.adecco.com',name:'Adecco',sourceType:'JOB_BOARD',detail:/^\/it-it\/cerca-lavoro\/[a-z0-9-]+\/[a-f0-9-]+$/,robots:'not re-reviewed; retained from jobs-live-delivery-1',reviewedAt:'2026-09-30',hostOperatorIsAgency:true},
 {origin:'https://www.lavoropiu.it',name:'Lavoropiù',sourceType:'JOB_BOARD',detail:/^\/offerta\/[a-z0-9-]+$/,robots:'not re-reviewed; retained from jobs-live-delivery-1',reviewedAt:'2026-09-30',hostOperatorIsAgency:true},
];
const MAX_LEADS=6,MAX_BODY=2_500_000,PAGE_TIMEOUT=10_000,MAX_AGE_DAYS=60; // SSR boards (LavoroTurismo) exceed 1MB before the listing body; observed 1.57MB on 2026-09-30.
const clean=(s:string)=>s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#x27;|&#039;|&rsquo;/gi,"'").replace(/\s+/g,' ').trim();
const roleMatch=(text:string,role:string)=>role==='cameriere'?/camerier|commis di sala|chef de rang|addett[oa] (?:alla )?sala/i.test(text):new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(text);
export function resolveSource(raw:string):{source:JobSource;url:URL}|null{
 let u:URL;try{u=new URL(raw)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
 const source=JOB_SOURCE_REGISTRY.find(s=>s.origin===u.origin);
 if(!source||!source.detail.test(u.pathname))return null;
 return {source,url:u};
}
// Discovery query for the managed web search: role + city + reviewed sources; no user prose.
// Natural phrasing: strict site: operators returned zero citations from the managed search (live replay 2026-09-30).
export function discoveryQuery(occupation:string,city:string){return `offerte lavoro ${occupation} ${city} annuncio singolo (pagina della singola offerta, non indice) su lavoroturismo.it, restworld.it, jobintourism.it o job.hnh.it`;}
function publishedDate(text:string):{iso:string|null;raw:string|null}{
 const m=text.match(/(?:pubblicat[oa] il|data pubblicazione|pubblicata il|published)\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
 if(!m)return {iso:null,raw:null};const [_,d,mo,y]=m;const iso=`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;return {iso,raw:m[0]};
}
function locationNear(text:string):string|null{
 const m=text.match(/(?:luogo di lavoro|sede|località|location)\s*:?\s*([A-ZÀ-Ý][\wÀ-ÿ' ]{2,40}?)(?:,| Italia| Tipologia| Data| Full| Part|$)/i);
 if(m)return m[1].trim();
 // Restworld card style: "Ristorante X  Monte San Pietro  Full time"
 const r=text.match(/\b([A-Z][\wÀ-ÿ']+(?: [A-Z][\wÀ-ÿ']+){0,3})\s+(?:Full|Part)[ -]time/);
 return r?r[1].trim():null;
}
export async function verifiedJobPages(leads:JobLead[],query:{occupation:string;city:string;noAgencies:boolean},signal:AbortSignal,fetcher:typeof fetch=fetch){
 const opportunities:LiveOpportunity[]=[];const unavailable:LivePageStatus[]=[];let skipped=0,excludedNonDirect=0;
 const accepted=leads.map(l=>({lead:l,r:resolveSource(l.url)})).filter(x=>{if(!x.r){skipped++;return false}return true}).slice(0,MAX_LEADS);
 const cityRe=new RegExp(`\\b${query.city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
 for(const {lead,r} of accepted){const {source,url:u}=r!;const observedAt=new Date().toISOString();
  let res:Response;let body:string;
  try{res=await fetcher(u,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(PAGE_TIMEOUT)]),headers:{accept:'text/html'}});body=await res.text();}
  catch(e){unavailable.push({url:u.href,title:lead.title,status:'UNAVAILABLE',reason:String(e instanceof Error?e.message:e).slice(0,120),observedAt});continue}
  if(res.status>=300&&res.status<400){unavailable.push({url:u.href,title:lead.title,status:'REDIRECTED',reason:`http ${res.status}; redirect not followed`,observedAt});continue}
  const text=clean(body.slice(0,MAX_BODY+1));
  if(res.status===404&&/not longer published|no longer published|non (?:è )?più (?:attiva|disponibile|pubblicata)/i.test(text)){unavailable.push({url:u.href,title:lead.title,status:'EXPIRED',reason:'source reports vacancy no longer published',observedAt});continue}
  if(!res.ok||body.length>MAX_BODY){unavailable.push({url:u.href,title:lead.title,status:'UNAVAILABLE',reason:!res.ok?`http ${res.status}`:'body over 1MB',observedAt});continue}
  const title=clean(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??lead.title).slice(0,160);
  if(/job offer expired|offerta (?:non (?:è )?più attiva|è scaduta|scaduta)|candidature .{0,40}chiuse|no longer active|not longer published/i.test(text)){unavailable.push({url:u.href,title,status:'EXPIRED',reason:'expired notice in listing body',observedAt});continue}
  if(!roleMatch(text,query.occupation)){unavailable.push({url:u.href,title,status:'MISMATCH',reason:'role not found in listing body',observedAt});continue}
  const observedLocation=locationNear(text);
  if(!cityRe.test(text)||(observedLocation&&!cityRe.test(observedLocation))){unavailable.push({url:u.href,title,status:'MISMATCH',reason:`city ${query.city} not the observed location`,observedAt,observedLocation});continue}
  const pub=publishedDate(text);
  if(pub.iso){const age=(Date.parse(observedAt)-Date.parse(pub.iso))/86400000;if(pub.iso.startsWith('1970')||age>MAX_AGE_DAYS||age<-1){unavailable.push({url:u.href,title,status:'STALE_DATE',reason:`published ${pub.iso} (${pub.iso.startsWith('1970')?'epoch placeholder':`older than ${MAX_AGE_DAYS} days`})`,observedAt,observedLocation});continue}}
  // Publisher: employer ATS pages are direct by construction of the registry entry; on boards the
  // host's own agency footer does not describe the listing's publisher, so look at the listing head only.
  const head=text.slice(0,1500);const agencyInHead=/agenzia per il lavoro|aut\.? min\.? prot|adecco|lavoropi[uù]|randstad|manpower|gi group|synergie|openjob|umana|etjca/i.test(head);
  const publisher:LiveOpportunity['publisher_type']=source.sourceType==='DIRECT_EMPLOYER'?'DIRECT_EMPLOYER':agencyInHead||(source.hostOperatorIsAgency&&/adecco|lavoropi/i.test(source.name))?'STAFFING_AGENCY':'UNKNOWN';
  if(query.noAgencies&&publisher!=='DIRECT_EMPLOYER'){excludedNonDirect++;continue}
  const company=head.match(/<\/h1>/)?null:(head.match(new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+([A-Z][A-Z0-9&' .-]{2,60}?)\\s+(?:Pubblicat|Sede|Data|Luogo)`,'i'))?.[1]??null);
  const claim=`${title}; role matched; location "${observedLocation??query.city}"; ${pub.raw??'no publication date found'}; host ${source.name}`.slice(0,500);
  opportunities.push({opportunity_kind:'VACANCY',title,city:query.city,source_url:u.href,source_type:source.sourceType,publisher_type:publisher,verification_status:pub.iso?'VERIFIED':'PARTIALLY_VERIFIED',discovered_at:observedAt,last_verified_at:observedAt,status:'OBSERVED',publishedAt:pub.iso??undefined,company:company??undefined,sourceName:source.name,evidence:[{url:u.href,observed_at:observedAt,claim}]});
 }
 return {opportunities,unavailable,skipped,excludedNonDirect,fetchedAt:new Date().toISOString(),testedScope:{leads:accepted.length,allowedOrigins:JOB_SOURCE_REGISTRY.map(s=>s.origin)}};
}
const CITIES='Bologna|Milano|Roma|Napoli|Torino|Firenze|Genova|Palermo|Bari|Verona|Padova|Venezia|Parma';
export function resolveCurrentJobRequest(turns:string[],model:{query:string;city:string}){
 const latest=turns.at(-1)??'';const mentioned=latest.match(new RegExp(`\\b(${CITIES})\\b`,'gi'))??[];const history=[...turns].reverse().flatMap(x=>x.match(new RegExp(`\\b(${CITIES})\\b`,'gi'))??[]);const correction=latest.match(new RegExp(`(?:ora|invece|sposta(?:ti)?|cerca)\\s+(?:a\\s+)?(${CITIES})\\b`,'i'))?.[1];const city=correction??mentioned[0]??history[0]??'';
 let noAgencies=turns.some(x=>/senza agenzie|niente agenzie|no agenc|only direct|solo aziende|senza intermediari|solo datori diretti|direct employers only/i.test(x));if(/anche agenzie|con agenzie|agenzie (?:vanno )?bene/i.test(latest))noAgencies=false;
 return {query:model.query,city:city?city[0].toUpperCase()+city.slice(1).toLowerCase():'',noAgencies};
}
