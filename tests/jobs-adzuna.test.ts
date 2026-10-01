import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAdzunaSearch,adzunaConfigured,adzunaOpportunities,ADZUNA_MAX_PAGES,ADZUNA_PER_PAGE} from '../src/jobs-adzuna.ts';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
// Adzuna official API (owner registered 2026-10-01). The legitimate path that replaces Subito pagination over time.
// Fixture mirrors the real response shape observed live (count, results[].title/company.display_name/location.display_name/created/redirect_url/contract_time/category).
const row=(n:number,title:string,company:string|null,loc:string,created:string,extra:Record<string,unknown>={})=>{const id=5900000000+n;return({id:String(id),title,company:company?{display_name:company}:{},location:{display_name:loc,area:['Italia','Emilia-Romagna','Provincia di Bologna','Bologna']},created,redirect_url:`https://www.adzuna.it/details/${id}?utm_medium=api`,description:'Cercasi '+title+' tel 333 1234567 email x@y.it',category:{label:'Lavori nella Ristorazione'},salary_is_predicted:'0',...extra})};
const page1={count:73,results:[row(1,'Cameriere','Cesari\'s srl','Bologna, Provincia di Bologna','2026-09-29T18:38:23Z',{contract_time:'full_time'}),row(2,'Cameriere/a','Adecco Italia','Bologna, Provincia di Bologna','2026-09-16T15:06:22Z'),row(3,'Cameriere ai piani','Hotel Roma',"Casalecchio di Reno, Provincia di Bologna",'2026-09-30T10:00:00Z'),row(4,'Badante convivente','Privato','Bologna, Provincia di Bologna','2026-09-30T10:00:00Z'),row(5,'Cameriere sala',null,'Bologna, Provincia di Bologna','2026-09-28T10:00:00Z',{salary_min:1400,salary_max:1600})]};
const page2={count:73,results:[row(6,'Cameriere/a di sala','Osteria Bo','Bologna, Provincia di Bologna','2026-09-27T10:00:00Z'),row(1,'Cameriere','Cesari\'s srl','Bologna, Provincia di Bologna','2026-09-29T18:38:23Z')]};
function fakeFetch(log:string[],fail?:(u:URL)=>Response|undefined){return async(input:any)=>{const u=new URL(String(input));log.push(u.pathname+u.search);const f=fail?.(u);if(f)return f;const p=Number(u.pathname.split('/').pop());return new Response(JSON.stringify(p===1?page1:p===2?page2:{count:73,results:[]}),{status:200,headers:{'content-type':'application/json'}})}}
test('configuration: both id and key required; credentials never appear in results or provenance',()=>{
 assert.equal(adzunaConfigured({}),false);assert.equal(adzunaConfigured({NOVA_ADZUNA_APP_ID:'a'}),false);assert.equal(adzunaConfigured({NOVA_ADZUNA_APP_ID:'a',NOVA_ADZUNA_APP_KEY:'b'}),true);
});
test('adapter: one request per page, params bounded, results compact and sanitized; cache by (occupation,city,pages); pages clamp to cap',async()=>{
 const log:string[]=[];const search=createAdzunaSearch({appId:'ID',appKey:'KEY',fetcher:fakeFetch(log),now:()=>1_000});
 const r=await search('cameriere','Bologna',new AbortController().signal);
 assert.equal(log.length,1);const u=new URL('https://x'+log[0]);assert.equal(u.pathname,'/v1/api/jobs/it/search/1');assert.equal(u.searchParams.get('what'),'cameriere');assert.equal(u.searchParams.get('where'),'Bologna');assert.equal(u.searchParams.get('results_per_page'),String(ADZUNA_PER_PAGE));assert.equal(u.searchParams.get('app_id'),'ID');assert.equal(u.searchParams.get('app_key'),'KEY');assert.equal(u.searchParams.get('max_days_old'),'60');assert.equal(u.searchParams.get('sort_by'),'date');
 assert.equal(r.blocked,null);assert.equal(r.count,73);assert.equal(r.pagesRead,1);assert.equal(r.jobs.length,5);
 const j=r.jobs[0];assert.deepEqual(Object.keys(j).sort(),['company','contract','created','id','locality','province','salary','title','url'].sort(),'compact shape, no description');
 assert.equal(j.company,"Cesari's srl");assert.equal(j.locality,'Bologna');assert.equal(j.province,'Provincia di Bologna');assert.equal(j.contract,'full_time');assert.equal(j.url,'https://www.adzuna.it/details/5900000001');assert.equal(j.id,'5900000001','10-digit ids survive sanitization (live regression)');
 assert.equal(r.jobs[4].company,null);assert.deepEqual(r.jobs[4].salary,{min:1400,max:1600});
 assert.ok(!JSON.stringify(r).includes('KEY')&&!JSON.stringify(r).includes('333 1234567'),'no secrets, no description/contacts');
 const more=await search('cameriere','Bologna',new AbortController().signal,{pages:9});assert.equal(more.pagesRead,2,'fixture page 3 is empty → 2 pages counted');assert.equal(log.filter(l=>l.includes('/search/')).length,1+ADZUNA_MAX_PAGES,'cache miss for a different page depth → requests 1..cap, never page 4 even if 9 asked');
 assert.equal(more.jobs.length,6,'duplicate id across pages deduped');
 const hit=await search('Cameriere','bologna',new AbortController().signal,{pages:3});assert.equal(hit.cache,'hit');
});
test('adapter: 401/429/5xx and network failure → truthful blocked codes, never fabricated jobs; empty page stops pagination early',async()=>{
 for(const [status,code] of [[401,'adzuna_auth'],[429,'adzuna_rate_limited'],[503,'adzuna_unavailable']] as const){const search=createAdzunaSearch({appId:'a',appKey:'b',fetcher:async()=>new Response('{}',{status})});const r=await search('cameriere','Bologna',new AbortController().signal);assert.equal(r.blocked,code);assert.equal(r.jobs.length,0)}
 const net=createAdzunaSearch({appId:'a',appKey:'b',fetcher:async()=>{throw Error('ECONNRESET')}});assert.equal((await net('cameriere','Bologna',new AbortController().signal)).blocked,'adzuna_unavailable');
 const log:string[]=[];const search=createAdzunaSearch({appId:'a',appKey:'b',fetcher:fakeFetch(log,u=>u.pathname.endsWith('/2')?new Response(JSON.stringify({count:5,results:[]}),{status:200}):undefined)});
 const r=await search('cameriere','Bologna',new AbortController().signal,{pages:3});assert.equal(r.pagesRead,1,'empty page 2 is not counted');assert.equal(log.length,2,'page 3 never requested after an empty page 2');
});
test('opportunities: title relevance filter, city vs province, agencies classified, company kept, never DIRECT_EMPLOYER without evidence, EXPIRED never claimed',async()=>{
 const search=createAdzunaSearch({appId:'a',appKey:'b',fetcher:fakeFetch([])});
 const r=await adzunaOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:false},new AbortController().signal);
 assert.equal(r.provenance.offQuery,1,'Badante excluded by title relevance');assert.equal(r.opportunities.length,4);
 const byTitle=Object.fromEntries(r.opportunities.map(o=>[o.title,o]));
 assert.equal(byTitle['Cameriere'].company,"Cesari's srl");assert.equal(byTitle['Cameriere'].publisher_type,'UNKNOWN','a company name is not proof of direct employer');assert.equal(byTitle['Cameriere'].locationMatch,'CITY');assert.equal(byTitle['Cameriere'].sourceName,'Adzuna');assert.equal(byTitle['Cameriere'].verification_status,'LISTING_OBSERVED');assert.equal(byTitle['Cameriere'].datePosted,'2026-09-29');
 assert.equal(byTitle['Cameriere/a'].publisher_type,'STAFFING_AGENCY','Adecco classified from the company name');
 assert.equal(byTitle['Cameriere ai piani'].locationMatch,'PROVINCE_OR_REGION');
 for(const o of r.opportunities){assert.notEqual(o.publisher_type,'DIRECT_EMPLOYER');assert.equal(o.status,'UNKNOWN');assert.match(o.source_url,/^https:\/\/www\.adzuna\.it\/details\/\d+$/)}
 const strict=await adzunaOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:true},new AbortController().signal);assert.equal(strict.opportunities.length,0);assert.equal(strict.excludedNonDirect,4);
 assert.ok(!JSON.stringify(r).includes('app_key'));
});
test('native dispatcher: Adzuna results merge with the other sources, provenance names the source, and "altre offerte" extends Adzuna pages too',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const log:string[]=[];
 const adzuna=createAdzunaSearch({appId:'a',appKey:'b',fetcher:fakeFetch(log)});
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',jobsAdzuna:adzuna,jobsSubito:null,search:async()=>({sources:[]}),jobPageAccess:{authorizedOrigins:[],jsonLd:false,fetcher:async()=>new Response('',{status:404})},provider:{complete:async(messages:any[])=>{
  if(messages.at(-1).role==='tool'){const r=JSON.parse(messages.at(-1).content);return {role:'assistant',content:`RESULT ${r.status} ${(r.opportunities||[]).length} adzuna=${r.adzuna?.pagesRead}`}}
  const text=messages.at(-1).content;if(/^Bologna$/i.test(text)||/altre offerte/i.test(text))return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'jobs_search',arguments:JSON.stringify({query:'cameriere',city:'Bologna'})}}]};
  return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'ask_question',arguments:JSON.stringify({text:'Città?'})}}]};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Adzuna'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());let run:any;for(let i=0;i<600;i++){run=(await db.pool.query('SELECT * FROM agent_runs WHERE id=$1',[t.body.id])).rows[0];if(!['queued','running'].includes(run.status))break;await new Promise(r=>setTimeout(r,10))}sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;const ev=(await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items;return {run,jobs:ev.filter((e:any)=>e.kind==='tool.succeeded'&&e.detail?.tool==='jobs_search').map((e:any)=>e.detail.result),last:(await db.pool.query("SELECT text FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY sequence DESC LIMIT 1",[c.id])).rows[0].text}}
  await turn('Cerco lavoro come cameriere');const first=await turn('Bologna');
  assert.equal(first.run.status,'completed');assert.equal(first.jobs[0].status,'ok');assert.equal(first.jobs[0].opportunities.length,4);assert.equal(first.jobs[0].adzuna.pagesRead,1);assert.equal(first.jobs[0].adzuna.count,73);assert.ok(first.jobs[0].opportunities.every((o:any)=>o.sourceName==='Adzuna'));
  const more=await turn('Voglio altre offerte');assert.equal(more.run.status,'completed',more.run.error_code);assert.equal(more.jobs[0].moreOffers,true);assert.equal(more.jobs[0].adzuna.pagesRead,2,'stops at the empty page 3');assert.equal(more.jobs[0].opportunities.length,5);assert.match(more.last,/adzuna=2/);
 }finally{await app.close();await db.close()}
});

test('renderer: Adzuna card shows source chip, employer, date, contract, declared salary; textContent only; public and staging renderers identical',async()=>{
 const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const stg=await readFile(new URL('../staging/jobs-generic-1/app.js',import.meta.url),'utf8');
 const rx=/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/;assert.equal(code.match(rx)![0],stg.match(rx)![0],'renderers in sync');
 const o={title:'Cameriere <b>x</b>',city:'Bologna',source_url:'https://www.adzuna.it/details/1',publisher_type:'UNKNOWN',verification_status:'LISTING_OBSERVED',status:'UNKNOWN',observed_at:'2026-10-01T07:00:00.000Z',locationMatch:'CITY',sourceName:'Adzuna',company:"Cesari's srl",datePosted:'2026-09-29',employmentType:'FULL_TIME',salary:{min:1400,max:1600}};
 const events=[{kind:'tool.succeeded',detail:{tool:'jobs_search',result:{status:'ok',occupation:'cameriere',city:'Bologna',opportunities:[o],adzuna:{count:73,pagesRead:1}}}}];
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(t,s,c){const n=document.createElement(t);if(s!==undefined)n.textContent=s;if(c)n.className=c;return n}"+code.match(rx)![0]});
  await page.evaluate(e=>(window as any).renderJobReceipts(e),events);const text=await page.locator('#messages').innerText();
  for(const t of ['Adzuna',"Cesari's srl",'29/09/2026','Tempo pieno','1400 € – 1600 €','API ufficiale','Adzuna segnala 73 annunci'])assert.ok(text.includes(t),t);
  assert.equal(await page.locator('#messages b').count(),0,'title rendered as text, not HTML');assert.equal(await page.locator('a[href="https://www.adzuna.it/details/1"]').count(),1);
 }finally{await browser.close()}
});
