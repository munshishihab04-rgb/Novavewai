import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, request } from '../../tests/helpers.ts';
import { migrate, bootstrap, buildApp } from '../../src/app.ts';
import { claim, drain, processLease, type SyntheticAdapter } from '../../src/worker.ts';

async function fixture() {
  const db = await database(); await migrate(db.pool);
  const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  const app = buildApp(db.pool); const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID()) => request(base, path, a.token, body, 'POST', key);
  const c = (await post('/conversations', { title: 'Review fixture' })).body;
  const t = (await post('/tasks', { conversationId: c.id, goal: 'Review' })).body;
  const ar = (await post('/artifacts', { taskId: t.id, title: 'Review', content: { text: 'Local synthetic fixture', language: 'it' } })).body;
  const queued = async () => {
    const i = (await post('/intents', { artifactId: ar.id, revision: 1, operation: 'simulate.send', account: 'synthetic-account', recipient: 'review@example.invalid', expiresInSeconds: 300 })).body;
    const p = (await post(`/intents/${i.id}/approve`, { bindingHash: i.bindingHash })).body;
    const r = (await post(`/intents/${i.id}/execute`, { approvalId: p.id, bindingHash: i.bindingHash })).body;
    return { i, p, r };
  };
  return { db, a, b, app, base, post, t, ar, queued, async close() { await app.close(); await db.close(); } };
}
async function waitForOwnerWaiter(f: Awaited<ReturnType<typeof fixture>>) {
  for (let n = 0; n < 300; n++) {
    const result = await f.db.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=$1%' AND pid<>pg_backend_pid()");
    if (result.rows[0].n > 0) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Expected HTTP transaction blocked on owner row');
}

for (const route of ['mutation', 'export', 'purge']) {
  test(`AUTH-EXPIRY ${route}: session must still be fresh after owner-lock wait`, async () => {
    const f = await fixture(); const blocker = await f.db.pool.connect(); let pending: Promise<any> | undefined;
    try {
      await f.db.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE owner_id=$1", [f.a.userId]);
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.a.userId]);
      pending = route === 'mutation' ? f.post('/conversations', { title: 'After session expiry' }) : route === 'export' ? request(f.base, '/me/export', f.a.token) : request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
      await waitForOwnerWaiter(f);
      await f.db.pool.query('SELECT pg_sleep(2.1)');
      assert.equal((await f.db.pool.query('SELECT expires_at<clock_timestamp() expired FROM sessions WHERE owner_id=$1', [f.a.userId])).rows[0].expired, true);
      await blocker.query('COMMIT');
      const result = await pending;
      const status = (await f.db.pool.query('SELECT status FROM users WHERE id=$1', [f.a.userId])).rows[0].status;
      const lateWrites = (await f.db.pool.query("SELECT count(*)::int n FROM conversations WHERE owner_id=$1 AND title='After session expiry'", [f.a.userId])).rows[0].n;
      console.log(JSON.stringify({ case: `AUTH-EXPIRY-${route}`, observedHttpStatus: result.status, ownerStatus: status, lateWrites, exportedTasks: result.body.tasks?.length }));
      assert.equal(result.status, 401, 'Expired authentication must not authorize an operation after lock acquisition');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending?.catch(() => {}); await f.close(); }
  });
}

for (const route of ['mutation', 'export', 'purge']) {
  test(`AUTH-REVOKE ${route}: revoked session cannot survive owner-lock wait`, async () => {
    const f = await fixture(); const blocker = await f.db.pool.connect(); let pending: Promise<any> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.a.userId]);
      pending = route === 'mutation' ? f.post('/conversations', { title: 'After revocation' }) : route === 'export' ? request(f.base, '/me/export', f.a.token) : request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
      await waitForOwnerWaiter(f);
      // Local operator revokes the session while its authenticated HTTP transaction waits.
      await blocker.query('DELETE FROM sessions WHERE owner_id=$1', [f.a.userId]);
      await blocker.query('COMMIT');
      const result = await pending;
      const ownerStatus = (await f.db.pool.query('SELECT status FROM users WHERE id=$1', [f.a.userId])).rows[0].status;
      console.log(JSON.stringify({ case: `AUTH-REVOKE-${route}`, observedHttpStatus: result.status, ownerStatus, exportedTasks: result.body.tasks?.length }));
      assert.equal(result.status, 401, 'Revocation committed before protected operation must prevent access');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending?.catch(() => {}); await f.close(); }
  });
}

const success: SyntheticAdapter = { kind: 'synthetic', async send() { return { outcome: 'succeeded', reference: 'synthetic-review' }; } };

test('CONTROL: owner-scoped idempotency canonical replay, conflict and cross-owner execution/revocation', async () => {
  const f = await fixture(); try {
    const key = randomUUID();
    const pair = await Promise.all([f.post('/conversations', { title: 'Same' }, key), f.post('/conversations', { title: 'Same' }, key)]);
    assert.deepEqual(pair[0], pair[1]); assert.equal(pair[0].status, 201);
    assert.equal((await f.post('/conversations', { title: 'Different' }, key)).status, 409);
    const q = await f.queued();
    for (const [path, body] of [[`/intents/${q.i.id}/execute`, { approvalId: q.p.id, bindingHash: q.i.bindingHash }], [`/approvals/${q.p.id}/revoke`, {}]] as const) {
      assert.equal((await request(f.base, path, f.b.token, body, 'POST', randomUUID())).status, 404);
    }
    assert.equal((await f.db.pool.query('SELECT status FROM approvals WHERE id=$1', [q.p.id])).rows[0].status, 'consumed');
  } finally { await f.close(); }
});

test('CONTROL: actual DB connection termination after synthetic I/O recovers unknown without resend', async () => {
  const f = await fixture(); try {
    const q = await f.queued(); await f.db.pool.query("UPDATE outbox SET state='done' WHERE kind<>'action.execute'");
    const lease = await claim(f.db.pool); assert.ok(lease); let calls = 0;
    // Swallow only connection error events from intentional fault injection; query rejection is asserted below.
    f.db.pool.on('error', () => {});
    f.db.pool.on('acquire', client => { if (client.listenerCount('error') < 2) client.on('error', () => {}); });
    const adapter: SyntheticAdapter = { kind: 'synthetic', async send() {
      calls++;
      const victims = await f.db.pool.query("SELECT pid FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND state='idle in transaction'");
      assert.equal(victims.rowCount, 1);
      await f.db.pool.query('SELECT pg_terminate_backend($1)', [victims.rows[0].pid]);
      return { outcome: 'succeeded', reference: 'synthetic-before-crash' };
    } };
    await assert.rejects(processLease(f.db.pool, lease, adapter));
    await f.db.pool.query("UPDATE outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [lease.id]);
    await drain(f.db.pool, { kind: 'synthetic', async send(input) { calls++; return success.send(input); } });
    assert.equal(calls, 1);
    assert.equal((await f.db.pool.query('SELECT status FROM receipts WHERE id=$1', [q.r.id])).rows[0].status, 'outcome_unknown');
  } finally { await f.close(); }
});

test('CONTROL: revocation, cancellation and revision wait behind real in-flight owner lock', async () => {
  for (const mode of ['revoke', 'cancel', 'revision']) {
    const f = await fixture(); let release!: () => void; let work: Promise<void> | undefined;
    try {
      const q = await f.queued(); let began!: () => void;
      const started = new Promise<void>(r => { began = r; }); const held = new Promise<void>(r => { release = r; });
      let calls = 0;
      work = drain(f.db.pool, { kind: 'synthetic', async send() { calls++; began(); await held; return { outcome: 'succeeded', reference: 'synthetic-in-flight' }; } });
      await started;
      const operation = mode === 'revoke' ? f.post(`/approvals/${q.p.id}/revoke`, {}) : mode === 'cancel' ? f.post(`/tasks/${f.t.id}/transition`, { baseVersion: 1, status: 'cancelled' }) : f.post(`/artifacts/${f.ar.id}/revisions`, { baseRevision: 1, content: { text: 'new', language: 'it' } });
      await waitForOwnerWaiter(f); release(); await work;
      assert.equal((await operation).status, 201); assert.equal(calls, 1);
      assert.equal((await request(f.base, `/receipts/${q.r.id}`, f.a.token)).body.status, 'succeeded');
      await drain(f.db.pool, success);
    } finally { release?.(); await work?.catch(() => {}); await f.close(); }
  }
});

test('CONTROL: purge after timed-out uncooperative adapter blocks late persistence and replay', async () => {
  const f = await fixture(); let release!: () => void;
  try {
    const q = await f.queued(); await f.db.pool.query("UPDATE outbox SET state='done' WHERE kind<>'action.execute'");
    const lease = await claim(f.db.pool); assert.ok(lease); let calls = 0;
    const held = new Promise<void>(r => { release = r; });
    await processLease(f.db.pool, lease, { kind: 'synthetic', async send() { calls++; await held; return { outcome: 'succeeded', reference: 'synthetic-too-late' }; } }, 10);
    assert.equal((await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE')).status, 200);
    release(); await new Promise(r => setImmediate(r));
    await processLease(f.db.pool, lease, success); await drain(f.db.pool, success);
    assert.equal(calls, 1);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM receipts WHERE id=$1', [q.r.id])).rows[0].n, 0);
    assert.equal((await f.post('/conversations', { title: 'Replay after purge' })).status, 401);
  } finally { release?.(); await f.close(); }
});
