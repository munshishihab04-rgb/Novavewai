import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {createSubitoSearch,subitoListUrl,subitoOpportunities,subitoAutomatedAccessAccepted} from '../src/jobs-subito-playwright.ts';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';
// Minimal synthetic fixture with the DOM shape observed in evidence/subito-claude-1/dom-inspection.json
// (article card → a[href$=".htm"], h3 title, span "Comune (BO)"); no real Subito HTML is committed.
const card=(slug:string,id:number,title:string,loc:string,extra='')=>`<article class="index-module_card__x AdItem-module_adItemCard"><a class="index-module_link__y" href="/offerte-lavoro/${slug}-${id}.htm"><div><h3 class="index-module_subject__z">${title}</h3><span class="index-module_location__w">${loc}</span><span>Ristorazione</span>${extra}</div></a></article>`;
const listHtml=(origin:string)=>`<!doctype html><html lang="it"><head><title>Subito.it Cameriere - Offerte di lavoro a Bologna e provincia</title></head><body><div data-testid="listing-container">
${card('cameriere-bologna',658333217,'Cameriere','Bologna (BO)')}
${card('cameriere-bologna',658333217,'Cameriere','Bologna (BO)','<span>Vetrina</span>')}
${card('cameriere-di-sala-castel-maggiore',662640160,'Cameriere/a di sala 333 1234567','Castel Maggiore (BO)','<span>Azienda verificata</span>')}
${card('addetto-sala-bologna',659128027,'Cameriere di sala – Agenzia per il lavoro Manpower','Bologna (BO)')}
<article><a href="/utente/12345"><h3>Profilo utente</h3></a></article>
<article><a href="${origin}/offerte-lavoro/cameriere-bologna-1.htm?o=2"><h3>Con query</h3></a></article>
<a href="/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/?q=cameriere&o=2">Pagina 2</a>
<script>fetch('/api/track').catch(()=>{});</script><img src="/img/x.png"></div></body></html>`;
async function fixture(handler?:(url:string,res:any)=>boolean){const hits:string[]=[];const s=createServer((req,res)=>{hits.push(req.url!);if(handler&&handler(req.url!,res))return;if(/^\/annunci-/.test(req.url!)){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(listHtml(`http://127.0.0.1:${(s.address() as any).port}`));return}res.statusCode=404;res.end('nf')});await new Promise<void>(r=>s.listen(0,'127.0.0.1',()=>r()));return {origin:`http://127.0.0.1:${(s.address() as any).port}`,hits,close:()=>s.close()}}
test('subito flag: absent or wrong value disables; exact owner value enables; list URL uses known province path else national query',()=>{
 assert.equal(subitoAutomatedAccessAccepted({}),false);assert.equal(subitoAutomatedAccessAccepted({NOVA_JOBS_SUBITO_AUTOMATED_ACCESS:'yes'}),false);assert.equal(subitoAutomatedAccessAccepted({NOVA_JOBS_SUBITO_AUTOMATED_ACCESS:' owner-accepted '}),true);
 assert.equal(subitoListUrl('cameriere','Bologna'),'https://www.subito.it/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/?q=cameriere');
 assert.equal(subitoListUrl('saldatore','Modena'),'https://www.subito.it/annunci-italia/vendita/offerte-lavoro/?q=saldatore%20Modena');
 assert.throws(()=>subitoListUrl('x','Bologna'));assert.throws(()=>subitoListUrl('cameriere','https://evil'));
});
test('subito adapter: parses cards from fixture, dedupes Vetrina, ignores /utente and ?o=, never paginates, no phone stored, cache hit avoids second navigation, badges → publisher',async()=>{
 const f=await fixture();let launches=0;
 try{
  const search=createSubitoSearch({origin:f.origin,pauseMs:[10,20],launch:async()=>{launches++;return chromium.launch({headless:true})}});
  const obs=await search('cameriere','Bologna',new AbortController().signal);
  assert.equal(obs.blocked,null);assert.equal(obs.cache,'live');assert.equal(obs.navigations,1);
  assert.deepEqual(obs.cards.map(c=>c.url),[`${f.origin}/offerte-lavoro/cameriere-bologna-658333217.htm`,`${f.origin}/offerte-lavoro/cameriere-di-sala-castel-maggiore-662640160.htm`,`${f.origin}/offerte-lavoro/addetto-sala-bologna-659128027.htm`]);
  assert.equal(obs.cards[1].title,'Cameriere/a di sala [omesso]');assert.equal(obs.cards[1].locality,'Castel Maggiore');assert.equal(obs.cards[1].provinceCode,'BO');assert.equal(obs.cards[1].publisherHint,'AZIENDA_VERIFICATA');assert.equal(obs.cards[2].publisherHint,'AGENZIA');assert.equal(obs.cards[0].publisherHint,null);
  assert.ok(!f.hits.some(h=>/[?&]o=/.test(h)),'pagination never requested: '+f.hits.join(','));assert.ok(!f.hits.some(h=>h.startsWith('/utente')));assert.ok(!f.hits.some(h=>h.includes('.htm')),'no detail page opened');assert.ok(!f.hits.some(h=>h.includes('/img/')),'images aborted');
  assert.equal(f.hits.filter(h=>h.startsWith('/annunci-')).length,1);
  const again=await search('Cameriere','bologna',new AbortController().signal);assert.equal(again.cache,'hit');assert.equal(launches,1);assert.equal(f.hits.filter(h=>h.startsWith('/annunci-')).length,1);
  const r=await subitoOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:false},new AbortController().signal);
  assert.equal(r.opportunities.length,3);for(const o of r.opportunities){assert.equal(o.verification_status,'LISTING_OBSERVED');assert.equal(o.status,'UNKNOWN');assert.equal(o.last_verified_at,null);assert.notEqual(o.publisher_type,'DIRECT_EMPLOYER')}
  assert.equal(r.opportunities[0].locationMatch,'CITY');assert.equal(r.opportunities[1].locationMatch,'PROVINCE_OR_REGION');assert.equal(r.opportunities[1].publisher_type,'UNKNOWN');assert.equal(r.opportunities[2].publisher_type,'STAFFING_AGENCY');assert.equal(r.replacesSearchLink,true);
  const strict=await subitoOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:true},new AbortController().signal);assert.equal(strict.opportunities.length,0);assert.equal(strict.excludedNonDirect,3);
 }finally{f.close()}
});
test('subito adapter: 403 and captcha page report truthful block codes, no results; cancelled signal aborts before launch',async()=>{
 let mode='403';const f=await fixture((url,res)=>{if(!/^\/annunci-/.test(url))return false;if(mode==='403'){res.statusCode=403;res.end('forbidden');return true}if(mode==='captcha'){res.writeHead(200,{'content-type':'text/html'});res.end('<html><body>Please verify you are human<iframe src="https://x.example/captcha"></iframe></body></html>');return true}return false});
 try{
  const search=createSubitoSearch({origin:f.origin,pauseMs:[10,20]});
  let r=await subitoOpportunities(search,{occupation:'cuoco',city:'Bologna',noAgencies:false},new AbortController().signal);assert.equal(r.opportunities.length,0);assert.equal(r.sourceUnavailable?.code,'jobs_access_blocked');assert.equal(r.provenance.blocked,'http 403');
  mode='captcha';r=await subitoOpportunities(search,{occupation:'barista',city:'Bologna',noAgencies:false},new AbortController().signal);assert.equal(r.sourceUnavailable?.code,'jobs_access_blocked');assert.equal(r.provenance.blocked,'jobs_access_blocked');
  let launched=0;const ac=new AbortController();ac.abort();await assert.rejects(createSubitoSearch({origin:f.origin,launch:async()=>{launched++;return chromium.launch()}})('cuoco','Bologna',ac.signal));assert.equal(launched,0);
  const remote=await subitoOpportunities(search,{occupation:'customer care',city:'',noAgencies:false,remote:true},new AbortController().signal);assert.equal(remote.opportunities.length,0);
 }finally{f.close()}
});
const call=(query:string,city:string)=>({id:randomUUID(),type:'function' as const,function:{name:'jobs_search',arguments:JSON.stringify({query,city})}});
async function settled(pool:any,id:string){for(let i=0;i<800;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
test('native dispatcher: flag off → Subito search link only; injected adapter on → LISTING_OBSERVED cards replace the Subito link and render with the Subito label in both renderers',async()=>{
 const f=await fixture();const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
 const provider={complete:async(m:any[])=>m.at(-1).role==='tool'?{role:'assistant',content:'Ecco.'}:{role:'assistant',content:null,tool_calls:[call('cameriere','Bologna')]}};
 const apps:any[]=[];
 try{
  delete process.env.NOVA_JOBS_SUBITO_AUTOMATED_ACCESS;
  const off=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled',provider,search:async()=>({sources:[]}),jobPageAccess:{authorizedOrigins:[],fetcher:async()=>new Response('',{status:404})}}} as any);apps.push(off);
  let base=await off.listen({port:0,host:'127.0.0.1'});let c=(await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID())).body;let t=(await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:0,text:'cameriere a Bologna'},'POST',randomUUID())).body;let run=await settled(db.pool,t.id);assert.equal(run.status,'completed');
  let result=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='jobs_search'",[run.id])).rows[0].result;
  assert.equal(result.status,'search_links_only');assert.equal(result.opportunities,undefined);assert.ok(result.searchLinks.some((l:any)=>l.url.startsWith('https://www.subito.it/')));assert.equal(result.subito,undefined);assert.equal(f.hits.length,0);
  await off.close();apps.length=0;
  let launches=0;const on=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled',provider,search:async()=>({sources:[]}),jobPageAccess:{authorizedOrigins:[],fetcher:async()=>new Response('',{status:404})},jobsSubito:createSubitoSearch({origin:f.origin,pauseMs:[10,20],launch:async()=>{launches++;return chromium.launch({headless:true})}})}} as any);apps.push(on);
  base=await on.listen({port:0,host:'127.0.0.1'});c=(await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID())).body;t=(await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:0,text:'cameriere a Bologna'},'POST',randomUUID())).body;run=await settled(db.pool,t.id);assert.equal(run.status,'completed');
  result=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='jobs_search'",[run.id])).rows[0].result;
  assert.equal(result.status,'ok');assert.equal(result.opportunities.length,3);assert.equal(result.opportunities[0].verification_status,'LISTING_OBSERVED');assert.equal(result.subito.cardsObserved,3);assert.equal(result.subito.navigations,1);assert.ok(!result.searchLinks.some((l:any)=>l.url.startsWith('https://www.subito.it/')),'Subito search link replaced by cards');assert.equal(launches,1);
  const events=(await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items;assert.ok(events.some((e:any)=>e.kind==='tool.succeeded'&&e.detail?.result?.opportunities?.length===3),JSON.stringify(events.map((e:any)=>[e.kind,e.detail?.tool,e.detail?.result?.status,e.detail?.result?.opportunities?.length])).slice(0,600));
  // The renderer only links https public hosts (loopback fixture URLs are correctly refused), so map fixture URLs to the real origin shape for the rendering check.
  const rendered=JSON.parse(JSON.stringify(events).split(f.origin).join('https://www.subito.it'));
  for(const file of ['../public/app.js','../staging/jobs-generic-1/app.js']){
   const code=await readFile(new URL(file,import.meta.url),'utf8');const renderer=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/)![0];
   const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(t,s,c){const n=document.createElement(t);if(s!==undefined)n.textContent=s;if(c)n.className=c;return n}"+renderer});await page.evaluate(e=>(window as any).renderJobReceipts(e),rendered);
    const text=await page.locator('#messages').innerText();assert.equal(await page.locator('a:has-text("Apri annuncio originale")').count(),3,file);
    assert.ok(text.includes('Annuncio osservato su Subito · disponibilità non verificata · Inserzionista sconosciuto'),file);assert.ok(text.includes('Annuncio osservato su Subito · disponibilità non verificata · Agenzia'));assert.ok(text.includes('Castel Maggiore (BO)'));assert.ok(/Provincia · non Bologna/i.test(text));assert.ok(!text.includes('Datore diretto'));assert.ok(!text.includes('1234567'));
   }finally{await browser.close()}
  }
 }finally{for(const a of apps)await a.close();await db.close();f.close()}
});

test('cards whose title does not mention the requested occupation are set aside as off-query, not shown as matches',async()=>{
 const {titleMatchesOccupation}=await import('../src/jobs-subito-playwright.ts');
 assert.equal(titleMatchesOccupation('Badante colf','cameriere'),false);
 assert.equal(titleMatchesOccupation('Cameriere/a di sala','cameriere'),true);
 assert.equal(titleMatchesOccupation('CAMERIERA/E AI PIANI HOTEL','cameriere'),true);
 assert.equal(titleMatchesOccupation('Barista/ cameriere','cameriere'),true);
 assert.equal(titleMatchesOccupation('Addetto/a alla ristorazione','cameriere'),false);
 assert.equal(titleMatchesOccupation('Saldatore a filo','saldatore'),true);
 assert.equal(titleMatchesOccupation('Operaio metalmeccanico','saldatore'),false);
 assert.equal(titleMatchesOccupation('Sviluppatore web','programmatore'),false);
 assert.equal(titleMatchesOccupation('Programmatrice PLC','programmatore'),true);
 const search=async()=>({listUrl:'https://www.subito.it/x',observedAt:'2026-09-30T00:00:00Z',cache:'live' as const,navigations:1,blocked:null,cards:[
  {title:'Cameriere',url:'https://www.subito.it/offerte-lavoro/cameriere-bologna-1.htm',locality:'Bologna',provinceCode:'BO',publisherHint:null},
  {title:'Badante colf',url:'https://www.subito.it/offerte-lavoro/badante-colf-bologna-2.htm',locality:'Bologna',provinceCode:'BO',publisherHint:null}]});
 const r=await subitoOpportunities(search as any,{occupation:'cameriere',city:'Bologna',noAgencies:false},new AbortController().signal);
 assert.deepEqual(r.opportunities.map(o=>o.title),['Cameriere']);
 assert.equal((r.provenance as any).offQuery,1);
});
