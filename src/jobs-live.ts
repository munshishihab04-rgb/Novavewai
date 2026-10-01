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
export function discoveryQuery(occupation:string,city:string){if(!validJobTerm(occupation)||city&&!validJobTerm(city,80))throw Error('jobs_invalid_search');return `offerte lavoro ${occupation} ${city||'remoto'} annuncio singolo (pagina della singola offerta, non indice)${/cameriere|cuoco|ristorazione|barista|lavapiatti|pizzaiolo/.test(occupation)?' su lavoroturismo.it, restworld.it, jobintourism.it o job.hnh.it':' su bacheche lavoro e siti aziendali originali'}`;}
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
export async function verifiedJobPages(leads:JobLead[],query:{occupation:string;city:string;noAgencies:boolean;generic?:boolean;remote?:boolean},signal:AbortSignal,fetcher:typeof fetch=fetch,policy:{authorizedOrigins:readonly string[]}={authorizedOrigins:[]}){
 const opportunities:LiveOpportunity[]=[];const unavailable:LivePageStatus[]=[];let skipped=0,excludedNonDirect=0;
 const seen=new Set<string>();
 const accepted=leads.filter(l=>{if(!l||typeof l.url!=='string'||typeof l.title!=='string'||seen.has(l.url))return false;seen.add(l.url);return true}).map(l=>({lead:l,r:resolveSource(l.url)})).filter(x=>{if(!x.r){skipped++;return false}return true}).slice(0,MAX_LEADS);
 const cityRe=new RegExp(`\\b${query.city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i');
 for(const {lead,r} of accepted){const {source,url:u}=r!;const observedAt=new Date().toISOString();
  if(query.generic&&!policy.authorizedOrigins.includes(source.origin)){unavailable.push({url:u.href,title:lead.title,status:'UNAVAILABLE',reason:'automated page access not authorized for this source',observedAt});continue;}
  signal.throwIfAborted();let res:Response;let body:string;
  try{res=await fetcher(u,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(PAGE_TIMEOUT)]),headers:{accept:'text/html'}});body=await res.text();}
  catch(e){unavailable.push({url:u.href,title:lead.title,status:'UNAVAILABLE',reason:String(e instanceof Error?e.message:e).slice(0,120),observedAt});continue}
  if(res.status>=300&&res.status<400){unavailable.push({url:u.href,title:lead.title,status:'REDIRECTED',reason:`http ${res.status}; redirect not followed`,observedAt});continue}
  const text=clean(body.slice(0,MAX_BODY+1));
  if(res.status===404&&/not longer published|no longer published|non (?:è )?più (?:attiva|disponibile|pubblicata)/i.test(text)){unavailable.push({url:u.href,title:lead.title,status:'EXPIRED',reason:'source reports vacancy no longer published',observedAt});continue}
  if(!res.ok||body.length>MAX_BODY){unavailable.push({url:u.href,title:lead.title,status:'UNAVAILABLE',reason:!res.ok?`http ${res.status}`:'body over 1MB',observedAt});continue}
  const title=clean(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??lead.title).slice(0,160);
  if(/job offer expired|offerta (?:non (?:è )?più attiva|è scaduta|scaduta)|candidature .{0,40}chiuse|no longer active|not longer published/i.test(text)){unavailable.push({url:u.href,title,status:'EXPIRED',reason:'expired notice in listing body',observedAt});continue}
  if(!roleMatch(query.generic?title:text,query.occupation)||(query.generic&&query.occupation==='cameriere'&&/ai piani/i.test(title))){unavailable.push({url:u.href,title,status:'MISMATCH',reason:'role not found in listing body',observedAt});continue}
  const observedLocation=locationNear(text);
  if(query.generic&&(!query.city?(!query.remote||!/remoto|remote|da casa/i.test(text)):!observedLocation)||!cityRe.test(text)||(observedLocation&&!cityRe.test(observedLocation))){unavailable.push({url:u.href,title,status:'MISMATCH',reason:`city ${query.city} not the observed location`,observedAt,observedLocation});continue}
  const pub=publishedDate(text);
  if(pub.iso){const age=(Date.parse(observedAt)-Date.parse(pub.iso))/86400000;if(pub.iso.startsWith('1970')||(!query.generic&&age>MAX_AGE_DAYS)||age<-1){unavailable.push({url:u.href,title,status:'STALE_DATE',reason:`published ${pub.iso} (${pub.iso.startsWith('1970')?'epoch placeholder':`older than ${MAX_AGE_DAYS} days`})`,observedAt,observedLocation});continue}}
  // Publisher: employer ATS pages are direct by construction of the registry entry; on boards the
  // host's own agency footer does not describe the listing's publisher, so look at the listing head only.
  const head=text.slice(0,1500);const agencyInHead=/agenzia per il lavoro|aut\.? min\.? prot|adecco|lavoropi[uù]|randstad|manpower|gi group|synergie|openjob|umana|etjca/i.test(head);
  const publisher:LiveOpportunity['publisher_type']=source.sourceType==='DIRECT_EMPLOYER'?'DIRECT_EMPLOYER':agencyInHead||(source.hostOperatorIsAgency&&/adecco|lavoropi/i.test(source.name))?'STAFFING_AGENCY':'UNKNOWN';
  if(query.noAgencies&&publisher!=='DIRECT_EMPLOYER'){excludedNonDirect++;continue}
  const company=head.match(/<\/h1>/)?null:(head.match(new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+([A-Z][A-Z0-9&' .-]{2,60}?)\\s+(?:Pubblicat|Sede|Data|Luogo)`,'i'))?.[1]??null);
  const claim=`${title}; role matched; location "${observedLocation??query.city}"; ${pub.raw??'no publication date found'}; host ${source.name}`.slice(0,500);
  opportunities.push({opportunity_kind:'VACANCY',title,city:query.city,source_url:u.href,source_type:source.sourceType,publisher_type:publisher,verification_status:pub.iso&&!query.generic?'VERIFIED':'PARTIALLY_VERIFIED',discovered_at:observedAt,last_verified_at:observedAt,status:'OBSERVED',publishedAt:pub.iso??undefined,company:company??undefined,sourceName:source.name,evidence:[{url:u.href,observed_at:observedAt,claim}]});
 }
 return {opportunities,unavailable,skipped,excludedNonDirect,fetchedAt:new Date().toISOString(),testedScope:{leads:accepted.length,allowedOrigins:JOB_SOURCE_REGISTRY.map(s=>s.origin)}};
}
import {jobIntent} from './jobs.ts';
import {normalizeJobText,validJobTerm,cityFromText,occupationFromText,explicitRemote,strictEmployerPreference} from './jobs-input.ts';
export function resolveCurrentJobRequest(turns:string[],model:{query:string;city:string}){
 let city='',query='',remote=false,withdrawn=false;
 for(const raw of turns){
  const t=normalizeJobText(raw);
  if(/\b(?:non|no|senza)\s+(?:da\s+)?(?:remoto|remote|smart working)/i.test(t))remote=false;
  else if(explicitRemote(t))remote=true;
  else if(/^(?:cerco|trova|vorrei|voglio|sto cercando|looking for)\b/i.test(t))remote=false;
  if(/^(?:grazie|ciao|thanks|thank you|parliamo|scrivi|spiegami|crea)\b/i.test(t)){query='';city='';withdrawn=true;continue;}
  if(/[:;<>=@\\\[\]{}|&%\r\n]/.test(raw)&&!/^citt[àa]:/i.test(raw)){query='';city='';withdrawn=true;continue;}
  if(/^(?:non cerco|non voglio|stop|annulla|cancel|basta)\b/i.test(t)){query='';city='';withdrawn=true;continue;}
  const positive=t.split(/[,;]\s*/).filter(x=>!/^non\b/i.test(x)).join(' ');
  const proposal=normalizeJobText(model.city);
  const suffix=validJobTerm(proposal,80)&&positive.toLowerCase().endsWith(' '+proposal.toLowerCase())&&occupationFromText(positive,proposal);
  const ambiguous=/\s+(?:a|in)\s+.+\s+(?:o|oppure|or)\s+/i.test(positive);
  const explicit=ambiguous?undefined:cityFromText(positive)??(suffix?proposal:undefined);
  if(ambiguous){city='';continue;}
  if(/^(?:cerco|trova|vorrei|voglio|sto cercando|looking for)\b/i.test(t)&&!wantsMoreOffers(t))city='';
  if(/^non\s+(?:a|in)\b/i.test(t))city='';
  if(explicit)city=explicit;
  else if(!/\b(?:ora|invece|non|anche)\b/i.test(t)){
   const intent=jobIntent({query:t,city:''});if(intent.city)city=intent.city;
   // Bare-city clarification only when a prior occupation is pending. Model city
   // must equal this entire user turn, not merely occur somewhere in the history.
   else if(query&&validJobTerm(t,80)&&normalizeJobText(model.city).toLowerCase()===t.toLowerCase())city=t[0].toUpperCase()+t.slice(1);
  }
  if(explicit||!/^(?:ora|invece|non|anche|con agenzie|agenzie)\b/i.test(t)){
   const candidate=occupationFromText(positive,explicit??city);
   // Follow-up turns (preference answers, confirmations, "show more", city-only replies with filler) are not occupations.
   if(candidate&&!followUpTurn(candidate)&&!(query&&nonItalianSentence(candidate))&&candidate.toLowerCase()!==city.toLowerCase()&&candidate.toLowerCase()!==normalizeJobText(model.city).toLowerCase()){query=candidate;if(!nonItalianSentence(candidate))withdrawn=false;}
  }
  if(explicitRemote(t)&&query&&!explicit)city='';
 // Users write in Bangla/Banglish/English/mixed: when no user turn yields an Italian occupation word, accept the
 // model's proposed occupation as the search hypothesis — bounded (≤3 words, validated term, no URL/qualification
 // prose) and only if an Italian occupation word in the user's own turns did not already win. The city still MUST come
 // from the user (never from the model), so this cannot invent a location; it only stops Subito being searched for
 // the raw sentence "amr kaj lagbe".
  if(/\b(?:https?|javascript|site):|www\./i.test(raw))withdrawn=true;
 }
 if(!withdrawn&&(!query||nonItalianSentence(query))){const proposed=proposedOccupation(model.query);if(proposed)query=proposed;else if(query&&nonItalianSentence(query))query='';}
 // Remote intent remains in the grounded query so the service can waive location.
 return {query:query+(remote?' remoto':''),city,noAgencies:strictEmployerPreference(turns)};
}
// Explicit request for more results of the SAME search (Italian, Banglish, Bangla, English). This is the only trigger
// for Subito pagination (owner decision B); a new role or a bare city is not "more".
export function wantsMoreOffers(raw:string){const t=normalizeJobText(raw).toLowerCase();
 if(/[\u0980-\u09FF]/.test(t))return /আর[ওো]|আরো|বেশি|অন্য/.test(t);
 if(/^(?:cerco|trova|voglio lavorare|vorrei lavorare|sto cercando)\b/.test(t))return false;
 const words=t.split(/[^\p{L}]+/u).filter(Boolean);const has=(...ws:string[])=>ws.some(w=>words.includes(w));
 if(/(?:^|\s)(?:altre?\s+(?:offerte|annunci|proposte|opzioni|risultati)|altri\s+(?:annunci|lavori|risultati)|ce ne sono altr[ei]|di\s+pi[uù]|pi[uù]\s+(?:offerte|annunci)|mostra(?:mene|ne)?\s+(?:altre|altri|di\s+pi[uù])|show\s+(?:me\s+)?more|more\s+(?:offers|jobs|results)|anything else)(?:\s|$|[?!.,;])/.test(t))return true;
 if(words.length<=4&&has('ancora','more','aro','arô'))return true;
 return false}
const FOLLOW_UP=/^(?:s[iì]+|ok(?:ay)?|va bene|certo|esatto|perfetto|grazie|no|yes|sure|ha|hae|hmm|aro|aro offer dekhaw|dekhaw|ekta|part[ -]?time|full[ -]?time|tempo pieno|tempo parziale|mattina|sera|notte|weekend|subito|anche|altro|altri|di più|more|show more|ancora)$/i;
// Bangla script, or a Banglish sentence (romanised Bengali function words / verbs). Such a phrase is a request, not a role.
const BANGLISH=new Set(['ami','amar','amr','amake','tumi','apni','apnar','kaj','kaaj','chai','lagbe','korte','kori','korbo','khuje','khujo','deo','dao','dekhao','dekhaw','dekhte','ekta','hisebe','hishebe','jonno','kemon','ache','hobe','bolo','kotha','aro','onek','valo','bhalo','kichu','pari','parbo','theke','jabo','jete','khujchi','khujtesi','dorkar','sahajjo','koro','korun']);
export function nonItalianSentence(t:string){if(/[\u0980-\u09FF]/.test(t))return true;const words=t.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);const hits=words.filter(w=>BANGLISH.has(w)).length;return hits>=1&&(hits>=2||words.length<=3)}
function followUpTurn(candidate:string){const c=candidate.toLowerCase().trim();if(FOLLOW_UP.test(c)||wantsMoreOffers(c))return true;// "<City> te/e/theke …" Banglish locative around a known city name
 if(/\b(?:te|e|theke|tei|y)$/.test(c)&&c.split(' ').length<=3&&cityFromText('a '+c.replace(/\s+(?:te|e|theke|tei|y)$/,'')))return true;return false}
function proposedOccupation(raw:string):string|undefined{const q=normalizeJobText(raw||'').toLowerCase().replace(/\s+(?:part[ -]?time|full[ -]?time|remoto|remote)\b.*$/,'').trim();
 if(!q||q.split(' ').length>3||!validJobTerm(q,60))return undefined;if(/\b(?:lavoro|lavori|job|jobs|kaj|work|offerte|cerco|certificat\w*|patente|esperienza)\b/i.test(q))return undefined;
 const occ=occupationFromText(q);return occ&&occ.split(' ').length<=3?occ:undefined}
