import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, bootstrap, migrate, hash } from '../../src/app.ts';
import { database, request } from '../../tests/helpers.ts';

const dir = new URL('./',import.meta.url);
const call = (name:string,args:any,id=randomUUID()) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const output = (calls?:any[], text='controlled output') => ({choices:[{finish_reason:calls?'tool_calls':'stop',message:{role:'assistant',content:calls?null:text,...(calls?{tool_calls:calls}:{})}}]});
const deferred = () => { let resolve!:()=>void; const promise=new Promise<void>(r=>resolve=r); return {promise,resolve}; };
const delay = (n=15)=>new Promise(r=>setTimeout(r,n));
async function evidence(name:string,value:any) { await writeFile(new URL(name+'.json',dir),JSON.stringify(value,null,2)+'\n'); }
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

test('corrected behavior: rejected second runtime must not delete first runtime pending upload/reservation',async()=>{
  const arrived=deferred(),release=deferred();
  const f=await fixture((_i,res)=>res.end(JSON.stringify(output())),{fileHooks:{afterReservation:async()=>{arrived.resolve();await release.promise;}}});
  let second:any;
  try {
    const pending=f.send('/files',{conversationId:f.conversation.id,name:'pending.txt',mime:'text/plain',dataBase64:Buffer.from('pending controlled data').toString('base64')},'shared-pending');
    await arrived.promise;
    const before=(await f.db.pool.query('SELECT id,state,request_key FROM files')).rows;
    second=buildApp(f.db.pool,{fileRoot:f.fileRoot,agent:f.agent});
    let startupError='';try{await second.listen({port:0,host:'127.0.0.1'});}catch(e:any){startupError=e.message;}
    const after=(await f.db.pool.query('SELECT id,state,request_key FROM files')).rows;
    const stolen=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'reuse reserved upload key'},'shared-pending');
    if(stolen.status===201)await settled(f,stolen.body.id);
    release.resolve();const upload=await pending;
    const snapshot={startupError,before,after,stolen,upload,persisted:await state(f),idempotency:(await f.db.pool.query('SELECT key,status,response FROM idempotency WHERE key=$1',['shared-pending'])).rows};
    await evidence('startup-pending-upload',snapshot);
    assert.match(startupError,/already active/);
    assert.equal(after.length,1,'runtime refused singleton lease must not recover another live runtime upload');
    assert.equal(stolen.status,409);assert.equal(upload.status,201);
  }finally{release.resolve();if(second)await second.close();await f.close();}
});

test('corrected behavior: assistant-generated content must not become a user_supplied source',async()=>{
  const f=await fixture((_i,res)=>res.end(JSON.stringify(output(undefined,'MODEL_GENERATED_ONLY review fixture'))));
  try{
    const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'Produce an unverified statement'});await settled(f,turn.body.id);
    const assistant=(await f.send(`/conversations/${f.conversation.id}/messages`)).body.items.find((m:any)=>m.role==='assistant');
    const source=await f.send('/sources',{conversationId:f.conversation.id,messageId:assistant.id});
    const persisted=(await f.db.pool.query('SELECT s.snapshot,s.trust,m.role FROM sources s JOIN messages m ON m.id=s.message_id')).rows;
    await evidence('assistant-source-provenance',{source,persisted});
    assert.ok(source.status>=400||source.body.trust!=='user_supplied','generated assistant text must be rejected or labelled generated, not user_supplied');
  }finally{await f.close();}
});

test('pending upload namespace blocks turn without losing reservation or invoking model',async()=>{
  const arrived=deferred(),release=deferred();const f=await fixture((_i,res)=>res.end(JSON.stringify(output())),{fileHooks:{afterReservation:async()=>{arrived.resolve();await release.promise;}}});
  try{
    const pending=f.send('/files',{conversationId:f.conversation.id,name:'normal.txt',mime:'text/plain',dataBase64:Buffer.from('normal pending').toString('base64')},'normal-reservation');await arrived.promise;
    const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'must reject'},'normal-reservation');release.resolve();const upload=await pending;
    await evidence('pending-idempotency-control',{turn,upload,persisted:await state(f)});
    assert.equal(turn.body.error,'idempotency_conflict');assert.equal(upload.status,201);assert.equal(f.inputs.length,0);
  }finally{release.resolve();await f.close();}
});

test('cancelled generation cannot write after a new run completes; original replay cannot redispatch',async()=>{
  const arrived=deferred(),release=deferred();let n=0;
  const f=await fixture(async(_i,res)=>{if(++n===1){arrived.resolve();await release.promise;res.end(JSON.stringify(output([call('create_artifact',{title:'OLD_GENERATION',content:{text:'forbidden late mutation',language:'en'}})])));}else res.end(JSON.stringify(output([call('complete',{text:'NEW_GENERATION'})])));});
  try{
    const path=`/conversations/${f.conversation.id}/turns`,body={baseSequence:0,text:'old generation'};
    const old=await f.send(path,body,'old-generation');await arrived.promise;await f.send(`/runs/${old.body.id}/cancel`,{});
    const fresh=await f.send(path,{baseSequence:1,text:'new generation',taskId:old.body.taskId},'new-generation');await settled(f,fresh.body.id);
    release.resolve();await delay(100);const replay=await f.send(path,body,'old-generation');const persisted=await state(f);await evidence('generation-fence',{old,fresh,replay,persisted});
    assert.deepEqual(replay,old);assert.equal(persisted.providerCalls,2);assert.equal(persisted.artifacts.length,0);assert.deepEqual(persisted.messages.filter((m:any)=>m.role==='assistant').map((m:any)=>m.text),['NEW_GENERATION']);
  }finally{release.resolve();await f.close();}
});

test('a different live session cannot authorize output of the revoked initiating session',async()=>{
  const arrived=deferred(),release=deferred();const f=await fixture(async(_i,res)=>{arrived.resolve();await release.promise;res.end(JSON.stringify(output([call('complete',{text:'must not persist'})])));});
  try{
    const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'session fence'});await arrived.promise;
    const replacement='R'.repeat(43);await f.db.pool.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[hash(replacement),f.user.userId]);await f.db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(f.user.token)]);
    release.resolve();const run=await settled(f,turn.body.id);const replacementRead=await f.send(`/runs/${turn.body.id}`,undefined,'unused',undefined,replacement);
    await evidence('exact-session-fence',{run,replacementRead,persisted:await state(f)});
    assert.equal(run.error_code,'session_revoked');assert.equal(replacementRead.status,200);assert.equal((await state(f)).messages.length,1);
  }finally{release.resolve();await f.close();}
});

test('entire provider batch is allowlist/schema validated before first mutation',async()=>{
  const f=await fixture((_i,res)=>res.end(JSON.stringify(output([call('create_artifact',{title:'must rollback',content:{text:'do not persist',language:'en'}}),call('constructor',{command:'attack'})]))));
  try{
    const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'untrusted tool injection'});const run=await settled(f,turn.body.id);const persisted=await state(f);await evidence('batch-allowlist',{run,persisted});
    assert.equal(run.error_code,'tool_denied');assert.equal(persisted.artifacts.length,0);assert.equal(persisted.receipts.length,0);assert.equal(persisted.providerCalls,1);
  }finally{await f.close();}
});

test('corrected behavior: expiry during canonical writer lock wait must roll back mutation and receipt',async()=>{
  const arrived=deferred(),release=deferred();let artifactId='';
  const f=await fixture(async(_i,res)=>{arrived.resolve();await release.promise;res.end(JSON.stringify(output([call('update_artifact',{artifactId,baseRevision:1,content:{text:'AFTER_SESSION_EXPIRY',language:'en'}})])));});
  let blocker:any;
  try{
    const task=(await f.send('/tasks',{conversationId:f.conversation.id,goal:'expiry while writer blocked'})).body;
    artifactId=(await f.send('/artifacts',{taskId:task.id,title:'original',content:{text:'BEFORE',language:'en'}})).body.id;
    const turn=await f.send(`/conversations/${f.conversation.id}/turns`,{baseSequence:0,text:'update after controlled delay',taskId:task.id});await arrived.promise;
    blocker=await f.db.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE',[artifactId]);
    await f.db.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1",[hash(f.user.token)]);
    release.resolve();let waiting=false;
    for(let i=0;i<100;i++){waiting=!!(await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT current_revision FROM artifacts%'")).rowCount;if(waiting)break;await delay();}
    assert.ok(waiting,'canonical writer reached lock wait after initial session fence');
    await delay(1100);
    const expired=(await f.db.pool.query('SELECT expires_at<clock_timestamp() expired FROM sessions WHERE token_hash=$1',[hash(f.user.token)])).rows[0].expired;
    await blocker.query('COMMIT');blocker.release();blocker=null;
    const run=await settled(f,turn.body.id),persisted=await state(f),revisions=(await f.db.pool.query('SELECT revision,content FROM artifact_revisions ORDER BY revision')).rows;
    await evidence('writer-session-expiry',{waiting,expired,run,persisted,revisions});
    assert.equal(expired,true);assert.equal(persisted.artifacts[0].current_revision,1,'expired initiating session must not commit blocked artifact update');assert.equal(persisted.receipts.length,0);
  }finally{release.resolve();if(blocker){await blocker.query('ROLLBACK');blocker.release();}await f.close();}
});

test('receipt insertion failure atomically rolls back canonical revision and outbox; no replay inference',async()=>{
  const f=await fixture((_i,res)=>res.end(JSON.stringify(output([call('create_artifact',{title:'atomic failure',content:{text:'no artifact',language:'en'}})]))));
  try{
    await f.db.pool.query("CREATE FUNCTION review_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_DB_DETAIL_REVIEW'; END $$; CREATE TRIGGER review_reject BEFORE INSERT ON agent_tool_receipts FOR EACH ROW EXECUTE FUNCTION review_reject()");
    const path=`/conversations/${f.conversation.id}/turns`,body={baseSequence:0,text:'atomic receipt'};const turn=await f.send(path,body,'atomic');const run=await settled(f,turn.body.id);const replay=await f.send(path,body,'atomic');const exported=await f.send('/me/export');
    const persisted=await state(f);const artifactEvents=(await f.db.pool.query("SELECT kind FROM outbox WHERE kind LIKE 'artifact.%'")).rows;
    await evidence('receipt-atomicity-redaction',{run,replay,persisted,artifactEvents,exportContainsInternal:JSON.stringify(exported).includes('PRIVATE_DB_DETAIL_REVIEW')});
    assert.equal(run.status,'outcome_unknown');assert.equal(persisted.artifacts.length,0);assert.equal(persisted.receipts.length,0);assert.equal(artifactEvents.length,0);assert.deepEqual(replay,turn);assert.equal(persisted.providerCalls,1);assert.ok(!JSON.stringify(exported).includes('PRIVATE_DB_DETAIL_REVIEW'));assert.ok(!JSON.stringify(exported).includes('session_hash'));assert.ok(!JSON.stringify(exported).includes('checkpoint'));
  }finally{await f.close();}
});
