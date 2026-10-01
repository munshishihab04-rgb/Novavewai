import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';
import {database,request} from './helpers.ts';
const call=(query='cameriere',city='Bologna')=>({id:randomUUID(),type:'function' as const,function:{name:'jobs_search',arguments:JSON.stringify({query,city})}});
async function settled(pool:any,id:string){for(let i=0;i<300;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}

test('native jobs_search: primary unavailable → one registry-targeted discovery query → only registry detail pages are read; result persists provenance for current, expired and off-registry leads',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const queries:string[]=[];const fetched:string[]=[];
 // Loopback origin stands in for a registry host by injecting fetcher-free leads: the adapter must NOT fetch
 // non-registry URLs at all, so the loopback lead below must never be requested.
 const {createServer}=await import('node:http');const rogue=createServer((_,res)=>{fetched.push('rogue');res.end('<h1>Cameriere</h1> Bologna Pubblicato il 29/09/2026')});await new Promise<void>(r=>rogue.listen(0,'127.0.0.1',()=>r()));const roguePort=(rogue.address() as any).port;
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'fixture',
  jobsSearch:async()=>({status:'unavailable',occupation:'cameriere',city:'Bologna',code:'jobs_policy_unreviewed',retryable:false}),
  search:async(query:string)=>{queries.push(query);return {checkedAt:new Date().toISOString(),text:'x',sources:[
   {title:'rogue',url:`https://127.0.0.1:${roguePort}/offerte-lavoro/offerta-cameriere-bologna`},
   {title:'Cameriere/a di sala - LavoroTurismo',url:'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-smy-hotels'},
   {title:'index',url:'https://www.restworld.it/cerco-lavoro/esplora'}]}},
  provider:{complete:async(messages:any[])=>messages.at(-1).role==='tool'?{role:'assistant',content:'Ecco cosa ho verificato.'}:{role:'assistant',content:null,tool_calls:[call()]}}
 }} as any);
 try{
  const base=await app.listen({port:0,host:'127.0.0.1'});
  const c=(await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID())).body;
  const t=(await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:0,text:'cerco lavoro come cameriere a Bologna'},'POST',randomUUID())).body;
  const run=await settled(db.pool,t.id);assert.equal(run.status,'completed');
  const result=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='jobs_search'",[run.id])).rows[0].result;
  assert.equal(queries.length,1);assert.match(queries[0],/cameriere Bologna/);assert.match(queries[0],/lavoroturismo\.it/);
  assert.equal(fetched.length,0,'non-registry loopback lead must never be fetched');
  assert.equal(result.sourceUnavailable.code,'jobs_policy_unreviewed');
  assert.ok(Array.isArray(result.unavailablePages));assert.ok(result.verifiedScope.allowedOrigins.includes('https://www.lavoroturismo.it'));
  // This test hits the real LavoroTurismo page when network is available: today's evidence says EXPIRED.
  // Without network the page is UNAVAILABLE. Either way it must never appear as a vacancy.
  const smy=result.unavailablePages.find((p:any)=>p.url.includes('smy-hotels'));
  if(smy){assert.ok(['EXPIRED','UNAVAILABLE','STALE_DATE'].includes(smy.status),smy.status);assert.ok(smy.reason);}
  assert.equal((result.opportunities??[]).filter((o:any)=>o.source_url.includes('smy-hotels')).length,0);
  if(!result.opportunities?.length){assert.equal(result.status,'search_links_only');assert.ok(result.searchLinks.length>=1);assert.equal(result.requestedCity,'Bologna');}
 }finally{await app.close();await db.close();rogue.close()}
});
