import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';
import {database,request} from './helpers.ts';
const call=()=>({id:randomUUID(),type:'function' as const,function:{name:'jobs_search',arguments:JSON.stringify({query:'cameriere',city:'Bologna'})}});
async function settled(pool:any,id:string){for(let i=0;i<300;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}

test('native fallback preserves direct-only constraint as unmet browsing suggestions, never UNKNOWN opportunities',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let jobs=0,web=0;const inputs:any[]=[];
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'fixture',
  jobsSearch:async(input:any)=>{inputs.push(input);jobs++;return {status:'unavailable',occupation:'cameriere',city:'Bologna',code:'jobs_policy_unreviewed',limitReason:'jobs_rate_limited',retryAfterSeconds:15,retryable:false}},
  search:async(query:string)=>{web++;assert.match(query,/cameriere Bologna/);assert.match(query,/lavoroturismo\.it/);return {checkedAt:'2026-09-30T00:00:00Z',sources:[{title:'Search index',url:'https://example.org/jobs?q=cameriere'}]}},
  provider:{complete:async(messages:any[])=>messages.at(-1).role==='tool'?{role:'assistant',content:'Browsing links only, no confirmed vacancies or direct employers.'}:{role:'assistant',content:null,tool_calls:[call()]}}
 }} as any);
 try{
  const base=await app.listen({port:0,host:'127.0.0.1'});
  for(const constraint of ['senza agenzie','senza intermediari','solo datori diretti','direct employers only','only direct employers']){
   const c=(await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID())).body;
   const t=(await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:0,text:`cameriere Bologna ${constraint}`},'POST',randomUUID())).body;
   const run=await settled(db.pool,t.id);assert.equal(run.status,'completed');
   const result=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='jobs_search'",[run.id])).rows[0].result;
   assert.equal(result.noAgencies,true,constraint);
   assert.equal(result.constraintStatus,'unmet');
   assert.match(result.notice,/no-agenc.*unmet/i);
   assert.equal(result.opportunities?.length??0,0);assert.equal(result.jobs?.length??0,0);
   assert.equal(result.searchLinks.length,1);assert.equal(result.searchLinks[0].kind,'BROWSING_SUGGESTION');
   assert.equal(result.requestedCity,'Bologna');assert.equal(result.city,undefined);
   assert.equal(result.sourceUnavailable.code,'jobs_policy_unreviewed');
   assert.equal(result.sourceUnavailable.limitReason,'jobs_rate_limited');assert.equal(result.sourceUnavailable.retryAfterSeconds,15);
   assert.match(inputs.at(-1).query,/senza agenzie/);
  }
  assert.equal(jobs,5);assert.equal(web,5);
 }finally{await app.close();await db.close()}
});
