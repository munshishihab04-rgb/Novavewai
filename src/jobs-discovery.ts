import type {Job} from './jobs.ts';
export type OpportunityKind='VACANCY'|'SPONTANEOUS_APPLICATION'|'COMPATIBLE_COMPANY';
export type SourceType='DIRECT_EMPLOYER'|'JOB_BOARD'|'STAFFING_AGENCY'|'RECRUITMENT_COMPANY'|'PRIVATE_PERSON'|'AGGREGATOR'|'UNKNOWN';
export type PublisherType=Exclude<SourceType,'JOB_BOARD'|'AGGREGATOR'>;
export type Opportunity={opportunity_kind:OpportunityKind;title:string;city:string;source_url:string;source_type:SourceType;publisher_type:PublisherType;verification_status:'VERIFIED'|'PARTIALLY_VERIFIED'|'UNVERIFIED'|'EXPIRED'|'JSONLD_VERIFIED'|'LISTING_OBSERVED';discovered_at:string;last_verified_at:string|null;status:'OBSERVED'|'UNKNOWN'|'EXPIRED';evidence:{url:string;observed_at:string;claim:string}[]};
export function portalOpportunities(jobs:Job[],at:string):Opportunity[]{return jobs.map(j=>({opportunity_kind:'VACANCY',title:j.title,city:j.city,source_url:j.url,source_type:'JOB_BOARD',publisher_type:'UNKNOWN',verification_status:'UNVERIFIED',discovered_at:at,last_verified_at:null,status:'OBSERVED',evidence:[{url:j.url,observed_at:at,claim:'Listing link/title observed on Subito search page; employer identity, availability and requirements not verified.'}]}));}

export type DiscoveryQuery={occupation:string;city:string;noAgencies:boolean};
export type DiscoveryProviders={
 search:(query:DiscoveryQuery,signal:AbortSignal)=>Promise<Opportunity[]>;
 companies?:(query:DiscoveryQuery,signal:AbortSignal)=>Promise<Opportunity[]>;
 verify?:(candidates:Opportunity[],signal:AbortSignal)=>Promise<Opportunity[]>;
 browser?:(query:DiscoveryQuery,signal:AbortSignal)=>Promise<Opportunity[]>;
};
// Provider-neutral orchestration contract. No discovered-site networking is
// implemented here: provider adapters must enforce policy and SSRF boundaries.
// Not wired to production until real company/official-site providers are approved.
export async function discoverProgressively(query:DiscoveryQuery,providers:DiscoveryProviders,parent:AbortSignal){
 if(!query.city.trim())throw Error('jobs_city_required');
 if(!query.occupation.trim())throw Error('jobs_occupation_required');
 const signal=AbortSignal.any([parent,AbortSignal.timeout(30000)]);
 const rows:Opportunity[]=[];const stages:{stage:string;status:string}[]=[];
 const select=()=>{const seen=new Set<string>();return rows.filter(row=>{const key=row.opportunity_kind+'|'+row.source_url;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12)};
 const enough=()=>select().filter(r=>r.opportunity_kind==='VACANCY'&&r.verification_status!=='EXPIRED'&&(!query.noAgencies||r.publisher_type==='DIRECT_EMPLOYER')).length>=3;
 async function stage(name:string,work:()=>Promise<Opportunity[]>,replace=false){
  signal.throwIfAborted();let abort!:()=>void;
  try{const result=await Promise.race([work(),new Promise<never>((_,reject)=>{abort=()=>reject(Error('jobs_timeout'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})]);
   if(!Array.isArray(result)||result.length>30)throw Error('jobs_provider_budget');
   if(replace)rows.length=0;rows.push(...result);stages.push({stage:name,status:'completed'});
  }catch{signal.throwIfAborted();stages.push({stage:name,status:'unavailable'});}finally{signal.removeEventListener('abort',abort);}
 }
 await stage('search',()=>providers.search(query,signal));
 if(!enough()&&providers.companies)await stage('companies',()=>providers.companies!(query,signal));
 if(!enough()&&providers.verify)await stage('verify',()=>providers.verify!(select().slice(0,6),signal),true);
 if(!enough()&&providers.browser)await stage('browser',()=>providers.browser!(query,signal));
 const selected=select();const excludedUnknown=query.noAgencies?selected.filter(r=>r.publisher_type==='UNKNOWN').length:0;
 const excludedIntermediaries=query.noAgencies?selected.filter(r=>r.publisher_type!=='DIRECT_EMPLOYER'&&r.publisher_type!=='UNKNOWN').length:0;
 return {opportunities:selected.filter(r=>!query.noAgencies||r.publisher_type==='DIRECT_EMPLOYER'),excludedUnknown,excludedIntermediaries,stages};
}
