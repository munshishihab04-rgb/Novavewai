import { LocalFiles } from '../../src/local-files.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, bootstrap, migrate, hash } from '../../src/app.ts';
import { database, request } from '../../tests/helpers.ts';


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





test('lock disappearance observed before delayed dedicated-client error does not escape onto pool',async()=>{
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output())));
 const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
 const lease=(f.db.pool as any)._clients.find((c:any)=>c.processID===pid);assert.ok(lease);
 const original=lease.emit;const held:any[]=[];const errors:string[]=[];
 f.db.pool.on('error',(e:any)=>errors.push(e.message));
 lease.emit=function(event:string,...args:any[]){if(event==='error'||event==='end'){held.push([event,...args]);return true;}return original.call(this,event,...args);};
 try{
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);
  for(let i=0;i<100&&!held.some(args=>args[0]==='error');i++)await delay();
  assert.ok(held.some(args=>args[0]==='error'));
  const response=await f.send('/conversations',{title:'lease already gone'});
  assert.equal(response.status,503);
  lease.emit=original;
  for(const args of held)original.apply(lease,args);
  await delay(50);
  await writeFile(new URL('./delayed-lease-error.json',import.meta.url),JSON.stringify({response,events:held.map(args=>({event:args[0],message:args[1]?.message})),poolErrors:errors},null,2));
  assert.deepEqual(errors,[],'destroying lease on lock-check invalidation must not install an idle listener that re-emits its delayed error onto an unhandled pool');
 }finally{lease.emit=original;await f.close();}
});
