import test from 'node:test';
import assert from 'node:assert/strict';
import { database, foundation, request } from './helpers.ts';

 test('HTTP authenticated task persists through application and PostgreSQL restart', async () => {
  const db = await database();
  let app: any;
  try {
    const api = await foundation();
    assert.ok(api, 'foundation API must exist');
    await api.migrate(db.pool);
    const a = await api.bootstrap(db.pool);
    const b = await api.bootstrap(db.pool);
    app = api.buildApp(db.pool);
    let base = await app.listen({ host: '127.0.0.1', port: 0 });
    assert.equal((await request(base, '/conversations', undefined, { unexpected: true })).status, 401);
    assert.equal((await request(base, '/conversations', a.token, { title: 'a', owner_id: b.userId })).status, 400);
    const c = await request(base, '/conversations', a.token, { title: 'Synthetic conversation' }, 'POST', 'conversation-1');
    assert.equal(c.status, 201);
    const t = await request(base, '/tasks', a.token, { conversationId: c.body.id, goal: 'Synthetic goal' }, 'POST', 'task-1');
    assert.equal(t.status, 201);
    assert.deepEqual((await request(base, '/tasks', a.token, { conversationId: c.body.id, goal: 'Synthetic goal' }, 'POST', 'task-1')).body, t.body);
    assert.equal((await request(base, '/tasks', a.token, { conversationId: c.body.id, goal: 'changed' }, 'POST', 'task-1')).status, 409);
    assert.equal((await request(base, '/tasks/' + t.body.id, b.token)).status, 404);
    const hashes = await db.pool.query('SELECT token_hash FROM sessions');
    assert.ok(hashes.rows.every(r => r.token_hash !== a.token && /^[a-f0-9]{64}$/.test(r.token_hash)));
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 2);
    await app.close(); await db.restart();
    app = api.buildApp(db.pool); base = await app.listen({ host: '127.0.0.1', port: 0 });
    assert.deepEqual((await request(base, '/tasks/' + t.body.id, a.token)).body, t.body);
    assert.equal((await request(base, '/bootstrap', undefined, {})).status, 401);
  } finally { await app?.close(); await db.close(); }
 });
