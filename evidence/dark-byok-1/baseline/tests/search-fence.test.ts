import { LocalFiles } from '../src/local-files.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, bootstrap, migrate, hash } from '../src/app.ts';
import { database, request } from './helpers.ts';


const call = (name:string,args:any,id=randomUUID()) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const output = (calls?:any[], text='controlled output') => ({choices:[{finish_reason:calls?'tool_calls':'stop',message:{role:'assistant',content:calls?null:text,...(calls?{tool_calls:calls}:{})}}]});
const deferred = () => { let resolve!:()=>void; const promise=new Promise<void>(r=>resolve=r); return {promise,resolve}; };
const delay = (n=15)=>new Promise(r=>setTimeout(r,n));
async function evidence(_name:string,_value:any) {}
async function fixture(handler:(input:any,res:http.ServerResponse)=>any, extra:any={}) {
  const db=await database(); await migrate(db.pool); const user=await bootstrap(db.pool);
  const fileRoot=await mkdtemp(join(tmpdir(),'nova-review1-'));
  const inputs:any[]=[];
  const provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);inputs.push(input);res.setHeader('content-type','application/json');try{await handler(input,res);}catch{res.destroy();}});
  await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
  const agent={endpoint:`http://127.0.0.1:${(provider.address() as any).port}/v1/chat/completions`,model:'independent-controlled',allowLoopback:true};
  const app=buildApp(db.pool,{agent,fileRoot,...extra}); const base=await app.listen({port:0,host:'127.0.0.1'});
  const send=(path:string,body?:any,key:string=randomUUID(),method?:string,token=user.token)=>request(base,path,token,body,method,body===undefined?undefined:key);
  const conversation=(await send('/conversations',{title:'Independent adversarial review'})).body;
  return {db,user,fileRoot,inputs,agent,app,send,conversation,
    async close(){await app.close();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await db.close();await rm(fileRoot,{recursive:true,force:true});}};
}
async function settled(f:any,id:string) {for(let i=0;i<400;i++){const rows=(await f.db.pool.query('SELECT id,status,error_code,model_calls,tool_calls FROM agent_runs WHERE id=$1',[id])).rows;if(!rows.length||!['queued','running'].includes(rows[0].status))return rows[0];await delay();}throw Error('settle timeout');}
async function state(f:any) {return {runs:(await f.db.pool.query('SELECT id,status,error_code,model_calls,tool_calls FROM agent_runs ORDER BY created_at')).rows,messages:(await f.db.pool.query('SELECT sequence,role,text FROM messages ORDER BY sequence')).rows,artifacts:(await f.db.pool.query('SELECT id,title,current_revision FROM artifacts')).rows,receipts:(await f.db.pool.query('SELECT call_id,tool,result FROM agent_tool_receipts')).rows,providerCalls:f.inputs.length};}




test('web search result cannot persist after initiating session is revoked',async()=>{
 const entered=deferred(),release=deferred();let count=0;
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output([call('web_search',{query:'official INPS'})]))));
 await f.app.close();
 const next=buildApp(f.db.pool,{fileRoot:f.fileRoot,agent:{...f.agent,search:async()=>{count++;entered.resolve();await release.promise;return {text:'web fact',sources:[]}}}});
 const base=await next.listen({port:0,host:'127.0.0.1'});
 try{const turn=await request(base,`/conversations/${f.conversation.id}/turns`,f.user.token,{baseSequence:0,text:'search'},'POST','search');await entered.promise;
 await f.db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(f.user.token)]);release.resolve();const run=await settled(f,turn.body.id);assert.equal(run.error_code,'session_revoked');assert.equal(count,1);assert.equal((await state(f)).receipts.length,0);assert.equal((await state(f)).messages.length,1);
 }finally{release.resolve();await next.close();await f.close()}
});
