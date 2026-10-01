import {chromium,type Page} from 'playwright';
import {compactJobs,JOB_CITIES,jobIntent,type JobsSource} from './jobs.ts';
const ORIGIN='https://www.subito.it';
export function subitoURL(occupation:string,city:string) {
 const place=JOB_CITIES[city];if(!place||jobIntent({query:occupation,city}).occupation!==occupation)throw Error('jobs_invalid_search');
 return `${ORIGIN}/annunci-${place.region}/vendita/offerte-lavoro/${place.province}/${place.slug}/?q=${encodeURIComponent(occupation)}`;
}
// Conservative REP parser: any matching disallow for * / NovaJobs blocks. A
// more-specific Allow is deliberately not used to broaden source access.
export function robotsAllow(text:string,url:string) {
 if(text.length>65536||!/^user-agent\s*:/im.test(text)||/<html/i.test(text))return false;
 let agents:string[]=[];let rules=false;const target=new URL(url).pathname+new URL(url).search;
 for(const line of text.split(/\r?\n/)){
  const match=line.replace(/#.*/,'').match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);if(!match)continue;
  const [,raw,value]=match;const key=raw.toLowerCase();
  if(key==='user-agent'){if(rules)agents=[];rules=false;agents.push(value.toLowerCase());continue;}
  if(key==='disallow'||key==='allow')rules=true;
  if(key==='disallow'&&value&&agents.some(a=>a==='*'||'novajobs'.includes(a))){
   const pattern=value.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
   if(new RegExp('^'+pattern).test(target))return false;
  }
 }
 return true;
}
export async function extractSubitoJobs(page:Page,city:string) {
 const text=(await page.locator('body').innerText({timeout:3000})).slice(0,100000);
 if(/access denied|captcha|verify you are human|verifica.{0,25}(robot|umana)|unusual traffic|accesso negato/i.test(text)||await page.locator('input[type="password"],iframe[src*="captcha"]').count())throw Error('jobs_access_blocked');
 const rows=await page.locator('a[href*="/offerte-lavoro/"]').evaluateAll(anchors=>anchors.slice(0,100).map(a=>{
  const card=a.closest('article,li,[class*="item-card"],[class*="ItemCard"]')??a;
  const title=card.querySelector('h2,h3')?.textContent??a.querySelector('h2,h3')?.textContent??'';
  const time=card.querySelector('time');
  // No description, advertiser contacts, images, price-period guesses or employer inference.
  return {title,url:(a as HTMLAnchorElement).href,...(time?.getAttribute('datetime')?{publishedAt:time.getAttribute('datetime')}:{})};
 }));
 const jobs=compactJobs(rows,city);
 if(!jobs.length&&!/nessun (annuncio|risultato)|non abbiamo trovato annunci/i.test(text))throw Error('jobs_parse_failed');
 return jobs;
}
let active=false;
export const searchSubito:JobsSource = async (occupation,city,parentSignal) => {
 // Technical reachability is not source permission. Deployment must record a
 // review/permission reference. Robots and access gates still apply afterwards.
 if(!process.env.NOVA_JOBS_SUBITO_POLICY_REFERENCE?.trim())throw Error('jobs_policy_unreviewed');
 if(active)throw Error('jobs_busy');active=true;
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 const signal=AbortSignal.any([parentSignal,AbortSignal.timeout(25000)]);
 const stop=()=>{void browser?.close().catch(()=>{});};signal.addEventListener('abort',stop,{once:true});
 try{
  signal.throwIfAborted();const url=subitoURL(occupation,city);
  browser=await chromium.launch({headless:true,timeout:7000});if(signal.aborted)throw Error('jobs_timeout');
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false,userAgent:'NovaJobs/1.0 (public job metadata; no login)'});
  let requests=0;let denied=false;
  await context.route('**/*',async route=>{
   const req=route.request();const address=new URL(req.url());
   if(++requests>3){denied=true;return route.abort();}
   if(req.method()!=='GET'||req.resourceType()!=='document'||address.origin!==ORIGIN||![url,ORIGIN+'/robots.txt'].includes(req.url()))return route.abort();
   return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(3000);page.setDefaultNavigationTimeout(10000);
  const robots=await page.goto(ORIGIN+'/robots.txt',{waitUntil:'domcontentloaded'});
  if(!robots||robots.status()!==200)throw Error('jobs_access_blocked');
  const robotText=await page.locator('body').innerText();if(!robotsAllow(robotText,url))throw Error('jobs_robots_denied');
  signal.throwIfAborted();const response=await page.goto(url,{waitUntil:'domcontentloaded'});
  if(!response||response.status()!==200||page.url()!==url)throw Error('jobs_access_blocked');
  if(denied)throw Error('jobs_request_budget');
  const jobs=await extractSubitoJobs(page,city);signal.throwIfAborted();return jobs;
 }catch(error){if(signal.aborted)throw Error('jobs_timeout');throw error;}
 finally{signal.removeEventListener('abort',stop);try{await browser?.close();}finally{active=false;}}
};
