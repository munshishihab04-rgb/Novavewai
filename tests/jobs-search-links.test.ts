import test from 'node:test';
import assert from 'node:assert/strict';
import {webJobCandidates} from '../src/jobs.ts';
import {chromium} from 'playwright';

test('search-link receipts render only labelled browsing suggestions, never opportunity cards, in the public renderer',async()=>{
 const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const renderer=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/);assert.ok(renderer);
 const result=webJobCandidates({sources:[{title:'Jobs index',url:'https://example.org/jobs'}]},'cameriere','Bologna');
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');
  await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}"+renderer[0]});
  await page.evaluate(result=>(window as any).renderJobReceipts([{kind:'tool.succeeded',detail:{tool:'jobs_search',result}}]),result);
  const text=await page.locator('#messages').innerText();
  assert.equal(await page.locator('a:has-text("Apri annuncio originale")').count(),0);
  assert.equal(await page.locator('a:has-text("Apri ricerca sulla fonte originale")').count(),1);
  assert.match(text,/non è un annuncio/);
  assert.doesNotMatch(text,/Datore diretto|Stato: /);
 }finally{await browser.close()}
});

import {readFile} from 'node:fs/promises';

test('historical search citations exclude closed InfoJobs Italia, preserving only browsing suggestions',async()=>{
 const historical=JSON.parse(await readFile(new URL('../evidence/jobs-repair-1/bounded-live-candidates.json',import.meta.url),'utf8'));
 const sources=historical.result.opportunities.map((row:any)=>({title:row.title,url:row.source_url}));
 const result:any=webJobCandidates({sources,checkedAt:historical.queriedAt},'cameriere','Bologna');
 assert.equal(result.searchLinks.length,3);
 assert.ok(result.searchLinks.every((link:any)=>!new URL(link.url).hostname.endsWith('infojobs.it')));
 assert.equal(result.opportunities?.length??0,0);
 const variants:any=webJobCandidates({sources:['https://infojobs.it/','https://WWW.INFOJOBS.IT/jobs','https://other.infojobs.it/jobs'].map(url=>({title:'Closed site',url}))},'cameriere','Bologna');
 assert.deepEqual(variants.searchLinks,[]);
 assert.equal(variants.status,'search_links_only');
});

test('discovery examines at most six citations, rejects unsafe links and deduplicates fragments',()=>{
 const sources=[{title:'Local',url:'https://127.0.0.1/jobs'},{title:'One',url:'https://example.org/jobs#one'},{title:'Duplicate',url:'https://example.org/jobs#two'},...Array.from({length:5},(_,i)=>({title:`Index ${i}`,url:`https://example.org/search?q=${i}`}))];
 const result=webJobCandidates({sources},'cameriere','Bologna');
 assert.deepEqual(result.searchLinks?.map(link=>link.url),['https://example.org/jobs','https://example.org/search?q=0','https://example.org/search?q=1','https://example.org/search?q=2']);
});

const checkedAt='2026-09-30T17:13:25.746Z';
test('citation-only discovery never creates vacancies or observed job locations, even for detail-shaped URLs',()=>{
 const result:any=webJobCandidates({checkedAt,sources:[
  {title:'Offerte cameriere Bologna',url:'https://it.indeed.com/offerte-lavoro?q=cameriere&l=Bologna'},
  {title:'Cameriere Milano',url:'https://example.org/jobs/123'},
 ]},'cameriere','Bologna');
 assert.equal(result.opportunities?.length??0,0);
 assert.equal(result.jobs?.length??0,0);
 assert.equal(result.status,'search_links_only');
 assert.equal(result.city,undefined);
 assert.equal(result.requestedCity,'Bologna');
 assert.equal(result.searchLinks.length,2);
 for(const link of result.searchLinks){
  assert.equal(link.kind,'BROWSING_SUGGESTION');
  assert.equal(link.observedLocation,null);
  assert.equal(link.opportunity_kind,undefined);
  assert.equal(link.city,undefined);
  assert.equal(link.discoveredAt,checkedAt);
 }
 assert.match(result.notice,/not.*vacanc/i);
 assert.equal(result.retryable,false);
});
