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




test('non-agent live upload also excludes agent-enabled replacement',async()=>{
 const entered=deferred(), release=deferred();
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output())),{agent:undefined,fileHooks:{afterReservation:async()=>{entered.resolve();await release.promise;}}});let next:any;
 try{
  const pending=f.send('/files',{conversationId:f.conversation.id,name:'pending.txt',mime:'text/plain',dataBase64:Buffer.from('pending').toString('base64')},'pending');await entered.promise;
  const before=(await f.db.pool.query('SELECT id,state,request_key FROM files')).rows;
  next=buildApp(f.db.pool,{agent:f.agent,fileRoot:f.fileRoot});await assert.rejects(next.listen({port:0,host:'127.0.0.1'}),/already active/);
  assert.deepEqual((await f.db.pool.query('SELECT id,state,request_key FROM files')).rows,before);
  release.resolve();assert.equal((await pending).status,201);assert.equal(f.inputs.length,0);
 }finally{release.resolve();await next?.close();await f.close();}
});
for(const enabled of [false,true]) test(`no-file incumbent excludes file recovery: agent=${enabled}`,async()=>{
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output())),{fileRoot:undefined,...(enabled?{}:{agent:undefined})});let next:any;
 try{
  next=buildApp(f.db.pool,{fileRoot:f.fileRoot,agent:f.agent});await assert.rejects(next.listen({port:0,host:'127.0.0.1'}),/already active/);
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM local_storage_binding')).rows[0].n,0);
  assert.equal((await f.send('/conversations',{title:'incumbent remains usable'})).status,201);
 }finally{await next?.close();await f.close();}
});
test('lease loss during actual file put drains before destructive recovery',async()=>{
 const entered=deferred(),release=deferred();const f=await fixture((_i,res)=>res.end(JSON.stringify(output())));
 const original=LocalFiles.prototype.put;let next:any;let pending:any;
 try{
  LocalFiles.prototype.put=async function(...args:Parameters<typeof original>){await original.apply(this,args);entered.resolve();await release.promise;};
  pending=f.send('/files',{conversationId:f.conversation.id,name:'held.txt',mime:'text/plain',dataBase64:Buffer.from('held bytes').toString('base64')},'held');await entered.promise;
  const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);await delay(50);
  next=buildApp(f.db.pool,{fileRoot:f.fileRoot,agent:f.agent});let ready=false;const starting=next.listen({port:0,host:'127.0.0.1'}).then(()=>{ready=true;});
  let draining=false;for(let i=0;i<100;i++){draining=!!(await f.db.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=913006 AND NOT granted")).rowCount;if(draining)break;await delay();}
  assert.ok(draining);assert.equal(ready,false);assert.deepEqual((await f.db.pool.query('SELECT state FROM files')).rows,[{state:'pending'}]);
  release.resolve();assert.equal((await pending).status,503);await starting;
  assert.deepEqual((await f.db.pool.query('SELECT * FROM files')).rows,[]);
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM idempotency WHERE key='held'")).rows[0].n,0);
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n,0);
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM file_cleanup')).rows[0].n,0);
  assert.equal(f.inputs.length,0);
 }finally{release.resolve();LocalFiles.prototype.put=original;if(pending)await pending;await next?.close();await f.close();}
});
