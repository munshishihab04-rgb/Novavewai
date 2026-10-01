import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { database, request } from './helpers.ts';
import { bootstrap, migrate } from '../src/app.ts';

test('SIGKILL during real provider await survives PG and API restart as unknown; explicit new turn recovers', async () => {
  const db = await database(); await migrate(db.pool); const user = await bootstrap(db.pool);
  let entered!: () => void, calls = 0; const arrived = new Promise<void>(r => entered = r);
  const provider = http.createServer(async (req,res) => { for await (const _chunk of req) {} calls++; if (calls === 1) { entered(); return; }
    res.setHeader('content-type','application/json'); res.end(JSON.stringify({ choices: [{ finish_reason:'stop',message:{role:'assistant',content:'Controlled post-restart response'} }] })); });
  await new Promise<void>(r => provider.listen(0,'127.0.0.1',r));
  const env = { ...process.env, PGHOST: db.config.host, PGPORT: String(db.config.port), PGUSER: db.config.user, PGPASSWORD: db.config.password, PGDATABASE: db.config.database, NOVA_TEST_PROVIDER: `http://127.0.0.1:${(provider.address() as any).port}/v1/chat/completions` };
  let child: ReturnType<typeof spawn> | undefined, exit: Promise<any> | undefined, base = '';
  const launch = async () => {
    child = spawn(process.execPath,['--import','tsx','tests/agent-child.ts'], { cwd: new URL('..',import.meta.url),env,stdio:['ignore','pipe','pipe'] });
    exit = once(child,'exit');
    base = await new Promise<string>((resolve,reject) => { const timer = setTimeout(() => reject(Error('readiness timeout')),10000);
      child!.stdout!.on('data', b => { const match = String(b).match(/READY (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child!.on('exit', () => { clearTimeout(timer); reject(Error('child exited')); }); });
  };
  const send = (path: string, body?: any, key = randomUUID() as string) => request(base,path,user.token,body,body ? 'POST' : 'GET',body ? key : undefined);
  try {
    await launch(); const conversation = (await send('/conversations',{title:'Kill fixture'})).body;
    const path = `/conversations/${conversation.id}/turns`, body = {baseSequence:0,text:'Controlled delayed inference'};
    const turn = await send(path,body,'original'); await arrived;
    assert.equal((await db.pool.query('SELECT checkpoint->>\'phase\' AS phase FROM agent_runs WHERE id=$1',[turn.body.id])).rows[0].phase,'inference_in_flight');
    child!.kill('SIGKILL'); await exit; provider.closeAllConnections(); await db.restart(); await launch();
    const unknown = (await send(`/runs/${turn.body.id}`)).body; assert.equal(unknown.status,'outcome_unknown'); assert.equal(unknown.error,'runtime_interrupted');
    assert.deepEqual(await send(path,body,'original'),turn); assert.equal(calls,1);
    const next = await send(path,{baseSequence:1,text:'Explicit new attempt',taskId:unknown.taskId});
    const deadline = Date.now()+5000; let done;
    do { done = (await send(`/runs/${next.body.id}`)).body; if(done.status==='completed') break; await new Promise(r=>setTimeout(r,10)); } while(Date.now()<deadline);
    assert.equal(done.status,'completed'); assert.equal(calls,2);
    const messages = (await send(`/conversations/${conversation.id}/messages`)).body.items; assert.equal(messages.length,3); assert.equal(messages[2].role,'assistant');
  } finally { if(child && child.exitCode===null && child.signalCode===null) { child.kill('SIGTERM'); await exit; } provider.closeAllConnections(); await new Promise<void>(r=>provider.close(()=>r())); await db.close(); }
});
