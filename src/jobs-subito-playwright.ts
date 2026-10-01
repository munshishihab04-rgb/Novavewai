// Subito.it on-demand adapter (Playwright, ordinary headless Chromium with JS, no stealth/proxy/login).
//
// OWNER POLICY (recorded 2026-09-30, verbatim from the product owner): "Subito MUST be implemented with
// Playwright, on-demand per user request (no daily mass collection). [...] The owner has accepted the
// ToS/robots-comment risk". The robots.txt comment (evidence/subito-claude-1/robots.txt) states:
// "It is expressively forbidden to use search robots or other automatic methods to access Subito.it.
// Only if Subito.it has given such permission can be accepted." This adapter therefore runs ONLY when the
// server-side flag NOVA_JOBS_SUBITO_AUTOMATED_ACCESS=owner-accepted is set; default absent = disabled and
// the national search link is returned as before. No /utente/, no contact clicks, no phone/email/description/photos stored.
//
// PAGINATION (owner decision B, 2026-10-01, docs/decisions/2026-10-01-subito-pagination.md, recorded in
// ~/.local/share/nova-community-trial/subito-pagination-decision.json): robots.txt carries machine directives
// `Disallow: */?o=*` / `*&o=*`. Hermes recommended NOT paginating; the owner knowingly chose bounded pagination.
// It runs ONLY when NOVA_JOBS_SUBITO_PAGINATION=owner-accepted AND the user explicitly asked for more offers
// (never on a first search), max SUBITO_MAX_PAGES list pages, >=2 s pause between pages. Default absent = page 1 only.
import {chromium,type Browser} from 'playwright';
import {JOB_CITIES} from './jobs.ts';
import {validJobTerm} from './jobs-input.ts';
import type {Opportunity} from './jobs-discovery.ts';
import {classifyLocation} from './jobs-posting.ts';
export const SUBITO_FLAG='NOVA_JOBS_SUBITO_AUTOMATED_ACCESS',SUBITO_FLAG_VALUE='owner-accepted',SUBITO_PAGINATION_FLAG='NOVA_JOBS_SUBITO_PAGINATION';
export const SUBITO_ORIGIN='https://www.subito.it';
export const SUBITO_CACHE_TTL_MS=6*3600_000,SUBITO_TOTAL_TIMEOUT_MS=25_000,SUBITO_MAX_CARDS=40,SUBITO_MAX_PAGES=3,SUBITO_PAGE_PAUSE_MS:[number,number]=[2000,3500];
export type SubitoCard={title:string;url:string;locality:string|null;provinceCode:string|null;publisherHint:'AZIENDA_VERIFICATA'|'AGENZIA'|'PRIVATO'|null};
export type SubitoObservation={listUrl:string;observedAt:string;cache:'hit'|'live';cards:SubitoCard[];blocked:string|null;navigations:number;pagesRead:number};
export type SubitoSearchOptions={pages?:number};
export type SubitoSearch=(occupation:string,city:string,signal:AbortSignal,beforeIO?:()=>Promise<void>,options?:SubitoSearchOptions)=>Promise<SubitoObservation>;
export function subitoAutomatedAccessAccepted(env:NodeJS.ProcessEnv=process.env){return env[SUBITO_FLAG]?.trim()===SUBITO_FLAG_VALUE}
export function subitoPaginationAccepted(env:NodeJS.ProcessEnv=process.env){return env[SUBITO_PAGINATION_FLAG]?.trim()===SUBITO_FLAG_VALUE}
const DETAIL_RE=/^https:\/\/www\.subito\.it\/offerte-lavoro\/[a-z0-9-]+-\d+\.htm$/;
export function subitoListUrl(occupation:string,city:string,origin=SUBITO_ORIGIN){
 if(!validJobTerm(occupation)||!validJobTerm(city,80))throw Error('jobs_invalid_search');
 const known=Object.entries(JOB_CITIES).find(([name])=>name.toLowerCase()===city.toLowerCase());
 // Proven path (evidence/subito-claude-1): province-level list, one segment; cards carry `Comune (XX)` so city vs province is classified from the card.
 if(known){const p=known[1];return `${origin}/annunci-${p.region}/vendita/offerte-lavoro/${p.province}/?q=${encodeURIComponent(occupation)}`}
 return `${origin}/annunci-italia/vendita/offerte-lavoro/?q=${encodeURIComponent(occupation+' '+city)}`;
}
// Runs inside the page. Only card metadata: title, .htm link, "Comune (XX)" locality, publisher badge.
const EXTRACT=`(() => {
 const out=[];const seen=new Set();
 for(const card of Array.from(document.querySelectorAll('article')).slice(0,80)){
  const a=Array.from(card.querySelectorAll('a[href$=".htm"]')).find(x=>/\\/offerte-lavoro\\/[a-z0-9-]+-\\d+\\.htm/.test(x.getAttribute('href')||''));if(!a)continue;
  let href;try{href=new URL(a.getAttribute('href'),location.href);href.search='';href.hash='';href=href.href}catch{continue}
  if(seen.has(href))continue;seen.add(href);
  const title=(card.querySelector('h3,h2')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,140);if(!title)continue;
  let locality=null,provinceCode=null;
  for(const span of Array.from(card.querySelectorAll('span,p'))){const t=(span.textContent||'').replace(/\\s+/g,' ').trim();const m=t.match(/^([A-Za-zÀ-ÿ'. -]{2,60}?)\\s*\\(([A-Z]{2})\\)$/);if(m){locality=m[1].trim();provinceCode=m[2];break}}
  const text=(card.textContent||'').replace(/\\s+/g,' ');
  const publisherHint=/azienda verificata/i.test(text)?'AZIENDA_VERIFICATA':/agenzia per il lavoro|\\b(?:adecco|randstad|manpower|gi group|lavoropi[uù]|synergie|openjob|umana|etjca|orienta|during|tempor|humangest|axl|maw)\\b/i.test(text)?'AGENZIA':/\\bprivato\\b/i.test(text)?'PRIVATO':null;
  out.push({title,url:href,locality,provinceCode,publisherHint});
 }
 return out;
})()`;
type Options={origin?:string;launch?:()=>Promise<Browser>;now?:()=>number;cacheTtlMs?:number;pauseMs?:[number,number];pagePauseMs?:[number,number];totalTimeoutMs?:number;pagination?:boolean};
let globalActive=false; // one Subito browser at a time across the whole process
export function createSubitoSearch(options:Options={}):SubitoSearch{
 const origin=options.origin??SUBITO_ORIGIN;const now=()=>options.now?.()??Date.now();const ttl=options.cacheTtlMs??SUBITO_CACHE_TTL_MS;
 const cache=new Map<string,{at:number;value:SubitoObservation}>();
 const detailOk=(u:string)=>origin===SUBITO_ORIGIN?DETAIL_RE.test(u):new RegExp('^'+origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/offerte-lavoro/[a-z0-9-]+-\\d+\\.htm$').test(u);
 const paginationOn=options.pagination??subitoPaginationAccepted();
 return async(occupation,city,parentSignal,beforeIO,searchOptions)=>{
  // Pages: 1 unless pagination is enabled AND the caller (an explicit user "more offers" request) asked for more; clamped to the cap.
  const pages=paginationOn?Math.min(SUBITO_MAX_PAGES,Math.max(1,Math.floor(searchOptions?.pages??1))):1;
  const key=`${occupation.toLowerCase()}|${city.toLowerCase()}|p${pages}`;const hit=cache.get(key);
  if(hit&&now()-hit.at<ttl)return {...hit.value,cache:'hit'};
  const listUrl=subitoListUrl(occupation,city,origin);
  const pageUrl=(n:number)=>n===1?listUrl:`${listUrl}&o=${n}`;
  const allowed=new Set(Array.from({length:pages},(_,i)=>pageUrl(i+1)));
  if(globalActive)return {listUrl,observedAt:new Date(now()).toISOString(),cache:'live',cards:[],blocked:'jobs_busy',navigations:0,pagesRead:0};
  globalActive=true;let browser:Browser|undefined;let navigations=0,pagesRead=0;
  const signal=AbortSignal.any([parentSignal,AbortSignal.timeout((options.totalTimeoutMs??SUBITO_TOTAL_TIMEOUT_MS)+(pages-1)*12_000)]);
  const stop=()=>{void browser?.close().catch(()=>{})};signal.addEventListener('abort',stop,{once:true});
  const wait=(range:[number,number])=>{const [a,b]=range;return new Promise(r=>setTimeout(r,a+Math.random()*(b-a)))};
  const pause=()=>wait(options.pauseMs??[1500,3000]);const pagePause=()=>wait(options.pagePauseMs??options.pauseMs??SUBITO_PAGE_PAUSE_MS);
  const clean=(c:SubitoCard)=>({title:c.title.replace(/(?:\+?\d[\d\s().-]{7,}\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[omesso]').replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,140),url:c.url,locality:c.locality?c.locality.slice(0,60):null,provinceCode:c.provinceCode,publisherHint:c.publisherHint});
  try{
   if(beforeIO)await beforeIO();parentSignal.throwIfAborted();
   browser=await (options.launch??(()=>chromium.launch({headless:true,timeout:8000})))();
   const context=await browser.newContext({locale:'it-IT',viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:false});
   await context.route('**/*',route=>{const req=route.request();const u=req.url();
    // Document navigations: only the list page(s) explicitly allowed for this search; never /utente/, never pages beyond the cap.
    if(req.resourceType()==='document'){if(!allowed.has(u)||navigations>=pages||/\/utente\//.test(u))return route.abort();navigations++;return route.continue()}
    if(!u.startsWith(origin+'/')&&!/^https:\/\/[a-z0-9.-]*subito\.it\//.test(u))return route.abort();
    if(['image','media','font'].includes(req.resourceType()))return route.abort();return route.continue()});
   const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(15000);
   const cards:SubitoCard[]=[];const seen=new Set<string>();let observedAt=new Date(now()).toISOString();
   for(let n=1;n<=pages;n++){
    if(n>1){await pagePause();parentSignal.throwIfAborted()}
    const res=await page.goto(pageUrl(n),{waitUntil:'domcontentloaded'});
    observedAt=new Date(now()).toISOString();
    if(!res||res.status()!==200||new URL(page.url()).origin!==new URL(origin).origin){if(n===1)return {listUrl,observedAt,cache:'live',cards:[],blocked:`http ${res?.status()??0}`,navigations,pagesRead};break}
    if(n===1){await pause();parentSignal.throwIfAborted()}
    const bodyText=(await page.locator('body').innerText().catch(()=>'')).slice(0,20000);
    if(/access denied|captcha|verify you are human|verifica.{0,25}(robot|umana)|unusual traffic|accesso negato/i.test(bodyText)||await page.locator('input[type="password"],iframe[src*="captcha"]').count()){if(n===1)return {listUrl,observedAt,cache:'live',cards:[],blocked:'jobs_access_blocked',navigations,pagesRead};break}
    const raw=await page.evaluate(EXTRACT) as SubitoCard[];pagesRead++;
    let fresh=0;for(const c of raw){if(!detailOk(c.url)||seen.has(c.url))continue;seen.add(c.url);cards.push(clean(c));fresh++;if(cards.length>=SUBITO_MAX_CARDS*pages)break}
    if(fresh===0)break; // last page reached: stop early, no blind navigation
   }
   const value:SubitoObservation={listUrl,observedAt,cache:'live',cards,blocked:null,navigations,pagesRead};
   cache.set(key,{at:now(),value});return value;
  }catch(e){if(parentSignal.aborted)throw e;return {listUrl,observedAt:new Date(now()).toISOString(),cache:'live',cards:[],blocked:signal.aborted?'jobs_timeout':String(e instanceof Error?e.message:e).slice(0,100),navigations,pagesRead}}
  finally{signal.removeEventListener('abort',stop);try{await browser?.close()}catch{}globalActive=false}
 };
}
export function defaultSubitoSearch():SubitoSearch{return createSubitoSearch()}
export type SubitoOpportunity=Opportunity&{sourceName:'Subito';company:null;observedLocality:string|null;observedProvince:string|null;locationMatch:ReturnType<typeof classifyLocation>;observed_at:string;collectionMode:'subito_list_card';publisherEvidence?:string};
// Cards → opportunities: LISTING_OBSERVED (list card seen), availability UNKNOWN, publisher never DIRECT_EMPLOYER.
// Title relevance: Subito's keyword search also returns cards that merely mention the term in the body
// (e.g. "Badante colf" for "cameriere"). Keep only cards whose title contains the occupation stem
// (accent/gender-insensitive: cameriere/cameriera, programmatore/programmatrice). Off-query cards are counted, not shown.
export function titleMatchesOccupation(title:string,occupation:string){
 const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 // Italian agent-noun stems: cameriere/a/i → camerier, programmatore/trice/tori → programmat, saldatore → saldat, cuoco/a/chi → cuoc.
 const stem=(w:string)=>w.replace(/(tore|trice|tori|trici)$/,'t').replace(/(iere|iera|ieri|iere)$/,'ier').replace(/(chi|che|ci|ce)$/,'c').replace(/[aeio]$/,'');
 const titleStems=norm(title).split(/[^a-z]+/).filter(Boolean).map(stem);
 return norm(occupation).split(/[^a-z]+/).filter(w=>w.length>=3).every(w=>{const s=stem(w);return titleStems.some(t=>t===s||(s.length>=4&&t.startsWith(s)))});
}
export async function subitoOpportunities(search:SubitoSearch,query:{occupation:string;city:string;noAgencies:boolean;remote?:boolean},signal:AbortSignal,beforeIO?:()=>Promise<void>,options?:SubitoSearchOptions){
 if(!query.city)return {opportunities:[] as SubitoOpportunity[],excludedNonDirect:0,provenance:{skipped:'remote request: Subito list search requires a city'},sourceUnavailable:undefined,replacesSearchLink:false};
 const obs=await search(query.occupation,query.city,signal,beforeIO,options);
 const maxShown=obs.pagesRead>1?60:30; // bounded receipt (3 pages ≈ 90 cards would overflow the context budget together with Adzuna)
 const opportunities:SubitoOpportunity[]=[];let excludedNonDirect=0;
 let offQuery=0;
 for(const c of obs.cards){
  if(!titleMatchesOccupation(c.title,query.occupation)){offQuery++;continue}
  if(query.noAgencies){excludedNonDirect++;continue}
  const agency=c.publisherHint==='AGENZIA';
  // Compact card: the UI reads title/city/source_url/publisher_type/verification_status/status/observed_at/locationMatch/
  // observedLocality/observedProvince; the shared evidence claim lives once in provenance.claim (not per card) so 90 cards fit the context budget.
  opportunities.push({opportunity_kind:'VACANCY',title:c.title,city:c.locality??query.city,source_url:c.url,source_type:'JOB_BOARD',publisher_type:agency?'STAFFING_AGENCY':'UNKNOWN',verification_status:'LISTING_OBSERVED',discovered_at:obs.observedAt,last_verified_at:null,status:'UNKNOWN',evidence:[],sourceName:'Subito',company:null,observedLocality:c.locality,observedProvince:c.provinceCode,locationMatch:classifyLocation(query.city,{locality:c.locality,region:c.provinceCode}),observed_at:obs.observedAt,collectionMode:'subito_list_card',...(agency?{publisherEvidence:'agency name in card text'}:c.publisherHint==='AZIENDA_VERIFICATA'?{publisherEvidence:'"Azienda verificata" badge: verified business account, not proof of direct employer'}:{})} as SubitoOpportunity);
  if(opportunities.length>=maxShown)break;
 }
 const code=obs.blocked?(obs.blocked==='jobs_busy'?'jobs_busy':obs.blocked==='jobs_timeout'?'jobs_timeout':'jobs_access_blocked'):undefined;
 return {opportunities,excludedNonDirect,provenance:{listUrl:obs.listUrl,observedAt:obs.observedAt,cache:obs.cache,cardsObserved:obs.cards.length,offQuery,blocked:obs.blocked,navigations:obs.navigations,pagesRead:obs.pagesRead,claim:'Cards observed on the Subito list page(s) at observedAt; detail pages not opened, availability not verified.',policy:obs.pagesRead>1?`${SUBITO_FLAG}=${SUBITO_FLAG_VALUE} + ${SUBITO_PAGINATION_FLAG}=${SUBITO_FLAG_VALUE}: owner accepted robots-comment/ToS risk AND bounded pagination (decision B, 2026-10-01): ${obs.pagesRead} list pages on explicit user request, max ${SUBITO_MAX_PAGES}, no contacts`:`${SUBITO_FLAG}=${SUBITO_FLAG_VALUE}: owner accepted robots-comment/ToS risk; on-demand single list page, no contacts`},sourceUnavailable:code?{code,detail:obs.blocked}:undefined,replacesSearchLink:opportunities.length>0};
}
