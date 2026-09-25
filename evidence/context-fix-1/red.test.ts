import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, request } from './helpers.ts';
import { bootstrap, migrate, buildApp } from '../src/app.ts';

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
