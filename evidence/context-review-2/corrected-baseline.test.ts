import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, readdir, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, request } from '../../tests/helpers.ts';
import { bootstrap, migrate, buildApp, hash } from '../context-fix-1/baseline/src/app.ts';
import { LocalFiles } from '../context-fix-1/baseline/src/local-files.ts';

const record = (caseId: string, observed: unknown) => console.log(JSON.stringify({ caseId, observed }));
function gate() { let release!: () => void; const wait = new Promise<void>(r => { release = r; }); return { wait, release }; }
const bounded = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('barrier timeout')), 10000); t.unref(); })]);
async function fixture(options: any = {}) {
  const db = await database(); const root = await mkdtemp(join(tmpdir(), 'nova-review-context-'));
  await migrate(db.pool); const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  const apps: ReturnType<typeof buildApp>[] = [];
  const app = buildApp(db.pool, { fileRoot: root, ...options }); apps.push(app);
  let base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID(), token = a.token) => request(base, path, token, body, 'POST', key);
  const conv = (await post('/conversations', { title: 'Independent synthetic review' })).body;
  return { db, root, a, b, app, apps, post, conv, get base() { return base; },
    get: (path: string, token = a.token) => request(base, path, token),
    body: (text = 'review private বাংলা') => ({ conversationId: conv.id, name: 'review.txt', mime: 'text/plain', dataBase64: Buffer.from(text).toString('base64') }),
    async second() { const app2 = buildApp(db.pool, { fileRoot: root }); apps.push(app2); return await app2.listen({ host: '127.0.0.1', port: 0 }); },
    async restart() { await app.close(); await db.restart(); const next = buildApp(db.pool, { fileRoot: root }); apps.push(next); base = await next.listen({ host: '127.0.0.1', port: 0 }); },
    async close() { for (const x of apps) await x.close(); await db.close(); await rm(root, { recursive: true, force: true }); }
  };
}

test('R1 corrected acceptance: pending upload protects shared key and replays after restart', async () => {
  const entered = gate(), release = gate();
  const f = await fixture({ fileHooks: { afterReservation: async () => { entered.release(); await release.wait; } } });
  let pending: Promise<any> | undefined;
  try {
    const key = randomUUID(), body = f.body(); pending = f.post('/files', body, key); await bounded(entered.wait);
    const conflicting = await f.post('/conversations', { title: 'same key other route' }, key);
    release.release(); const upload = await pending;
    const persisted = (await f.db.pool.query('SELECT state,request_key FROM files WHERE owner_id=$1', [f.a.userId])).rows;
    const cache = (await f.db.pool.query('SELECT response,status FROM idempotency WHERE owner_id=$1 AND key=$2', [f.a.userId,key])).rows;
    const readyEvents = (await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n;
    const retry = await f.post('/files', body, key);
    record('R1', { conflicting, upload, persisted, cache, readyEvents, retry, blobCount: (await readdir(f.root)).filter(x => x !== '.key').length });
    assert.deepEqual(conflicting, { status: 409, body: { error: 'idempotency_conflict' } });
    assert.equal(upload.status, 201); assert.equal(upload.body.state, 'ready');
    assert.deepEqual(persisted, [{ state: 'ready', request_key: key }]);
    assert.equal(readyEvents, 1); assert.deepEqual(retry, upload);
    assert.deepEqual(cache, [{ response: upload.body, status: 201 }]);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM conversations WHERE owner_id=$1', [f.a.userId])).rows[0].n, 1);
    assert.deepEqual((await readdir(f.root)).sort(), ['.key', upload.body.id].sort());
    const download = await fetch(f.base + `/files/${upload.body.id}/content`, { headers: { authorization: `Bearer ${f.a.token}` } });
    assert.equal(download.status, 200); assert.equal(await download.text(), 'review private বাংলা');
    await f.restart();
    const afterRestart = { files: (await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n, names: (await readdir(f.root)).sort(), retry: await f.post('/files', body, key) };
    record('R1-after-restart', afterRestart);
    assert.deepEqual(afterRestart, { files: 1, names: ['.key', upload.body.id].sort(), retry: upload });
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 1);
  } finally { release.release(); await pending?.catch(() => {}); await f.close(); }
});

test('R2 observation: same-host startup cancels active reservation gap', async () => {
  const entered = gate(), release = gate();
  const f = await fixture({ fileHooks: { afterReservation: async () => { entered.release(); await release.wait; } } }); let pending: Promise<any> | undefined;
  try {
    pending = f.post('/files', f.body()); await bounded(entered.wait);
    const before = (await f.db.pool.query('SELECT id,state FROM files')).rows;
    await f.second();
    release.release(); const result = await pending;
    const after = (await f.db.pool.query('SELECT id,state FROM files')).rows;
    record('R2', { before, secondStartup: 'listening', result, after, names: await readdir(f.root) });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'upload_cancelled'); assert.equal(after.length, 0);
  } finally { release.release(); await pending?.catch(() => {}); await f.close(); }
});

test('CONTROL: startup waits for owner-locked active put and preserves ready file', async () => {
  const f = await fixture(), original = LocalFiles.prototype.put, entered = gate(), release = gate(); let upload: Promise<any> | undefined, startup: Promise<any> | undefined;
  try {
    LocalFiles.prototype.put = async function(owner, id, bytes) { await original.call(this, owner, id, bytes); entered.release(); await release.wait; };
    upload = f.post('/files', f.body()); await bounded(entered.wait);
    let done = false; startup = f.second().then(x => { done = true; return x; });
    let locked = false;
    for (let n=0; n<200; n++) { const q = await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query='SELECT id FROM users WHERE id=$1 FOR UPDATE'"); if (q.rowCount) { locked = true; break; } await new Promise(r=>setTimeout(r,10)); }
    assert.equal(locked, true); assert.equal(done, false); release.release();
    const result = await upload; await startup; assert.equal(result.status,201);
    const content = await fetch(f.base+`/files/${result.body.id}/content`, { headers: { authorization: `Bearer ${f.a.token}` } });
    assert.equal(content.status,200); assert.equal(await content.text(), 'review private বাংলা');
    record('startup-active-put', { status: result.status, waitingObserved: locked, files: (await f.db.pool.query('SELECT state FROM files')).rows, cleanup: (await f.db.pool.query('SELECT count(*)::int n FROM file_cleanup')).rows[0].n });
  } finally { release.release(); await upload?.catch(()=>{}); await startup?.catch(()=>{}); LocalFiles.prototype.put=original; await f.close(); }
});

test('CONTROL: exact-session revocation after filesystem read blocks download and source commit', async () => {
  const f = await fixture(), original = LocalFiles.prototype.get;
  try {
    const file = (await f.post('/files', f.body())).body;
    for (const operation of ['download','source']) {
      const account = { token: randomBytes(32).toString('base64url') };
      await f.db.pool.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [hash(account.token),f.a.userId]);
      LocalFiles.prototype.get = async function(owner,id,size,digest) { const bytes=await original.call(this,owner,id,size,digest); await f.db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(account.token)]); return bytes; };
      const result = operation === 'download' ? await f.get(`/files/${file.id}/content`,account.token) : await f.post('/sources',{conversationId:f.conv.id,fileId:file.id},randomUUID(),account.token);
      assert.equal(result.status,401); record('revoke-after-read-'+operation,result);
    }
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM sources')).rows[0].n,0);
    record('revoke-after-read-persisted',{sources:0,files:(await f.db.pool.query('SELECT state FROM files')).rows});
  } finally { LocalFiles.prototype.get=original; await f.close(); }
});

test('CONTROL: same-key pending retry, foreign-owner scoping, AAD substitution and purge', async () => {
  const entered=gate(), release=gate(); let pause=true;
  const f=await fixture({fileHooks:{afterReservation:async()=>{if(pause){entered.release();await release.wait;}}}}); let pending:Promise<any>|undefined;
  try {
    const key=randomUUID(), body=f.body(); pending=f.post('/files',body,key); await bounded(entered.wait);
    const replay=await f.post('/files',body,key), conflict=await f.post('/files',f.body('other'),key);
    assert.deepEqual(replay,{status:409,body:{error:'upload_pending'}}); assert.deepEqual(conflict,{status:409,body:{error:'idempotency_conflict'}});
    release.release(); const first=await pending; pause=false; assert.equal(first.status,201);
    const second=await f.post('/files',body); assert.equal(second.status,201);
    const foreign=await f.get(`/files/${first.body.id}/content`,f.b.token); assert.equal(foreign.status,404);
    await writeFile(join(f.root,second.body.id),await readFile(join(f.root,first.body.id)));
    const swapped=await f.get(`/files/${second.body.id}/content`); assert.equal(swapped.status,409);
    const purged=await request(f.base,'/me',f.a.token,{confirm:'purge'},'DELETE'); assert.equal(purged.status,200);
    await f.restart();
    record('pending-aad-purge',{replay,conflict,foreign,swapped,purged,names:await readdir(f.root),files:(await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n,cleanup:(await f.db.pool.query('SELECT count(*)::int n FROM file_cleanup')).rows[0].n});
    assert.deepEqual(await readdir(f.root),['.key']);
  } finally {release.release();await pending?.catch(()=>{});await f.close();}
});

test('CONTROL: forged provenance, immutable DB checks and exact revision/conversation scopes',async()=>{
  const f=await fixture();
  try{
    const mp=`/conversations/${f.conv.id}/messages`;
    const forged=await f.post(mp,{baseSequence:0,text:'synthetic excerpt',role:'assistant'}); assert.equal(forged.status,400);
    const msg=(await f.post(mp,{baseSequence:0,text:'synthetic excerpt'})).body;
    const source=(await f.post('/sources',{conversationId:f.conv.id,messageId:msg.id})).body;
    const forgedTrust=await f.post('/sources',{conversationId:f.conv.id,messageId:msg.id,trust:'verified'});assert.equal(forgedTrust.status,400);
    const task=(await f.post('/tasks',{conversationId:f.conv.id,goal:'review'})).body;
    const artifact=(await f.post('/artifacts',{taskId:task.id,title:'review',content:{text:'excerpt',language:'en'}})).body;
    const eb={sourceId:source.id,artifactId:artifact.id,revision:1,targetKind:'claim',target:'declared claim',excerpt:'excerpt',territory:'declared',validFrom:'2026-01-01',validUntil:'2026-12-31'};
    const forgedStatus=await f.post('/evidence',{...eb,status:'verified'});assert.equal(forgedStatus.status,400);
    const ev=await f.post('/evidence',eb);assert.equal(ev.status,201);assert.equal(ev.body.status,'unverified');
    const rev=await f.post(`/artifacts/${artifact.id}/revisions`,{baseRevision:1,content:{text:'new',language:'en'}});assert.equal(rev.status,201);
    assert.equal((await f.get(`/artifacts/${artifact.id}/revisions/2/evidence`)).body.items.length,0);
    assert.equal((await f.get(`/artifacts/${artifact.id}/revisions/1/evidence`,f.b.token)).status,404);
    const c2=(await f.post('/conversations',{title:'other'})).body;
    const crossed=await f.post('/sources',{conversationId:c2.id,messageId:msg.id});assert.equal(crossed.status,404);
    await assert.rejects(f.db.pool.query("UPDATE evidence SET status='verified' WHERE id=$1",[ev.body.id]));
    await assert.rejects(f.db.pool.query("UPDATE sources SET trust='verified' WHERE id=$1",[source.id]));
    record('context-controls',{forged,forgedTrust,forgedStatus,crossed,storedEvidence:(await f.db.pool.query('SELECT revision,status,verification_method FROM evidence')).rows,storedSource:(await f.db.pool.query('SELECT trust FROM sources')).rows});
  }finally{await f.close();}
});

test('CONTROL: root symlink and replaced persisted key fail startup closed',async()=>{
 const f=await fixture(); const link=f.root+'-link';
 try{
   await symlink(f.root,link);const linked=buildApp(f.db.pool,{fileRoot:link});f.apps.push(linked);
   await assert.rejects(linked.listen({host:'127.0.0.1',port:0}));
   const key=await readFile(join(f.root,'.key'));key[0]^=1;await writeFile(join(f.root,'.key'),key);
   const replacement=buildApp(f.db.pool,{fileRoot:f.root});f.apps.push(replacement);
   await assert.rejects(replacement.listen({host:'127.0.0.1',port:0}),/key mismatch/);
   record('key-binding',{symlinkStartup:'rejected',replacedKeyStartup:'rejected',bindings:(await f.db.pool.query('SELECT count(*)::int n FROM local_storage_binding')).rows[0].n});
 }finally{await unlink(link).catch(()=>{});await f.close();}
});
