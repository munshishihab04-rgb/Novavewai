import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, foundation, request } from './helpers.ts';

test('Owner export and purge revoke all sessions and prevent stale worker/direct database resurrection', async () => {
  const db = await database(); let app: any;
  try {
    const api = (await foundation())!; await api.migrate(db.pool);
    const a = await api.bootstrap(db.pool), b = await api.bootstrap(db.pool);
    app = api.buildApp(db.pool); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown, token = a.token) => request(base, path, token, body, 'POST', randomUUID());
    const c = (await post('/conversations', { title: 'Synthetic private' })).body;
    const t = (await post('/tasks', { conversationId: c.id, goal: 'Private goal' })).body;
    const ar = (await post('/artifacts', { taskId: t.id, title: 'Private', content: { text: 'Private synthetic', language: 'it' } })).body;
    const i = (await post('/intents', { artifactId: ar.id, revision: 1, operation: 'simulate.send', account: 'synthetic-account', recipient: 'fixture@example.invalid', expiresInSeconds: 300 })).body;
    const p = (await post(`/intents/${i.id}/approve`, { bindingHash: i.bindingHash })).body;
    await post(`/intents/${i.id}/execute`, { approvalId: p.id, bindingHash: i.bindingHash });
    const snapshot = await request(base, '/me/export', a.token);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.tasks.length, 1); assert.equal(snapshot.body.revisions[0].content.text, 'Private synthetic');
    assert.ok(!JSON.stringify(snapshot.body).includes('token_hash')); assert.ok(!JSON.stringify(snapshot.body).includes('session_hash'));
    assert.equal((await request(base, '/me/export', b.token)).body.tasks.length, 0);
    const worker = await import('../src/worker.ts'); const lease = await worker.claim(db.pool);
    const deletion = await request(base, '/me', a.token, { confirm: 'purge' }, 'DELETE');
    assert.equal(deletion.status, 200); assert.equal(deletion.body.status, 'purged');
    assert.equal((await request(base, '/me/export', a.token)).status, 401);
    assert.equal((await post('/conversations', { title: 'resurrection' })).status, 401);
    let calls = 0; const adapter = { kind: 'synthetic' as const, async send() { calls++; return { outcome: 'succeeded' as const, reference: 'synthetic-result' }; } };
    await worker.processLease(db.pool, lease!, adapter); await worker.drain(db.pool, adapter); assert.equal(calls, 0);
    for (const table of ['sessions','conversations','tasks','artifacts','artifact_revisions','action_intents','approvals','receipts','outbox','idempotency','audit_events'])
      assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${table} WHERE owner_id=$1`, [a.userId])).rows[0].n, 0, table);
    await assert.rejects(db.pool.query('INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,$3)', [randomUUID(), a.userId, 'late write']), /owner inactive/);
    await assert.rejects(db.pool.query("UPDATE users SET status='active' WHERE id=$1", [a.userId]), /tombstone/);
    await assert.rejects(db.pool.query('DELETE FROM users WHERE id=$1', [a.userId]), /tombstone/);
    assert.equal((await request(base, '/me/export', b.token)).status, 200);
    await app.close(); await db.restart(); app = api.buildApp(db.pool);
    assert.equal((await app.inject({ method: 'GET', url: '/me/export', headers: { authorization: `Bearer ${a.token}` } })).statusCode, 401);
  } finally { await app?.close(); await db.close(); }
});
