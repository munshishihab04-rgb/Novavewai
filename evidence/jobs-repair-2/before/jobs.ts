import {portalOpportunities,type Opportunity} from './jobs-discovery.ts';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
export type JobsInput = {query:string;city:string};
export type Job = {title:string;url:string;city:string;source:'Subito';publishedAt?:string;contract?:string;compensation?:string};
export type JobsResult = {sourceUnavailable?:{code?:string;retryAfterSeconds?:number;originalSearchUrl?:string};retryable?:boolean;retryAfterSeconds?:number;limitReason?:string;originalSearchUrl?:string;opportunities?:Opportunity[];excludedUnknown?:number;status:string;occupation?:string;city?:string;question?:string;code?:string;jobs?:Job[];fetchedAt?:string;expiresAt?:string;cache?:'hit'|'live';trust?:'untrusted_public_metadata'};
export type JobsSource = (occupation:string,city:string,signal:AbortSignal)=>Promise<Job[]>;
type WebSearchReceipt={sources?:unknown;checkedAt?:unknown};
const publicCandidate=(value:string)=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;const h=u.hostname.toLowerCase();if(h==='localhost'||h.endsWith('.local')||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^0\./.test(h)||h==='::1'||h==='[::1]'||/^172\.(1[6-9]|2\d|3[01])\./.test(h))return false;return true}catch{return false}};
export function webJobCandidates(receipt:WebSearchReceipt,occupation:string,city:string):JobsResult{
 const at=typeof receipt.checkedAt==='string'&&!Number.isNaN(Date.parse(receipt.checkedAt))?receipt.checkedAt:new Date().toISOString();const seen=new Set<string>();const opportunities:Opportunity[]=[];
 for(const row of Array.isArray(receipt.sources)?receipt.sources.slice(0,6):[]){if(!row||typeof row.title!=='string'||typeof row.url!=='string'||!publicCandidate(row.url))continue;const u=new URL(row.url);u.hash='';const url=u.toString();if(seen.has(url))continue;seen.add(url);opportunities.push({opportunity_kind:'VACANCY',title:row.title.replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,120)||`${occupation} — candidate`,city,source_url:url,source_type:'UNKNOWN',publisher_type:'UNKNOWN',verification_status:'UNVERIFIED',discovered_at:at,last_verified_at:null,status:'UNKNOWN',evidence:[{url,observed_at:at,claim:'Candidate link returned by bounded web search; vacancy, location, publisher identity and availability are not verified.'}]});}
 return {status:'candidates_unverified',occupation,city,opportunities,retryable:false,trust:'untrusted_public_metadata'};
}
export const JOB_CITIES:Record<string,{region:string;province:string;slug:string}> = {
 Bologna:{region:'emilia-romagna',province:'bologna',slug:'bologna'}, Milano:{region:'lombardia',province:'milano',slug:'milano'}, Roma:{region:'lazio',province:'roma',slug:'roma'}, Napoli:{region:'campania',province:'napoli',slug:'napoli'}, Torino:{region:'piemonte',province:'torino',slug:'torino'},
 Firenze:{region:'toscana',province:'firenze',slug:'firenze'}, Genova:{region:'liguria',province:'genova',slug:'genova'}, Palermo:{region:'sicilia',province:'palermo',slug:'palermo'}, Bari:{region:'puglia',province:'bari',slug:'bari'}, Verona:{region:'veneto',province:'verona',slug:'verona'}, Padova:{region:'veneto',province:'padova',slug:'padova'}, Venezia:{region:'veneto',province:'venezia',slug:'venezia'},
};
const roles:Record<string,RegExp> = {cuoco:/\b(cucin\w*|cuoc\w*|chef|cook\w*)\b/i,cameriere:/\b(camerier\w*|waiter|waitress|sala)\b/i,ristorazione:/\b(ristora\w*|restaurant)\b/i,pizzaiolo:/\b(pizz\w*)\b/i,lavapiatti:/\b(lavapiatti|dishwash\w*)\b/i,pulizie:/\b(pulizi\w*|clean\w*)\b/i,magazziniere:/\b(magazzin\w*|warehouse)\b/i,commesso:/\b(commess\w*|negozio|retail)\b/i,autista:/\b(autista|driver)\b/i,badante:/\b(badante|assistenza anziani)\b/i,operaio:/\b(operai\w*|fabbrica)\b/i,barista:/\b(barista|bar)\b/i};
export function jobIntent(input:JobsInput) {
 const occupation=Object.entries(roles).find(([,r])=>r.test(input.query))?.[0];
 const supplied=input.city.trim();
 const cities=Object.keys(JOB_CITIES).filter(c=>supplied ? c.toLowerCase()===supplied.toLowerCase() : new RegExp(`\\b${c}\\b`,'i').test(input.query));
 const city=cities.length===1?cities[0]:undefined;
 return {occupation,city,supplied};
}
export function compactJobs(rows:unknown,city:string):Job[] {
 if(!Array.isArray(rows))throw new Error('jobs_parse_failed');
 const out:Job[]=[];const seen=new Set<string>();
 const clean=(v:unknown,max:number)=>typeof v==='string'?v.replace(/(?:\+?\d[\d\s().-]{7,}\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/\S+/gi,'[omesso]').replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,max):'';
 for(const row of rows.slice(0,100)){
  if(!row||typeof row.url!=='string'||!/^https:\/\/www\.subito\.it\/offerte-lavoro\/[a-z0-9-]+-\d+\.htm$/.test(row.url)||seen.has(row.url))continue;
  const title=clean(row.title,120);if(!title)continue;
  const job:Job={title,url:row.url,city,source:'Subito'};
  for(const field of ['publishedAt','contract','compensation'] as const){const v=clean(row[field],60);if(v)job[field]=v;}
  out.push(job);seen.add(row.url);if(out.length===8)break;
 }
 return out;
}
type Options={cacheDir:string;source:JobsSource;now?:()=>number;ttlMs?:number;minIntervalMs?:number};
export class JobsService {
  constructor(private options:Options) {
    for(const [value,min,max] of [[options.ttlMs??21600000,1,86400000],[options.minIntervalMs??15000,0,60000]])if(!Number.isInteger(value)||value<min||value>max)throw Error('jobs_invalid_budget');
  }
  async search(input:JobsInput,signal:AbortSignal):Promise<JobsResult> {
    const result=await this.lookup(input,signal);
    const intent=jobIntent(input);
    if(intent.city&&intent.occupation){const p=JOB_CITIES[intent.city];result.originalSearchUrl=`https://www.subito.it/annunci-${p.region}/vendita/offerte-lavoro/${p.province}/${p.slug}/?q=${encodeURIComponent(intent.occupation)}`;}
    if(result.status==='unavailable')result.retryable=false; // No automatic model retries, including cooldowns.
    if(result.status==='ok'&&result.jobs&&result.fetchedAt){
      result.opportunities=portalOpportunities(result.jobs,result.fetchedAt);
      if(/senza agenzie|niente agenzie|no agenc|only direct|solo aziende/i.test(input.query)){result.excludedUnknown=result.jobs.length;result.jobs=[];result.opportunities=[];}
    }
    return result;
  }
  private async lookup(input:JobsInput,signal:AbortSignal):Promise<JobsResult> {
    const intent=jobIntent(input);const {occupation,city,supplied}=intent;
    if(!city)return {status:supplied?'unsupported_city':'needs_city',occupation,question:supplied?'Questa città non è ancora supportata dalla ricerca lavoro.':'In quale città vuoi cercare lavoro?'};
    if(!occupation)return {status:'needs_occupation',city,question:'Che tipo di lavoro cerchi, oppure cosa sai fare?'};
    const now=this.options.now?.()??Date.now();const ttl=this.options.ttlMs??21600000;
    const key=createHash('sha256').update(JSON.stringify({v:1,occupation,city})).digest('hex');
    const path=join(this.options.cacheDir,key+'.json');
    try{
      signal.throwIfAborted();await mkdir(this.options.cacheDir,{recursive:true,mode:0o700});
      try{const entry=JSON.parse(await readFile(path,'utf8'));if(entry.occupation===occupation&&entry.city===city&&entry.fetchedAt<=now&&entry.expiresAt>now&&entry.expiresAt-entry.fetchedAt<=ttl){return {status:'ok',occupation,city,jobs:compactJobs(entry.jobs,city),fetchedAt:new Date(entry.fetchedAt).toISOString(),expiresAt:new Date(entry.expiresAt).toISOString(),cache:'hit',trust:'untrusted_public_metadata'};}}catch{}
      const lock=join(this.options.cacheDir,'browser.lock');
      try{await mkdir(lock);}catch{return {status:'unavailable',occupation,city,code:'jobs_busy'};}
      try {
        const budgetPath=join(this.options.cacheDir,'budget.json');
        let budget:{day:number;count:number;last:number;lastError?:string|null}={day:Math.floor(now/86400000),count:0,last:0};
        try{const saved=JSON.parse(await readFile(budgetPath,'utf8'));if(saved.day===budget.day)budget=saved;}catch{}
        const minInterval=this.options.minIntervalMs??15000;
        if(now-budget.last<minInterval){
          const previous=typeof budget.lastError==='string'&&/^jobs_(access_blocked|policy_unreviewed|robots_denied|parse_failed|timeout|request_budget|source_unavailable)$/.test(budget.lastError)?budget.lastError:'jobs_rate_limited';
          return {status:'unavailable',occupation,city,code:previous,limitReason:'jobs_rate_limited',retryAfterSeconds:Math.ceil((minInterval-(now-budget.last))/1000)};
        }
        if(budget.count>=40)return {status:'unavailable',occupation,city,code:'jobs_daily_budget'};
        try{
          const jobs=compactJobs(await this.options.source(occupation,city,signal),city);signal.throwIfAborted();
          await writeFile(budgetPath,JSON.stringify({...budget,count:budget.count+1,last:now,lastError:null}),{mode:0o600});
          const fetchedAt=this.options.now?.()??Date.now(),expiresAt=fetchedAt+ttl;
          const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({occupation,city,jobs,fetchedAt,expiresAt}),{mode:0o600});await rename(temporary,path);
          return {status:'ok',occupation,city,jobs,fetchedAt:new Date(fetchedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString(),cache:'live',trust:'untrusted_public_metadata'};
        }catch(error){
          const code=error instanceof Error&&/^jobs_(access_blocked|policy_unreviewed|robots_denied|parse_failed|timeout|request_budget)$/.test(error.message)?error.message:'jobs_source_unavailable';
          await writeFile(budgetPath,JSON.stringify({...budget,count:budget.count+1,last:now,lastError:code}),{mode:0o600});
          throw error;
        }
      } finally {await rm(lock,{recursive:true,force:true});}
    }catch(error){const code=error instanceof Error&&/^jobs_(access_blocked|policy_unreviewed|robots_denied|parse_failed|timeout|request_budget)$/.test(error.message)?error.message:'jobs_source_unavailable';return {status:'unavailable',occupation,city,code:signal.aborted?'jobs_cancelled':code};}
  }
}
