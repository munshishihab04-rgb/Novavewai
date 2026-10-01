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





test('lock-observation invalidation before queued lease error must not emit an unhandled pool error',async()=>{
 const entered=deferred(),release=deferred(); const clients:any[]=[];
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output())));
 const originalPut=LocalFiles.prototype.put;let pending:any,lease:any,originalEmit:any;const queued:any[][]=[],poolErrors:any[]=[];
 const observePoolError=(error:any)=>poolErrors.push({message:error.message,code:error.code});
 f.db.pool.on('error',observePoolError);
 try{
  // Obtain the lease via the pool's checked-out client list solely for event-order fault injection.
  const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  lease=(f.db.pool as any)._clients.find((c:any)=>c.processID===pid);assert.ok(lease);
  originalEmit=lease.emit;
  lease.emit=function(name:string,...args:any[]){if(name==='error'||name==='end'){queued.push([name,...args]);return true;}return originalEmit.call(this,name,...args);};
  LocalFiles.prototype.put=async function(...args:Parameters<typeof originalPut>){await originalPut.apply(this,args);entered.resolve();await release.promise;};
  pending=f.send('/files',{conversationId:f.conversation.id,name:'queued.txt',mime:'text/plain',dataBase64:Buffer.from('queued event').toString('base64')},'queued');await entered.promise;
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);
  for(let i=0;i<100&&!queued.some(e=>e[0]==='error');i++)await delay();assert.ok(queued.some(e=>e[0]==='error'));
  release.resolve();const response=await pending;assert.equal(response.status,503);
  // The final actual-lock check has invalidated and begun ending the lease.
  // Deliver received backend events before any new work; pool release must wait for end.
  lease.emit=originalEmit;
  for(const [name,...args] of queued)originalEmit.call(lease,name,...args);
  const snapshot={response,poolErrors,queuedEvents:queued.map(e=>e[0]),leaseListeners:{error:lease.listeners('error').map((f:any)=>f.name),end:lease.listeners('end').map((f:any)=>f.name)},files:(await f.db.pool.query('SELECT state FROM files')).rows};
  assert.deepEqual(poolErrors,[],'dedicated lease error must not escape through pg-pool after lock-observation invalidation');
 }finally{release.resolve();LocalFiles.prototype.put=originalPut;if(lease&&originalEmit)lease.emit=originalEmit;if(pending)await pending;await f.close();}
});
