import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, request } from './helpers.ts';
import { bootstrap, migrate, buildApp, canonical, hash } from '../src/app.ts';
import { recoverFiles } from '../src/file-lifecycle.ts';
import { LocalFiles } from '../src/local-files.ts';

function gate() { let release!: () => void; const wait = new Promise<void>(r => { release = r; }); return { wait, release }; }
const bounded = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('barrier timeout')), 10000); t.unref(); })]);
async function fixture(options: any = {}) {
  const db = await database(), root = await mkdtemp(join(tmpdir(), 'nova-fix-idempotency-'));
  await migrate(db.pool); const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  let app = buildApp(db.pool, { fileRoot: root, ...options });
  let base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID(), token = a.token) => request(base, path, token, body, 'POST', key);
  const conv = (await post('/conversations', { title: 'Synthetic R1 regression' })).body;
  return { db, root, a, b, post, conv, get base() { return base; },
    body: (text = 'private synthetic text') => ({ conversationId: conv.id, name: 'fix.txt', mime: 'text/plain', dataBase64: Buffer.from(text).toString('base64') }),
    async restart() { await app.close(); await db.restart(); app = buildApp(db.pool, { fileRoot: root }); base = await app.listen({ host: '127.0.0.1', port: 0 }); },
    async close() { await app.close(); await db.close(); await rm(root, { recursive: true, force: true }); }
  };
}
const conflict = { status: 409, body: { error: 'idempotency_conflict' } };
const pendingResponse = { status: 409, body: { error: 'upload_pending' } };
const tables = ['conversations','tasks','artifacts','artifact_revisions','messages','sources','evidence','action_intents','approvals','receipts','outbox','audit_events','idempotency','files','file_cleanup'];
async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  const state: Record<string, unknown> = {};
  for (const table of tables) state[table] = (await f.db.pool.query(`SELECT * FROM ${table} ORDER BY to_jsonb(${table})::text`)).rows;
  return state;
}

test('R1 acceptance: pending upload owns shared key, completes once and replays after restart', async () => {
  const entered = gate(), release = gate();
  const f = await fixture({ fileHooks: { afterReservation: async () => { entered.release(); await release.wait; } } });
  let upload: Promise<any> | undefined;
  try {
    const key = randomUUID(), body = f.body(); upload = f.post('/files', body, key); await bounded(entered.wait);
    const other = await f.post('/conversations', { title: 'must not persist' }, key);
    release.release(); const made = await upload;
    assert.deepEqual(other, conflict);
    assert.equal(made.status, 201); assert.equal(made.body.state, 'ready');
    assert.deepEqual(await f.post('/files', body, key), made);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM conversations')).rows[0].n, 1);
    assert.deepEqual((await f.db.pool.query('SELECT state FROM files')).rows, [{ state: 'ready' }]);
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 1);
    assert.deepEqual((await f.db.pool.query('SELECT response,status FROM idempotency WHERE owner_id=$1 AND key=$2', [f.a.userId, key])).rows, [{ response: made.body, status: 201 }]);
    assert.deepEqual((await readdir(f.root)).sort(), ['.key', made.body.id].sort());
    await f.restart(); assert.deepEqual(await f.post('/files', body, key), made);
  } finally { release.release(); await upload?.catch(() => {}); await f.close(); }
});

test('R1 all generic routes conflict before DB or file side effects; owners remain independent', async () => {
  const entered = gate(), release = gate(); let pause = false;
  const f = await fixture({ fileHooks: { afterReservation: async () => { if (pause) { entered.release(); await release.wait; } } } });
  const original = LocalFiles.prototype.get; let reads = 0, upload: Promise<any> | undefined;
  try {
    const content = { text: 'excerpt', language: 'en' };
    const task = (await f.post('/tasks', { conversationId: f.conv.id, goal: 'test' })).body;
    const artifact = (await f.post('/artifacts', { taskId: task.id, title: 'test', content })).body;
    const file = (await f.post('/files', f.body())).body;
    const message = (await f.post(`/conversations/${f.conv.id}/messages`, { baseSequence: 0, text: 'excerpt' })).body;
    const source = (await f.post('/sources', { conversationId: f.conv.id, messageId: message.id })).body;
    const intentBody = { artifactId: artifact.id, revision: 1, operation: 'simulate.send', account: 'synthetic-account', recipient: 'test@example.invalid', expiresInSeconds: 900 };
    const intent = (await f.post('/intents', intentBody)).body;
    const approval = (await f.post(`/intents/${intent.id}/approve`, { bindingHash: intent.bindingHash })).body;
    const unapproved = (await f.post('/intents', intentBody)).body;
    const routes: [string, unknown][] = [
      ['/conversations', { title: 'blocked' }],
      ['/tasks', { conversationId: f.conv.id, goal: 'blocked' }],
      [`/tasks/${task.id}/transition`, { baseVersion: 1, status: 'active' }],
      ['/artifacts', { taskId: task.id, title: 'blocked', content }],
      [`/artifacts/${artifact.id}/revisions`, { baseRevision: 1, content }],
      [`/conversations/${f.conv.id}/messages`, { baseSequence: 1, text: 'blocked' }],
      ['/sources', { conversationId: f.conv.id, messageId: message.id }],
      ['/sources', { conversationId: f.conv.id, fileId: file.id }],
      ['/evidence', { sourceId: source.id, artifactId: artifact.id, revision: 1, targetKind: 'claim', target: 'claim', excerpt: 'excerpt', territory: 'test', validFrom: '2026-01-01', validUntil: '2026-12-31' }],
      ['/intents', intentBody],
      [`/intents/${unapproved.id}/approve`, { bindingHash: unapproved.bindingHash }],
      [`/intents/${intent.id}/execute`, { approvalId: approval.id, bindingHash: intent.bindingHash }],
      [`/approvals/${approval.id}/revoke`, {}]
    ];
    LocalFiles.prototype.get = async function(...args) { reads++; return original.apply(this, args); };
    pause = true; const key = randomUUID(), body = f.body('reserved');
    upload = f.post('/files', body, key); await bounded(entered.wait);
    const before = await snapshot(f), names = await readdir(f.root);
    for (const [path, payload] of routes) assert.deepEqual(await f.post(path, payload, key), conflict, path);
    assert.deepEqual(await f.post('/files', body, key), pendingResponse);
    assert.deepEqual(await f.post('/files', f.body('changed'), key), conflict);
    assert.deepEqual(await snapshot(f), before); assert.deepEqual(await readdir(f.root), names); assert.equal(reads, 0);
    const independent = await f.post('/conversations', { title: 'owner B' }, key, f.b.token); assert.equal(independent.status, 201);
    release.release(); const made = await upload; assert.equal(made.status, 201);
    assert.deepEqual(await f.post('/files', body, key), made);
    assert.deepEqual(await f.post('/conversations', { title: 'owner B' }, key, f.b.token), independent);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM idempotency WHERE key=$1', [key])).rows[0].n, 2);
  } finally { release.release(); await upload?.catch(() => {}); LocalFiles.prototype.get = original; await f.close(); }
});

test('R1 reverse direction: completed generic key rejects upload before reservation or blob write', async () => {
  let reservations = 0; const f = await fixture({ fileHooks: { afterReservation: async () => { reservations++; } } });
  try {
    const key = randomUUID(), body = { title: 'winner' }, made = await f.post('/conversations', body, key);
    const before = await snapshot(f);
    assert.deepEqual(await f.post('/files', f.body(), key), conflict);
    assert.equal(reservations, 0); assert.deepEqual(await readdir(f.root), ['.key']); assert.deepEqual(await snapshot(f), before);
    assert.deepEqual(await f.post('/conversations', body, key), made);
  } finally { await f.close(); }
});

for (const failure of ['DB', 'FS'] as const) test(`R1 ${failure} failure: reservation blocks other routes until recovery, then same request retries once`, async () => {
  const f = await fixture();
  try {
    const key = randomUUID(), body = f.body();
    if (failure === 'DB') await f.db.pool.query(`CREATE FUNCTION reject_fix_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='file.ready' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_fix_ready BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_fix_ready()`);
    else await chmod(f.root, 0o500);
    assert.equal((await f.post('/files', body, key)).status, 500);
    if (failure === 'FS') await chmod(f.root, 0o700);
    assert.deepEqual(await f.post('/files', body, key), pendingResponse);
    assert.deepEqual(await f.post('/conversations', { title: 'cannot steal failed reservation' }, key), conflict);
    assert.deepEqual((await f.db.pool.query('SELECT state FROM files')).rows, [{ state: 'pending' }]);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM idempotency WHERE key=$1', [key])).rows[0].n, 0);
    const unrelated = await f.post('/conversations', { title: 'unrelated cache' });
    if (failure === 'DB') await f.db.pool.query('DROP TRIGGER reject_fix_ready ON outbox');
    await f.restart(); assert.deepEqual(await readdir(f.root), ['.key']);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n, 0);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM idempotency WHERE response->>\'id\'=$1', [unrelated.body.id])).rows[0].n, 1);
    const made = await f.post('/files', body, key); assert.equal(made.status, 201);
    assert.deepEqual(await f.post('/files', body, key), made);
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 1);
  } finally { await chmod(f.root, 0o700); await f.close(); }
});

test('R1 cancelled reservation cannot disturb a replacement completed cache; purge releases only its owner', async () => {
  const entered = gate(), release = gate(); const f = await fixture({ fileHooks: { afterReservation: async () => { entered.release(); await release.wait; } } });
  let upload: Promise<any> | undefined;
  try {
    const key = randomUUID(); upload = f.post('/files', f.body(), key); await bounded(entered.wait);
    const store = new LocalFiles(f.root); await store.init(false);
    await recoverFiles(f.db.pool, store);
    const body = { title: 'replacement' }, replacement = await f.post('/conversations', body, key); assert.equal(replacement.status, 201);
    const independent = await f.post('/conversations', body, key, f.b.token); assert.equal(independent.status, 201);
    release.release(); assert.deepEqual(await upload, { status: 409, body: { error: 'upload_cancelled' } });
    await recoverFiles(f.db.pool, store);
    assert.deepEqual(await f.post('/conversations', body, key), replacement);
    assert.deepEqual(await readdir(f.root), ['.key']);
    assert.equal((await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE')).status, 200);
    for (const table of ['files','file_cleanup','idempotency']) assert.equal((await f.db.pool.query(`SELECT count(*)::int n FROM ${table} WHERE owner_id=$1`, [f.a.userId])).rows[0].n, 0);
    assert.deepEqual(await f.post('/conversations', body, key, f.b.token), independent);
  } finally { release.release(); await upload?.catch(() => {}); await f.close(); }
});

test('R1 pending purge releases reservation and leaves another owner same-key cache intact', async () => {
  const entered = gate(), release = gate(); const f = await fixture({ fileHooks: { afterReservation: async () => { entered.release(); await release.wait; } } });
  let upload: Promise<any> | undefined;
  try {
    const key = randomUUID(), body = { title: 'owner B survives' };
    upload = f.post('/files', f.body(), key); await bounded(entered.wait);
    const other = await f.post('/conversations', body, key, f.b.token); assert.equal(other.status, 201);
    assert.equal((await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE')).status, 200);
    release.release(); assert.equal((await upload).status, 401);
    for (const table of ['files','file_cleanup','idempotency']) assert.equal((await f.db.pool.query(`SELECT count(*)::int n FROM ${table} WHERE owner_id=$1`, [f.a.userId])).rows[0].n, 0);
    assert.deepEqual(await readdir(f.root), ['.key']);
    assert.deepEqual(await f.post('/conversations', body, key, f.b.token), other);
  } finally { release.release(); await upload?.catch(() => {}); await f.close(); }
});

test('R1 cancelled upload retry with identical key and body gets a new reservation, old request cannot finalize it', async () => {
  const entered = gate(), release = gate(); let pause = true;
  const f = await fixture({ fileHooks: { afterReservation: async () => { if (pause) { entered.release(); await release.wait; } } } });
  let upload: Promise<any> | undefined;
  try {
    const key = randomUUID(), body = f.body(); upload = f.post('/files', body, key); await bounded(entered.wait);
    const oldId = (await f.db.pool.query('SELECT id FROM files')).rows[0].id;
    const store = new LocalFiles(f.root); await store.init(false); await recoverFiles(f.db.pool, store);
    pause = false; const replacement = await f.post('/files', body, key); assert.equal(replacement.status, 201); assert.notEqual(replacement.body.id, oldId);
    release.release(); assert.deepEqual(await upload, { status: 409, body: { error: 'upload_cancelled' } });
    await recoverFiles(f.db.pool, store);
    assert.deepEqual(await f.post('/files', body, key), replacement);
    assert.deepEqual((await readdir(f.root)).sort(), ['.key', replacement.body.id].sort());
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 1);
  } finally { release.release(); await upload?.catch(() => {}); await f.close(); }
});

test('R1 recovery of legacy collision preserves the completed same-owner same-key response', async () => {
  const f = await fixture();
  try {
    const key = randomUUID(), payload = { title: 'legacy completed winner' }, completed = await f.post('/conversations', payload, key);
    const id = randomUUID(), body = f.body();
    // Seed the pre-fix durable state, not a newly allowed application path.
    await f.db.pool.query("INSERT INTO files(id,owner_id,conversation_id,name,mime,size,hash,state,request_key,fingerprint) VALUES($1,$2,$3,'legacy.txt','text/plain',1,$4,'pending',$5,$6)", [id, f.a.userId, f.conv.id, hash('x'), key, hash(canonical({ method: 'POST', url: '/files', body }))]);
    const store = new LocalFiles(f.root); await store.init(false); await store.put(f.a.userId, id, Buffer.from('x'));
    await f.restart(); assert.deepEqual(await readdir(f.root), ['.key']);
    assert.deepEqual(await f.post('/conversations', payload, key), completed);
    assert.deepEqual(await f.post('/files', body, key), conflict);
  } finally { await f.close(); }
});
