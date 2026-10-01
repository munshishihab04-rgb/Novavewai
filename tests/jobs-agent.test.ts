import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate,hash} from '../src/app.ts';
import {database,request} from './helpers.ts';
import {JobsService} from '../src/jobs.ts';
const call=(name:string,args:any)=>({id:randomUUID(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
async function settled(pool:any,id:string){for(let i=0;i<300;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('settle timeout');}

test('native agent asks city from jobs receipt without browsing and includes discovery safety instructions',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let sourceCalls=0,modelCalls=0;
 const service=new JobsService({cacheDir:'/not-used',source:async()=>{sourceCalls++;return []}});
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org/v1',model:'test',jobsSearch:(input:any,signal:AbortSignal)=>service.search(input,signal),provider:{complete:async(messages:any[],tools:any[])=>{
  modelCalls++;assert.ok(tools.some(t=>t.function.name==='jobs_search'));
  assert.match(messages[0].content,/optional preferences/i);
  if(modelCalls===1)return {role:'assistant',content:null,tool_calls:[call('jobs_search',{query:'sono bravo a cucinare',city:'Bologna'})]};
  const receipt=JSON.parse(messages.at(-1).content);assert.equal(receipt.status,'needs_city');
  return {role:'assistant',content:null,tool_calls:[call('ask_question',{text:receipt.question})]};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID());
 const turn=await request(base,`/conversations/${c.body.id}/turns`,user.token,{baseSequence:0,text:'Sono bravo a cucinare'},'POST',randomUUID());
 const run=await settled(db.pool,turn.body.id);assert.equal(run.status,'waiting_user');assert.equal(sourceCalls,0);
 const receipt=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='jobs_search'",[run.id])).rows[0];assert.equal(receipt.result.occupation,'cuoco');
 }finally{await app.close();await db.close()}
});

test('jobs source receipt cannot persist after session revocation',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org/v1',model:'test',jobsSearch:async()=>{entered();await gate;return {status:'ok',jobs:[]}},provider:{complete:async()=>({role:'assistant',content:null,tool_calls:[call('jobs_search',{query:'cameriere',city:'Bologna'})]})}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID());
 const turn=await request(base,`/conversations/${c.body.id}/turns`,user.token,{baseSequence:0,text:'cameriere Bologna'},'POST',randomUUID());
 await Promise.race([start,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('jobs dispatch missing')),2000))]);
 await db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(user.token)]);release();
 const run=await settled(db.pool,turn.body.id);assert.equal(run.error_code,'session_revoked');assert.equal((await db.pool.query('SELECT * FROM agent_tool_receipts WHERE run_id=$1',[run.id])).rowCount,0);
 }finally{release();await app.close();await db.close()}
});

test('cancellation fences uncooperative job providers and does not hang app shutdown',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org/v1',model:'test',jobsSearch:async()=>{entered();await gate;return {status:'ok',jobs:[]}},provider:{complete:async()=>({role:'assistant',content:null,tool_calls:[call('jobs_search',{query:'cameriere',city:'Bologna'})]})}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID());const turn=await request(base,`/conversations/${c.body.id}/turns`,user.token,{baseSequence:0,text:'cameriere Bologna'},'POST',randomUUID());await start;
 await request(base,`/runs/${turn.body.id}/cancel`,user.token,{},'POST',randomUUID());
 await Promise.race([app.close(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('shutdown hung')),700))]);
 assert.equal((await db.pool.query('SELECT * FROM agent_tool_receipts WHERE run_id=$1',[turn.body.id])).rowCount,0);
 }finally{release();await app.close();await db.close()}
});

test('native jobs dispatch completes with original link receipt and no preference interview',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let searches=0,models=0;
 const original='https://www.subito.it/offerte-lavoro/cameriere-123.htm';
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org/v1',model:'test',jobsSearch:async(input:any)=>{searches++;assert.equal(input.city,'Bologna');return {status:'ok',jobs:[{title:'TEST FIXTURE cameriere',url:original,city:'Bologna',source:'Subito'}],fetchedAt:'2026-09-26T00:00:00Z'}},provider:{complete:async(messages:any[])=>{models++;if(models===1)return {role:'assistant',content:null,tool_calls:[call('jobs_search',{query:'cameriere',city:'Bologna'})]};const receipt=JSON.parse(messages.at(-1).content);assert.equal(receipt.jobs[0].url,original);return {role:'assistant',content:'Controlled fixture link: '+original};}}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=await request(base,'/conversations',user.token,{title:'Jobs'},'POST',randomUUID());const turn=await request(base,`/conversations/${c.body.id}/turns`,user.token,{baseSequence:0,text:'cameriere Bologna'},'POST',randomUUID());const run=await settled(db.pool,turn.body.id);assert.equal(run.status,'completed');assert.equal(searches,1);assert.equal(models,2);const events=await request(base,`/runs/${run.id}/events?limit=50`,user.token);assert.ok(events.body.items.some((e:any)=>e.kind==='tool.succeeded'&&e.detail.tool==='jobs_search'&&e.detail.result.jobs[0].url===original));
 }finally{await app.close();await db.close()}
});
