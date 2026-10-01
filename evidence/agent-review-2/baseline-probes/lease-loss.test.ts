import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { database,request } from '../../agent-fix-1/baseline/tests/helpers.ts';
import { migrate,bootstrap } from '../../agent-fix-1/baseline/src/app.ts';
const delay=(n:number)=>new Promise(r=>setTimeout(r,n));
test('corrected behavior: singleton connection loss is handled and durably fences in-flight run',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let calls=0,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r);
 const provider=http.createServer(async(req,res)=>{for await(const _chunk of req){}calls++;entered();});await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,PGHOST:db.config.host,PGPORT:String(db.config.port),PGUSER:db.config.user,PGPASSWORD:db.config.password,PGDATABASE:db.config.database,NOVA_TEST_PROVIDER:`http://127.0.0.1:${(provider.address() as any).port}/v1/chat/completions`};
 const child=spawn(process.execPath,['--import','tsx','tests/agent-child.ts'],{cwd:new URL('../../agent-fix-1/baseline/',import.meta.url),env,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=String(b));const exit=once(child,'exit');
 try{
  const base=await new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('readiness timeout')),10000);child.stdout.on('data',b=>{const match=String(b).match(/READY (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});child.on('exit',()=>{clearTimeout(timeout);reject(Error('premature child exit'));});});
  const conversation=await request(base,'/conversations',user.token,{title:'singleton lease loss'},'POST','conversation');
  const turn=await request(base,`/conversations/${conversation.body.id}/turns`,user.token,{baseSequence:0,text:'held provider'},'POST','turn');await arrived;
  const lock=(await db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows[0];assert.ok(lock);
  await db.pool.query('SELECT pg_terminate_backend($1)',[lock.pid]);await Promise.race([exit,delay(1500)]);
  const rows=(await db.pool.query('SELECT status,error_code,model_calls,tool_calls,checkpoint->>\'phase\' AS phase FROM agent_runs')).rows;
  const counts=(await db.pool.query("SELECT (SELECT count(*) FROM artifacts)::int artifacts,(SELECT count(*) FROM messages WHERE role='assistant')::int assistants")).rows[0];
  const evidence={exitCode:child.exitCode,signal:child.signalCode,stderr,runs:rows,counts,providerCalls:calls,remainingLease:(await db.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=913004 AND granted")).rows};
  await writeFile(new URL('./lease-loss.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  assert.ok(!stderr.includes("Unhandled 'error' event"),'dedicated lease client must handle error event and fence runtime intentionally, not crash uncaught');
  assert.equal(rows[0].status,'outcome_unknown','healthy DB permits a durable terminal outcome after lease loss');
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await db.close();}
});
