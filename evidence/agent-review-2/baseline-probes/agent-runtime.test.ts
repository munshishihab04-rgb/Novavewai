import { LocalFiles } from '../../agent-fix-1/baseline/src/local-files.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, bootstrap, migrate, hash } from '../../agent-fix-1/baseline/src/app.ts';
import { database, request } from '../../agent-fix-1/baseline/tests/helpers.ts';


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



for (const blocked of ['receipt','terminal'] as const) test(`session final validation after actual ${blocked} write wait`,async()=>{
 const arrived=deferred(),release=deferred();
 const f=await fixture(async(_i,res)=>{arrived.resolve();await release.promise;res.end(JSON.stringify(output([call(blocked==='receipt'?'create_artifact':'complete',blocked==='receipt'?{title:'ROLLBACK',content:{text:'never',language:'en'}}:{text:'never'})])));});
 let blocker:any;
 try{
  await f.db.pool.query(`CREATE FUNCTION hold_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${blocked==='terminal'?"IF NEW.kind <> 'run.completed' THEN RETURN NEW; END IF;":''} PERFORM pg_advisory_xact_lock(913090); RETURN NEW; END $$; CREATE TRIGGER hold_write BEFORE INSERT ON ${blocked==='receipt'?'agent_tool_receipts':'agent_events'} FOR EACH ROW EXECUTE FUNCTION hold_write()`);
  const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'block final write'});await arrived.promise;
  blocker=await f.db.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(913090)');
  await f.db.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1",[hash(f.user.token)]);
  release.resolve();let waiting=false;
  for(let i=0;i<100;i++){waiting=!!(await f.db.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=913090 AND NOT granted")).rowCount;if(waiting)break;await delay();}assert.ok(waiting);
  await delay(1100);await blocker.query('COMMIT');blocker.release();blocker=null;
  const run=await settled(f,turn.body.id);assert.equal(run.error_code,'session_revoked');assert.equal(run.tool_calls,0);
  const s=await state(f);assert.equal(s.artifacts.length,0);assert.equal(s.receipts.length,0);assert.equal(s.messages.length,1);assert.equal(s.providerCalls,1);
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind LIKE 'artifact.%' OR kind='task.completed'")).rows[0].n,0);
  assert.equal((await f.db.pool.query('SELECT status FROM tasks')).rows[0].status,'active');
 }finally{release.resolve();if(blocker){await blocker.query('ROLLBACK');blocker.release();}await f.close();}
});

test('lease loss during writer wait rolls back; replacement drains the old transaction before recovery',async()=>{
 const arrived=deferred(),release=deferred();let artifactId='';
 const f=await fixture(async(_i,res)=>{arrived.resolve();await release.promise;res.end(JSON.stringify(output([call('update_artifact',{artifactId,baseRevision:1,content:{text:'LATE',language:'en'}})])));});
 let blocker:any,next:any;
 try{
  const task=(await f.send('/tasks',{conversationId:f.conversation.id,goal:'writer'})).body;
  artifactId=(await f.send('/artifacts',{taskId:task.id,title:'original',content:{text:'BEFORE',language:'en'}})).body.id;
  const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'update',taskId:task.id});await arrived.promise;
  blocker=await f.db.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE',[artifactId]);release.resolve();
  let waiting=false;for(let i=0;i<100;i++){waiting=!!(await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT current_revision FROM artifacts%'")).rowCount;if(waiting)break;await delay();}assert.ok(waiting);
  const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);await delay(50);
  next=buildApp(f.db.pool,{agent:f.agent,fileRoot:f.fileRoot});let ready=false;const starting=next.listen({port:0,host:'127.0.0.1'}).then(()=>{ready=true;});
  let draining=false;for(let i=0;i<100;i++){draining=!!(await f.db.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=913006 AND NOT granted")).rowCount;if(draining)break;await delay();}
  assert.ok(draining);assert.equal(ready,false);
  await blocker.query('COMMIT');blocker.release();blocker=null;await starting;
  const run=await settled(f,turn.body.id),s=await state(f);
  assert.equal(run.status,'outcome_unknown');assert.equal(run.error_code,'runtime_interrupted');assert.equal(s.artifacts[0].current_revision,1);assert.equal(s.receipts.length,0);assert.equal(s.providerCalls,1);
 }finally{release.resolve();if(blocker){await blocker.query('ROLLBACK');blocker.release();}await next?.close();await f.close();}
});

test('failed storage initialization releases singleton before close and removes client listeners',async()=>{
 const db=await database();await migrate(db.pool);const fileRoot=await mkdtemp(join(tmpdir(),'nova-bad-root-'));
 const clients:any[]=[];db.pool.on('acquire',c=>{if(!clients.includes(c))clients.push(c);});
 let bad:any,next:any;
 try{
  // An existing key on an unbound root is refused (no replacement key).
  await writeFile(join(fileRoot,'.key'),'fixture');
  bad=buildApp(db.pool,{fileRoot});await assert.rejects(bad.listen({port:0,host:'127.0.0.1'}));await delay(50);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].n,0);
  next=buildApp(db.pool);await next.listen({port:0,host:'127.0.0.1'});await next.close();await bad.close();await delay(50);
  const ended=clients.filter(c=>c._ending);assert.ok(ended.length>=2);
  for(const c of ended){assert.ok(!c.listeners('error').some((fn:any)=>fn.name==='invalidate'));assert.ok(!c.listeners('end').some((fn:any)=>fn.name==='ended'));}
 }finally{await next?.close();await bad?.close();await db.close();await rm(fileRoot,{recursive:true,force:true});}
});

test('dedicated client end alone invalidates runtime and cleans listeners',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
 const clients:any[]=[];db.pool.on('acquire',c=>{if(!clients.includes(c))clients.push(c);});const app=buildApp(db.pool);
 try{
  const base=await app.listen({port:0,host:'127.0.0.1'});
  const pid=(await db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  const lease=clients.find(c=>c.processID===pid);assert.ok(lease);await lease.end();await delay(50);
  assert.equal((await request(base,'/conversations',user.token,{title:'unleased'},'POST','new')).status,503);
  assert.ok(!lease.listeners('error').some((fn:any)=>fn.name==='invalidate'));assert.ok(!lease.listeners('end').some((fn:any)=>fn.name==='ended'));
 }finally{await app.close();await db.close();}
});


test('lease loss while file read awaits records unknown before read returns',async()=>{
 const readEntered=deferred(),readRelease=deferred();let fileId='';
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output([call('read_file',{fileId})]))));
 const original=LocalFiles.prototype.get;
 try{
  fileId=(await f.send('/files',{conversationId:f.conversation.id,name:'read.txt',mime:'text/plain',dataBase64:Buffer.from('held read').toString('base64')})).body.id;
  LocalFiles.prototype.get=async function(...args:Parameters<typeof original>){const bytes=await original.apply(this,args);readEntered.resolve();await readRelease.promise;return bytes;};
  const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'read'});await readEntered.promise;
  const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);
  let status='';for(let i=0;i<100;i++){status=(await f.db.pool.query('SELECT status FROM agent_runs WHERE id=$1',[turn.body.id])).rows[0].status;if(status==='outcome_unknown')break;await delay();}
  assert.equal(status,'outcome_unknown','unknown persistence must not depend on non-network read cooperating with abort');
  readRelease.resolve();await delay(80);assert.equal((await state(f)).receipts.length,0);assert.equal(f.inputs.length,1);
 }finally{readRelease.resolve();LocalFiles.prototype.get=original;await f.close();}
});

for (const enabled of [false,true]) test(`startup reservation also excludes non-agent file runtime: ${enabled}`,async()=>{
 const arrived=deferred(), release=deferred();
 const f=await fixture((_i,res)=>res.end(JSON.stringify(output())),{...(enabled?{}:{agent:undefined}),fileHooks:{afterReservation:async()=>{arrived.resolve();await release.promise;}}});
 let second:any;
 try {
  const pending=f.send('/files',{conversationId:f.conversation.id,name:'pending.txt',mime:'text/plain',dataBase64:Buffer.from('pending').toString('base64')},'reserved');await arrived.promise;
  second=buildApp(f.db.pool,{fileRoot:f.fileRoot});
  let rejected=false;try{await second.listen({port:0,host:'127.0.0.1'});}catch{rejected=true;}
  const rows=(await f.db.pool.query('SELECT state FROM files')).rows;
  release.resolve();const result=await pending;
  assert.equal(rejected,true);assert.deepEqual(rows,[{state:'pending'}]);assert.equal(result.status,201);
 }finally{release.resolve();await second?.close();await f.close();}
});

for (const interaction of ['replacement','cancel','purge'] as const) test(`lease loss fences held inference, late output and ${interaction}`,async()=>{
 const arrived=deferred(), release=deferred();let n=0;
 const f=await fixture(async(_i,res)=>{if(++n===1){arrived.resolve();await release.promise;res.end(JSON.stringify(output([call('create_artifact',{title:'LATE',content:{text:'forbidden',language:'en'}})])));}else res.end(JSON.stringify(output([call('complete',{text:'NEW_RUNTIME'})])));});
 let next:any;
 try{
  const path=`/conversations/${f.conversation.id}/turns`, body={baseSequence:0,text:'held'};
  const old=await f.send(path,body,'old');await arrived.promise;
  if(interaction==='cancel')await f.send(`/runs/${old.body.id}/cancel`,{});
  if(interaction==='purge')await f.send('/me',{confirm:'purge'},'purge','DELETE');
  const pid=(await f.db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].pid;
  await f.db.pool.query('SELECT pg_terminate_backend($1)',[pid]);await delay(150);
  const oldState=await settled(f,old.body.id);
  if(interaction==='purge')assert.equal(oldState,undefined);
  else assert.equal(oldState.status,interaction==='cancel'?'cancelled':'outcome_unknown');
  const rejected=await f.send(path,{baseSequence:1,text:'unleased'},'unleased');assert.ok([401,503].includes(rejected.status));
  next=buildApp(f.db.pool,{agent:f.agent,fileRoot:f.fileRoot});const base=await next.listen({port:0,host:'127.0.0.1'});
  if(interaction!=='purge'){
   const fresh=await request(base,path,f.user.token,{baseSequence:1,text:'fresh',taskId:old.body.taskId},'POST','fresh');assert.equal(fresh.status,201);
   assert.equal((await settled(f,fresh.body.id)).status,'completed');
  }
  release.resolve();await delay(100);
  const persisted=await state(f);assert.equal(persisted.artifacts.length,0);
  assert.deepEqual(persisted.messages.filter((m:any)=>m.role==='assistant').map((m:any)=>m.text),interaction==='purge'?[]:['NEW_RUNTIME']);
  assert.equal(f.inputs.length,interaction==='purge'?1:2);
  await f.app.close();
  assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0].n,1,'closing dead runtime must not unlock successor');
 }finally{release.resolve();await next?.close();await f.close();}
});
