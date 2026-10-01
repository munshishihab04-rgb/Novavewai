// Per-origin robots.txt permission gate (RFC 9309 semantics) for bounded job-listing reads.
// robots.txt is untrusted public data: it is parsed, never executed or shown to the model.
// A deny-list overrides any Allow directive for origins whose stated conditions forbid automated
// access without permission (Subito, evidence/subito-claude-1/robots.txt). Subito is never read by the
// generic JSON-LD reader; its dedicated adapter (jobs-subito-playwright.ts) is behind an explicit owner policy flag.
export const JOB_BOT_TOKEN='NovaJobBot';
export const JOB_BOT_USER_AGENT='Mozilla/5.0 (compatible; NovaJobBot/0.1)';
export const MIN_CRAWL_DELAY_MS=1000,MAX_CRAWL_DELAY_MS=30_000,ROBOTS_TTL_MS=24*3600_000,ROBOTS_MAX_BYTES=512_000,ROBOTS_TIMEOUT_MS=10_000;
export type RobotsRule={allow:boolean;pattern:string};
export type RobotsGroup={agents:string[];rules:RobotsRule[];crawlDelayMs?:number};
export type PermissionDecision={permitted:boolean;reason:string;crawlDelayMs:number;origin:string;checkedAt:string};
const DENIED_HOST_SUFFIXES=['subito.it'];
export function permanentlyDenied(hostname:string){const h=hostname.toLowerCase().replace(/\.$/,'');return DENIED_HOST_SUFFIXES.some(s=>h===s||h.endsWith('.'+s))}
export function parseRobots(text:string):RobotsGroup[]{
 const groups:RobotsGroup[]=[];let current:RobotsGroup|null=null;let lastWasAgent=false;
 for(const rawLine of text.slice(0,ROBOTS_MAX_BYTES).split(/\r?\n/)){
  const line=rawLine.replace(/#.*$/,'').trim();if(!line)continue;
  const m=line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);if(!m)continue;
  const field=m[1].toLowerCase(),value=m[2].trim();
  if(field==='user-agent'){if(!current||!lastWasAgent){current={agents:[],rules:[]};groups.push(current)}current.agents.push(value.toLowerCase());lastWasAgent=true;continue}
  lastWasAgent=false;if(!current)continue;
  if(field==='allow'||field==='disallow'){current.rules.push({allow:field==='allow',pattern:value})}
  else if(field==='crawl-delay'){const n=Number(value.replace(',','.'));if(Number.isFinite(n)&&n>=0)current.crawlDelayMs=Math.min(MAX_CRAWL_DELAY_MS,Math.max(MIN_CRAWL_DELAY_MS,Math.round(n*1000)))}
 }
 return groups;
}
// Product-token match for our bot, else the `*` group; several groups for the same token merge.
export function selectGroup(groups:RobotsGroup[],token=JOB_BOT_TOKEN):RobotsGroup|null{
 const t=token.toLowerCase();const pick=(pred:(a:string)=>boolean)=>{const hits=groups.filter(g=>g.agents.some(pred));if(!hits.length)return null;return {agents:hits[0].agents,rules:hits.flatMap(g=>g.rules),crawlDelayMs:hits.find(g=>g.crawlDelayMs!==undefined)?.crawlDelayMs}};
 return pick(a=>a===t||a.startsWith(t+'/'))??pick(a=>a==='*');
}
function patternToRegex(pattern:string){const esc=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');const anchored=esc.endsWith('\\$')?esc.slice(0,-2)+'$':esc;return new RegExp('^'+anchored)}
export function pathAllowed(group:RobotsGroup|null,pathAndQuery:string):boolean{
 if(!group)return true;let best:{allow:boolean;len:number}|null=null;
 for(const r of group.rules){if(!r.pattern){continue}// empty Disallow/Allow = no restriction
  if(!r.pattern.startsWith('/')&&!r.pattern.startsWith('*'))continue;
  let re:RegExp;try{re=patternToRegex(r.pattern)}catch{continue}
  if(!re.test(pathAndQuery))continue;const len=r.pattern.length;
  if(!best||len>best.len||(len===best.len&&r.allow&&!best.allow))best={allow:r.allow,len};
 }
 return best?best.allow:true;
}
export function robotsDecision(text:string,url:URL,token=JOB_BOT_TOKEN):{allowed:boolean;crawlDelayMs:number;matchedGroup:'bot'|'star'|'none'}{
 const groups=parseRobots(text);const group=selectGroup(groups,token);
 const matched=group?(group.agents.includes('*')?'star':'bot'):'none';
 return {allowed:pathAllowed(group,url.pathname+url.search),crawlDelayMs:group?.crawlDelayMs??MIN_CRAWL_DELAY_MS,matchedGroup:matched};
}
type CacheEntry={fetchedAt:number;state:'rules'|'open'|'denied';text?:string;reason:string};
export class OriginPermissionGate{
 private cache=new Map<string,CacheEntry>();
 constructor(private options:{fetcher?:typeof fetch;now?:()=>number;ttlMs?:number}={}){}
 private now(){return this.options.now?.()??Date.now()}
 async check(url:URL,signal:AbortSignal):Promise<PermissionDecision>{
  const checkedAt=new Date(this.now()).toISOString();const origin=url.origin;
  if(url.protocol!=='https:')return {permitted:false,reason:'https required',crawlDelayMs:MIN_CRAWL_DELAY_MS,origin,checkedAt};
  if(permanentlyDenied(url.hostname))return {permitted:false,reason:'origin on permanent deny-list: automated access requires the operator\'s permission',crawlDelayMs:MIN_CRAWL_DELAY_MS,origin,checkedAt};
  let entry=this.cache.get(origin);
  if(!entry||this.now()-entry.fetchedAt>(this.options.ttlMs??ROBOTS_TTL_MS)){entry=await this.load(origin,signal);this.cache.set(origin,entry)}
  if(entry.state==='denied')return {permitted:false,reason:entry.reason,crawlDelayMs:MIN_CRAWL_DELAY_MS,origin,checkedAt};
  if(entry.state==='open')return {permitted:true,reason:entry.reason,crawlDelayMs:MIN_CRAWL_DELAY_MS,origin,checkedAt};
  const d=robotsDecision(entry.text??'',url);
  return {permitted:d.allowed,reason:d.allowed?`robots.txt ${d.matchedGroup==='bot'?JOB_BOT_TOKEN:'*'} group allows path`:`robots.txt ${d.matchedGroup==='bot'?JOB_BOT_TOKEN:'*'} group disallows path`,crawlDelayMs:d.crawlDelayMs,origin,checkedAt};
 }
 private async load(origin:string,signal:AbortSignal):Promise<CacheEntry>{
  const fetchedAt=this.now();const fetcher=this.options.fetcher??fetch;
  try{
   const res=await fetcher(origin+'/robots.txt',{signal:AbortSignal.any([signal,AbortSignal.timeout(ROBOTS_TIMEOUT_MS)]),headers:{'user-agent':JOB_BOT_USER_AGENT,accept:'text/plain'},redirect:'follow'});
   if(res.status===404||res.status===410)return {fetchedAt,state:'open',reason:`robots.txt http ${res.status}: no restrictions published`};
   if(!res.ok)return {fetchedAt,state:'denied',reason:`robots.txt http ${res.status}: not permitted`};
   const text=await res.text();
   if(text.length>ROBOTS_MAX_BYTES)return {fetchedAt,state:'denied',reason:'robots.txt oversized'};
   return {fetchedAt,state:'rules',text,reason:'robots.txt parsed'};
  }catch(e){if(signal.aborted)throw e;return {fetchedAt,state:'denied',reason:`robots.txt unreachable: ${String(e instanceof Error?e.message:e).slice(0,80)}`}}
 }
 originsCached(){return [...this.cache.keys()]}
}
