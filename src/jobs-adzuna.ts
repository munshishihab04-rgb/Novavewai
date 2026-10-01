// Adzuna official Jobs API (https://developer.adzuna.com) — the legitimate aggregator path for job discovery.
// Owner registered the app on 2026-10-01; credentials live ONLY in trial.env (NOVA_ADZUNA_APP_ID / NOVA_ADZUNA_APP_KEY),
// never in code, logs, receipts or provenance. This source is meant to replace Subito pagination over time
// (docs/decisions/2026-10-01-subito-pagination.md, exit criteria).
//
// Contract: bounded requests (1 page per search, up to ADZUNA_MAX_PAGES when the user explicitly asks for more),
// compact records (no description, no contacts), results are dated observations from an aggregator: publisher is
// UNKNOWN unless the company name is a known staffing agency; never DIRECT_EMPLOYER without evidence; the original
// link (adzuna.it details page → employer/board) is the source of truth.
import type {Opportunity} from './jobs-discovery.ts';
import {classifyLocation} from './jobs-posting.ts';
import {titleMatchesOccupation} from './jobs-subito-playwright.ts';
import {validJobTerm} from './jobs-input.ts';
export const ADZUNA_ENDPOINT='https://api.adzuna.com/v1/api/jobs/it/search',ADZUNA_PER_PAGE=50,ADZUNA_MAX_PAGES=3,ADZUNA_CACHE_TTL_MS=6*3600_000,ADZUNA_MAX_DAYS_OLD=60,ADZUNA_TIMEOUT_MS=12_000;
export function adzunaConfigured(env:NodeJS.ProcessEnv=process.env){return !!(env.NOVA_ADZUNA_APP_ID?.trim()&&env.NOVA_ADZUNA_APP_KEY?.trim())}
export type AdzunaJob={id:string;title:string;company:string|null;locality:string|null;province:string|null;created:string|null;contract:string|null;salary:{min:number|null;max:number|null}|null;url:string};
export type AdzunaObservation={observedAt:string;cache:'hit'|'live';count:number|null;pagesRead:number;jobs:AdzunaJob[];blocked:null|'adzuna_auth'|'adzuna_rate_limited'|'adzuna_unavailable'|'adzuna_bad_response'};
export type AdzunaSearch=(occupation:string,city:string,signal:AbortSignal,options?:{pages?:number})=>Promise<AdzunaObservation>;
type Options={appId:string;appKey:string;fetcher?:typeof fetch;now?:()=>number;cacheTtlMs?:number;endpoint?:string};
const clean=(v:unknown,max:number)=>typeof v==='string'?v.replace(/(?:\+?\d[\d\s().-]{7,}\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/\S+/gi,'[omesso]').replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const AGENCY_RE=/agenzia per il lavoro|\b(?:adecco|randstad|manpower|gi group|lavoropi[uù]|synergie|openjob|umana|etjca|orienta|during|tempor|humangest|axl|maw|eurofirms|kelly services|page personnel|hays|ali spa|e-work|intempo|generazione vincente|staff spa|inforgroup|jobtech|tempi moderni)\b/i;
export function createAdzunaSearch(options:Options):AdzunaSearch{
 const fetcher=options.fetcher??fetch,now=()=>options.now?.()??Date.now(),ttl=options.cacheTtlMs??ADZUNA_CACHE_TTL_MS,endpoint=options.endpoint??ADZUNA_ENDPOINT;
 const cache=new Map<string,{at:number;value:AdzunaObservation}>();
 return async(occupation,city,signal,searchOptions)=>{
  const pages=Math.min(ADZUNA_MAX_PAGES,Math.max(1,Math.floor(searchOptions?.pages??1)));
  if(!validJobTerm(occupation)||!validJobTerm(city,80))return {observedAt:new Date(now()).toISOString(),cache:'live',count:null,pagesRead:0,jobs:[],blocked:'adzuna_bad_response'};
  const key=`${occupation.toLowerCase()}|${city.toLowerCase()}|p${pages}`;const hit=cache.get(key);
  if(hit&&now()-hit.at<ttl)return {...hit.value,cache:'hit'};
  const jobs:AdzunaJob[]=[];const seen=new Set<string>();let count:number|null=null,pagesRead=0,blocked:AdzunaObservation['blocked']=null;
  for(let page=1;page<=pages;page++){
   const u=new URL(`${endpoint}/${page}`);u.searchParams.set('app_id',options.appId);u.searchParams.set('app_key',options.appKey);u.searchParams.set('results_per_page',String(ADZUNA_PER_PAGE));u.searchParams.set('what',occupation);u.searchParams.set('where',city);u.searchParams.set('max_days_old',String(ADZUNA_MAX_DAYS_OLD));u.searchParams.set('sort_by','date');u.searchParams.set('content-type','application/json');
   let res:Response;try{res=await fetcher(u.toString(),{signal:AbortSignal.any([signal,AbortSignal.timeout(ADZUNA_TIMEOUT_MS)]),headers:{accept:'application/json'},redirect:'manual'})}catch(e){if(signal.aborted)throw e;blocked='adzuna_unavailable';break}
   if(res.status===401||res.status===403){blocked='adzuna_auth';break}if(res.status===429){blocked='adzuna_rate_limited';break}if(res.status!==200){blocked='adzuna_unavailable';break}
   let body:any;try{body=await res.json()}catch{blocked='adzuna_bad_response';break}
   if(!body||!Array.isArray(body.results)){blocked='adzuna_bad_response';break}
   if(typeof body.count==='number')count=body.count;
   let fresh=0;
   for(const r of body.results.slice(0,ADZUNA_PER_PAGE)){
    // ids are numeric strings (10 digits live) — never run them through the phone scrubber.
    const id=typeof r?.id==='string'&&/^[0-9A-Za-z_-]{1,40}$/.test(r.id)?r.id:typeof r?.id==='number'?String(r.id):'';const title=clean(r?.title,140);let url:string|null=null;
    try{const ru=new URL(String(r?.redirect_url));if(ru.hostname==='www.adzuna.it'&&/^\/(?:details|land\/ad)\/\d+$/.test(ru.pathname))url=`https://www.adzuna.it/details/${ru.pathname.match(/\d+$/)![0]}`}catch{}
    if(!id||!title||!url||seen.has(id))continue;seen.add(id);fresh++;
    const display=clean(r?.location?.display_name,120);const [locality,province]=display.split(',').map(s=>s.trim());
    const company=clean(r?.company?.display_name,120)||null;
    const created=typeof r?.created==='string'&&/^\d{4}-\d{2}-\d{2}/.test(r.created)?r.created.slice(0,19)+'Z':null;
    const salary=(typeof r?.salary_min==='number'||typeof r?.salary_max==='number')&&r?.salary_is_predicted!=='1'?{min:typeof r.salary_min==='number'?Math.round(r.salary_min):null,max:typeof r.salary_max==='number'?Math.round(r.salary_max):null}:null;
    jobs.push({id,title,company,locality:locality||null,province:province||null,created,contract:typeof r?.contract_time==='string'?clean(r.contract_time,20):null,salary,url});
   }
   if(fresh===0&&page>1)break; // last page reached (an empty page is not counted as read)
   pagesRead++;
  }
  const value:AdzunaObservation={observedAt:new Date(now()).toISOString(),cache:'live',count,pagesRead,jobs,blocked};
  if(!blocked||pagesRead>0)cache.set(key,{at:now(),value});
  return value;
 };
}
export function defaultAdzunaSearch(env:NodeJS.ProcessEnv=process.env):AdzunaSearch|null{return adzunaConfigured(env)?createAdzunaSearch({appId:env.NOVA_ADZUNA_APP_ID!.trim(),appKey:env.NOVA_ADZUNA_APP_KEY!.trim()}):null}
export type AdzunaOpportunity=Opportunity&{sourceName:'Adzuna';company:string|null;observedLocality:string|null;observedProvince:string|null;locationMatch:ReturnType<typeof classifyLocation>;observed_at:string;datePosted:string|null;employmentType:string|null;salary:AdzunaJob['salary'];collectionMode:'adzuna_api'};
export async function adzunaOpportunities(search:AdzunaSearch,query:{occupation:string;city:string;noAgencies:boolean},signal:AbortSignal,options?:{pages?:number}){
 if(!query.city)return {opportunities:[] as AdzunaOpportunity[],excludedNonDirect:0,provenance:{skipped:'remote request: Adzuna search requires a city'},sourceUnavailable:undefined as undefined|{code:string}};
 const obs=await search(query.occupation,query.city,signal,options);
 const opportunities:AdzunaOpportunity[]=[];let excludedNonDirect=0,offQuery=0;
 const maxShown=obs.pagesRead>1?80:40; // bounded receipt: the context budget is finite; count tells the user the real total
 for(const j of obs.jobs){
  if(opportunities.length>=maxShown)break;
  if(!titleMatchesOccupation(j.title,query.occupation)){offQuery++;continue}
  if(query.noAgencies){excludedNonDirect++;continue}
  const agency=!!(j.company&&AGENCY_RE.test(j.company));
  const province=j.province?.replace(/^provincia di\s+/i,'')??null;
  opportunities.push({opportunity_kind:'VACANCY',title:j.title,city:j.locality??query.city,source_url:j.url,source_type:'AGGREGATOR',publisher_type:agency?'STAFFING_AGENCY':'UNKNOWN',verification_status:'LISTING_OBSERVED',discovered_at:obs.observedAt,last_verified_at:null,status:'UNKNOWN',evidence:[],sourceName:'Adzuna',company:j.company,observedLocality:j.locality,observedProvince:province,locationMatch:classifyLocation(query.city,{locality:j.locality,region:province}),observed_at:obs.observedAt,datePosted:j.created?j.created.slice(0,10):null,employmentType:j.contract==='full_time'?'FULL_TIME':j.contract==='part_time'?'PART_TIME':null,salary:j.salary,collectionMode:'adzuna_api'} as AdzunaOpportunity);
 }
 return {opportunities,excludedNonDirect,provenance:{observedAt:obs.observedAt,cache:obs.cache,count:obs.count,pagesRead:obs.pagesRead,jobsReturned:obs.jobs.length,offQuery,blocked:obs.blocked,claim:'Records from the Adzuna official API (aggregator) at observedAt; company/location/date as published by the aggregator; original link is the source of truth; availability not verified.',policy:'Adzuna official API, owner-registered app; bounded pages; no description or contacts stored'},sourceUnavailable:obs.blocked?{code:obs.blocked}:undefined};
}
