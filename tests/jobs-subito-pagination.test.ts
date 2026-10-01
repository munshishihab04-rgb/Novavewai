import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {chromium} from 'playwright';
import {createSubitoSearch,subitoOpportunities,subitoPaginationAccepted,SUBITO_MAX_PAGES} from '../src/jobs-subito-playwright.ts';
import {wantsMoreOffers} from '../src/jobs-live.ts';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';
// Owner decision B (docs/decisions/2026-10-01-subito-pagination.md): bounded pagination, ONLY after an explicit
// "more offers" request, max 3 pages, behind its own flag. First search stays page-1 only.
const card=(slug:string,id:number,title:string,loc:string)=>`<article class="AdItem-module_adItemCard"><a href="/offerte-lavoro/${slug}-${id}.htm"><div><h3>${title}</h3><span>${loc}</span></div></a></article>`;
function pageHtml(page:number){const cards=[];for(let i=0;i<(page<3?30:7);i++){const id=page*1000+i;cards.push(card('cameriere-bologna',id,`Cameriere ${id}`,'Bologna (BO)'))}
 if(page===2)cards.push(card('cameriere-bologna',1000,'Cameriere 1000 (ripetuto)','Bologna (BO)'));// Vetrina repeat from page 1 → dedup
 return `<!doctype html><html><body><div data-testid="listing-container">${cards.join('')}</div><a href="?q=cameriere&o=${page+1}">Pagina ${page+1}</a></body></html>`}
async function fixture(){const hits:string[]=[];const s=createServer((req,res)=>{hits.push(req.url!);if(/^\/annunci-/.test(req.url!)){const m=req.url!.match(/[?&]o=(\d+)/);const page=m?Number(m[1]):1;if(page>4){res.statusCode=404;res.end('nf');return}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(pageHtml(page));return}res.statusCode=404;res.end('nf')});await new Promise<void>(r=>s.listen(0,'127.0.0.1',()=>r()));return {origin:`http://127.0.0.1:${(s.address() as any).port}`,hits,close:()=>s.close()}}
test('pagination flag: separate from the access flag; exact value only',()=>{
 assert.equal(subitoPaginationAccepted({}),false);assert.equal(subitoPaginationAccepted({NOVA_JOBS_SUBITO_AUTOMATED_ACCESS:'owner-accepted'}),false,'access flag alone does not enable pagination');
 assert.equal(subitoPaginationAccepted({NOVA_JOBS_SUBITO_PAGINATION:'owner-accepted'}),true);assert.equal(subitoPaginationAccepted({NOVA_JOBS_SUBITO_PAGINATION:'yes'}),false);assert.equal(SUBITO_MAX_PAGES,3);
});
test('adapter: first search reads page 1 only (30 cards kept, not 20); pages=3 reads o=2,o=3 with pause, dedupes repeats, stops at the cap; pagination off → page 1 even when asked',async()=>{
 const f=await fixture();try{
  const search=createSubitoSearch({origin:f.origin,pauseMs:[10,20],pagination:true,launch:()=>chromium.launch({headless:true})});
  const first=await search('cameriere','Bologna',new AbortController().signal);
  assert.equal(first.blocked,null);assert.equal(first.navigations,1);assert.equal(first.cards.length,30,'whole page 1 kept');assert.equal(first.pagesRead,1);
  assert.equal(f.hits.filter(h=>/[?&]o=/.test(h)).length,0,'first search never paginates');
  const more=await search('cameriere','Bologna',new AbortController().signal,undefined,{pages:3});
  assert.equal(more.cache,'live');assert.equal(more.pagesRead,3);assert.equal(more.navigations,3);
  assert.deepEqual(f.hits.filter(h=>/[?&]o=/.test(h)).map(h=>h.match(/o=(\d+)/)![1]),['2','3'],'pages 2 and 3 only, never 4');
  assert.equal(more.cards.length,30+30+7,'repeated Vetrina card deduped');assert.equal(new Set(more.cards.map(c=>c.url)).size,more.cards.length);
  const cached=await search('cameriere','Bologna',new AbortController().signal,undefined,{pages:3});assert.equal(cached.cache,'hit');assert.equal(cached.cards.length,67);
  const cappedAgain=await search('cameriere','Bologna',new AbortController().signal,undefined,{pages:9});assert.equal(cappedAgain.cache,'hit','pages above the cap are clamped to 3 → same cache key');
  const off=createSubitoSearch({origin:f.origin,pauseMs:[10,20],pagination:false,launch:()=>chromium.launch({headless:true})});const hitsBefore=f.hits.length;
  const denied=await off('barista','Bologna',new AbortController().signal,undefined,{pages:3});assert.equal(denied.pagesRead,1);assert.ok(!f.hits.slice(hitsBefore).some(h=>/[?&]o=/.test(h)),'flag off → no o= request even when more pages are asked');
  const r=await subitoOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:false},new AbortController().signal,undefined,{pages:3});
  assert.ok(r.opportunities.length>=30,'more than the old 12-card cap when the user asked for more: '+r.opportunities.length);assert.equal(r.provenance.pagesRead,3);assert.match(r.provenance.policy,/pagination/i);
 }finally{f.close()}
});
test('wantsMoreOffers: Italian, Banglish, Bangla, English; not for new roles or first requests',()=>{
 for(const t of ['Voglio altre offerte','altre offerte, anche in provincia','ce ne sono altre?','Aro offer dekhaw','aro dekhao','aro kaj dekhaw','আরো দেখাও','more offers please','show me more','ancora','di più','altri annunci'])assert.equal(wantsMoreOffers(t),true,t);
 for(const t of ['Barista','Cerco lavoro come cameriere','Bologna','part time','grazie','Sii','Vuoi che includa anche part-time?'])assert.equal(wantsMoreOffers(t),false,t);
});
test('native dispatcher: "altre offerte" after a search re-runs jobs_search with pages=3 for the SAME occupation+city (not a duplicate-suppressed retry) and the receipt says how many pages were read',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const pagesSeen:number[]=[];
 const fakeSubito=async(occ:string,city:string,_s:AbortSignal,_b?:()=>Promise<void>,opts?:{pages?:number})=>{const pages=opts?.pages??1;pagesSeen.push(pages);const n=pages===1?10:25;return {listUrl:'https://www.subito.it/x',observedAt:new Date().toISOString(),cache:'live' as const,cards:Array.from({length:n},(_,i)=>({title:`Cameriere ${i}`,url:`https://www.subito.it/offerte-lavoro/cameriere-bologna-${100+i}.htm`,locality:'Bologna',provinceCode:'BO',publisherHint:null})),blocked:null,navigations:pages,pagesRead:pages}};
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',jobsSubito:fakeSubito,search:async()=>({sources:[]}),jobPageAccess:{authorizedOrigins:[],jsonLd:false,fetcher:async()=>new Response('',{status:404})},provider:{complete:async(messages:any[])=>{
  if(messages.at(-1).role==='tool'){const r=JSON.parse(messages.at(-1).content);return {role:'assistant',content:`RESULT ${r.status} ${(r.opportunities||[]).length} pages=${r.subito?.pagesRead}`}}
  const text=messages.at(-1).content;if(/^Bologna$/i.test(text)||/altre offerte/i.test(text))return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'jobs_search',arguments:JSON.stringify({query:'cameriere',city:'Bologna'})}}]};
  return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'ask_question',arguments:JSON.stringify({text:'In quale città?'})}}]};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'More'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());assert.equal(t.status,201);let run:any;for(let i=0;i<500;i++){run=(await db.pool.query('SELECT * FROM agent_runs WHERE id=$1',[t.body.id])).rows[0];if(!['queued','running'].includes(run.status))break;await new Promise(r=>setTimeout(r,10))}sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;const ev=(await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items;return {run,jobs:ev.filter((e:any)=>e.kind==='tool.succeeded'&&e.detail?.tool==='jobs_search').map((e:any)=>e.detail.result),last:(await db.pool.query("SELECT text FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY sequence DESC LIMIT 1",[c.id])).rows[0].text}}
  await turn('Cerco lavoro come cameriere');
  const first=await turn('Bologna');assert.equal(first.jobs[0].status,'ok');assert.equal(first.jobs[0].opportunities.length,10);assert.equal(first.jobs[0].subito.pagesRead,1);
  const more=await turn('Voglio altre offerte');
  assert.equal(more.jobs.length,1,'a real second search, not jobs_retry_suppressed');assert.equal(more.jobs[0].status,'ok');assert.equal(more.jobs[0].subito.pagesRead,3);assert.equal(more.jobs[0].opportunities.length,25);
  assert.deepEqual(pagesSeen,[1,3]);assert.match(more.last,/pages=3/);
  assert.equal(more.jobs[0].moreOffers,true,'receipt flags that this is the extended search');
 }finally{await app.close();await db.close()}
});

test('extended (moreOffers) result near the context budget does not fail the run with context_budget (observed live for Milano); a first search of the same size still respects the normal budget',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
 const big=(pages:number)=>({listUrl:'https://www.subito.it/x',observedAt:new Date().toISOString(),cache:'live' as const,cards:Array.from({length:pages===1?30:90},(_,i)=>({title:`Cameriere di sala con esperienza turno serale ${i}`,url:`https://www.subito.it/offerte-lavoro/cameriere-milano-${500+i}.htm`,locality:'Milano',provinceCode:'MI',publisherHint:null})),blocked:null,navigations:pages,pagesRead:pages});
 const fakeSubito=async(_o:string,_c:string,_s:AbortSignal,_b?:()=>Promise<void>,opts?:{pages?:number})=>big(opts?.pages??1);
 const mk=(maxContextBytes:number)=>buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',maxContextBytes,jobsSubito:fakeSubito,search:async()=>({sources:[]}),jobPageAccess:{authorizedOrigins:[],jsonLd:false,fetcher:async()=>new Response('',{status:404})},provider:{complete:async(messages:any[])=>{
  if(messages.at(-1).role==='tool'){const r=JSON.parse(messages.at(-1).content);return {role:'assistant',content:`RESULT ${(r.opportunities||[]).length}`}}
  const text=messages.at(-1).content;if(/^Milano$/i.test(text)||/altre offerte/i.test(text))return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'jobs_search',arguments:JSON.stringify({query:'cameriere',city:'Milano'})}}]};
  return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'ask_question',arguments:JSON.stringify({text:'Città?'})}}]};
 }}}} as any);
 // Budget sized so that the 30-card first result fits but the 90-card extended one would not without the headroom.
 const app=mk(48000);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Budget'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());let run:any;for(let i=0;i<600;i++){run=(await db.pool.query('SELECT * FROM agent_runs WHERE id=$1',[t.body.id])).rows[0];if(!['queued','running'].includes(run.status))break;await new Promise(r=>setTimeout(r,10))}sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;const ev=(await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items;return {run,jobs:ev.filter((e:any)=>e.kind==='tool.succeeded'&&e.detail?.tool==='jobs_search').map((e:any)=>e.detail.result)}}
  await turn('Cerco lavoro come cameriere');const first=await turn('Milano');assert.equal(first.run.status,'completed');assert.equal(first.jobs[0].opportunities.length,30);
  const more=await turn('Voglio altre offerte');assert.equal(more.run.status,'completed',more.run.error_code);assert.equal(more.jobs[0].moreOffers,true);assert.equal(more.jobs[0].opportunities.length,60,'extended Subito receipt is bounded to 60 cards (90 observed) so the context budget holds with Adzuna alongside');
 }finally{await app.close();await db.close()}
});

test('renderer: the extended search gets its own summary ("ricerca estesa · N pagine Subito lette") instead of being hidden behind the first summary',async()=>{
 const {readFile}=await import('node:fs/promises');const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const renderer=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/)![0];
 const card=(i:number)=>({title:`Cameriere ${i}`,city:'Milano',source_url:`https://www.subito.it/offerte-lavoro/cameriere-milano-${i}.htm`,publisher_type:'UNKNOWN',verification_status:'LISTING_OBSERVED',status:'UNKNOWN',observed_at:'2026-10-01T06:00:00.000Z',locationMatch:'CITY',sourceName:'Subito'});
 const events=[{kind:'tool.succeeded',detail:{tool:'jobs_search',result:{status:'ok',occupation:'cameriere',city:'Milano',opportunities:[card(1),card(2)],subito:{pagesRead:1}}}},{kind:'tool.succeeded',detail:{tool:'jobs_search',result:{status:'ok',occupation:'cameriere',city:'Milano',moreOffers:true,opportunities:[card(1),card(2),card(3),card(4),card(5)],subito:{pagesRead:3}}}}];
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(t,s,c){const n=document.createElement(t);if(s!==undefined)n.textContent=s;if(c)n.className=c;return n}"+renderer});
  await page.evaluate(e=>(window as any).renderJobReceipts(e),events);const text=await page.locator('#messages').innerText();
  assert.match(text,/2 annunci trovati/);assert.match(text,/5 annunci trovati · ricerca estesa/);assert.match(text,/3 pagine Subito lette/);
  assert.equal(await page.locator('.job-summary').count(),2);assert.equal(await page.locator('.job-card a[href$=".htm"]').count(),5,'cards are deduped by URL across both receipts');
 }finally{await browser.close()}
});
