import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, foundation, request } from './helpers.ts';
import { claim, processLease, drain, type SyntheticAdapter } from '../src/worker.ts';

async function fixture() {
  const db = await database(); const api = (await foundation())!; await api.migrate(db.pool);
  const a = await api.bootstrap(db.pool); const app = api.buildApp(db.pool);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID()) => request(base, path, a.token, body, 'POST', key);
  const c = (await post('/conversations', { title: 'Fixture' })).body;
  const t = (await post('/tasks', { conversationId: c.id, goal: 'Failure recovery' })).body;
  const ar = (await post('/artifacts', { taskId: t.id, title: 'Draft', content: { text: 'Synthetic', language: 'en' } })).body;
  const intent = async (expiry = 300) => (await post('/intents', { artifactId: ar.id, revision: 1, operation: 'simulate.send', account: 'synthetic-account', recipient: 'fixture@example.invalid', expiresInSeconds: expiry })).body;
  const queued = async () => { const i = await intent(); const p = (await post(`/intents/${i.id}/approve`, { bindingHash: i.bindingHash })).body;
    const key = randomUUID(), body = { approvalId: p.id, bindingHash: i.bindingHash };
    const r = (await post(`/intents/${i.id}/execute`, body, key)).body;
    assert.deepEqual((await post(`/intents/${i.id}/execute`, body, key)).body, r);
    return { i, p, r }; };
  return { db, api, a, app, base, post, intent, queued, taskId: t.id, artifactId: ar.id, async close() { await app.close(); await db.close(); } };
}
const success: SyntheticAdapter = { kind: 'synthetic', async send() { return { outcome: 'succeeded', reference: 'synthetic-ok' }; } };

test('Revoked and expired approval cannot authorize queued dispatch', async () => {
  const f = await fixture(); try {
    const { i, p, r } = await f.queued();
    const revoked = await f.post(`/approvals/${p.id}/revoke`, {});
    assert.equal(revoked.status, 201);
    assert.equal((await f.post(`/approvals/${p.id}/revoke`, { owner: 'injected' })).status, 400);
    let calls = 0;
    await drain(f.db.pool, { kind: 'synthetic', async send(input) { calls++; return success.send(input); } });
    assert.equal(calls, 0);
    assert.equal((await request(f.base, `/receipts/${r.id}`, f.a.token)).body.status, 'cancelled');
    assert.equal((await f.post(`/intents/${i.id}/execute`, { approvalId: p.id, bindingHash: i.bindingHash })).status, 409);
    const expired = await f.intent(1);
    await f.db.pool.query('SELECT pg_sleep(1.05)');
    assert.equal((await f.post(`/intents/${expired.id}/approve`, { bindingHash: expired.bindingHash })).status, 409);
  } finally { await f.close(); }
});

test('Ambiguous adapter exception and malformed receipt never retry or expose provider secrets', async () => {
  const f = await fixture(); try {
    let calls = 0; const queued = await f.queued();
    const ambiguous: SyntheticAdapter = { kind: 'synthetic', async send() { calls++; throw new Error('SECRET_PROVIDER_TOKEN'); } };
    await drain(f.db.pool, ambiguous); await drain(f.db.pool, ambiguous);
    assert.equal(calls, 1);
    const response = await request(f.base, `/receipts/${queued.r.id}`, f.a.token);
    assert.equal(response.body.status, 'outcome_unknown'); assert.ok(!JSON.stringify(response).includes('SECRET'));
    const malformed = await f.queued();
    await drain(f.db.pool, { kind: 'synthetic', async send() { return { outcome: 'succeeded', reference: 'SECRET_PROVIDER_TOKEN' }; } });
    assert.equal((await request(f.base, `/receipts/${malformed.r.id}`, f.a.token)).body.status, 'outcome_unknown');
    assert.ok(!JSON.stringify((await f.db.pool.query('SELECT * FROM receipts')).rows).includes('SECRET'));
  } finally { await f.close(); }
});

test('Expired lease fences old worker; crash executing marker recovers unknown without repeating effect', async () => {
  const f = await fixture(); try {
    const q = await f.queued();
    await f.db.pool.query("UPDATE outbox SET state='done' WHERE kind<>'action.execute'");
    const old = await claim(f.db.pool, 1); assert.ok(old);
    await f.db.pool.query('SELECT pg_sleep(0.02)');
    const fresh = await claim(f.db.pool); assert.ok(fresh); assert.notEqual(old.lease_token, fresh.lease_token);
    let calls = 0; const adapter: SyntheticAdapter = { kind: 'synthetic', async send(input) { calls++; return success.send(input); } };
    await processLease(f.db.pool, old, adapter); assert.equal(calls, 0);
    // Fault injection at the durable crash boundary: I/O may have happened, no receipt committed.
    await f.db.pool.query("UPDATE receipts SET status='executing',started_at=now() WHERE id=$1", [q.r.id]);
    await f.db.pool.query("UPDATE outbox SET lease_until=now()-interval '1 second' WHERE id=$1", [fresh.id]);
    await f.app.close(); await f.db.restart();
    await drain(f.db.pool, adapter); assert.equal(calls, 0);
    assert.equal((await f.db.pool.query('SELECT status FROM receipts WHERE id=$1', [q.r.id])).rows[0].status, 'outcome_unknown');
  } finally { await f.close(); }
});

test('Cancelled task invalidates queued policy before dispatch', async () => {
 const f = await fixture(); try {
  const q = await f.queued();
  assert.equal((await f.post(`/tasks/${f.taskId}/transition`, { baseVersion: 1, status: 'cancelled' })).status,201);
  let calls = 0;
  await drain(f.db.pool, { kind:'synthetic', async send(input) { calls++; return success.send(input); } });
  assert.equal(calls,0);
  assert.equal((await request(f.base, `/receipts/${q.r.id}`, f.a.token)).body.status,'cancelled');
 } finally { await f.close(); }
});

test('Timeout after synthetic dispatch becomes unknown and a late return cannot overwrite it', async () => {
 const f = await fixture(); try {
  const q = await f.queued(); await f.db.pool.query("UPDATE outbox SET state='done' WHERE kind<>'action.execute'");
  const lease = await claim(f.db.pool); assert.ok(lease);
  let finish!: () => void; let calls = 0;
  const delayed = new Promise<void>(resolve => { finish=resolve; });
  await processLease(f.db.pool, lease, { kind:'synthetic', async send() { calls++; await delayed; return { outcome:'succeeded',reference:'synthetic-late' }; } }, 10);
  finish(); await drain(f.db.pool, success);
  assert.equal(calls,1);
  assert.equal((await request(f.base, `/receipts/${q.r.id}`, f.a.token)).body.status,'outcome_unknown');
 } finally { await f.close(); }
});

test('Worker revalidates queued revision, session expiry and intent expiry before any call', async () => {
 for (const reason of ['revision','session','expiry']) {
  const f = await fixture(); try {
   const q = await f.queued();
   if (reason==='revision') await f.post(`/artifacts/${f.artifactId}/revisions`, { baseRevision:1, content:{ text:'Changed after queue',language:'en' } });
   if (reason==='session') await f.db.pool.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
   if (reason==='expiry') await f.db.pool.query("UPDATE approvals SET expires_at=now()-interval '1 second'");
   let calls=0; await drain(f.db.pool,{ kind:'synthetic',async send(input) { calls++; return success.send(input); } });
   assert.equal(calls,0,reason);
   assert.equal((await f.db.pool.query('SELECT status FROM receipts WHERE id=$1',[q.r.id])).rows[0].status,'cancelled');
  } finally { await f.close(); }
 }
});

test('Purge during in-flight synthetic call waits and late completion cannot recreate records', async () => {
  const f = await fixture(); try {
    await f.queued();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>(r => { started = r; }); const blocked = new Promise<void>(r => { release = r; });
    const work = drain(f.db.pool, { kind: 'synthetic', async send() { started(); await blocked; return { outcome: 'succeeded', reference: 'synthetic-ok' }; } });
    await began;
    const purge = request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
    release(); await work;
    assert.equal((await purge).status, 200);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM receipts')).rows[0].n, 0);
    await drain(f.db.pool, success);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 0);
  } finally { await f.close(); }
});
