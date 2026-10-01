import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, foundation, request } from './helpers.ts';

test('Task lifecycle optimistic locking rejects stale/illegal transitions and resumes persisted checkpoint', async () => {
  const db = await database(); let app: any;
  try {
    const api = (await foundation())!; await api.migrate(db.pool); const a = await api.bootstrap(db.pool), b = await api.bootstrap(db.pool);
    app = api.buildApp(db.pool); let base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown, token = a.token) => request(base, path, token, body, 'POST', randomUUID());
    const c = (await post('/conversations', { title: 'Lifecycle' })).body;
    const t = (await post('/tasks', { conversationId: c.id, goal: 'Resume checkpoint' })).body;
    assert.equal((await post(`/tasks/${t.id}/transition`, { baseVersion: 1, status: 'active' })).status, 201);
    assert.equal((await post(`/tasks/${t.id}/transition`, { baseVersion: 2, status: 'paused' }, b.token)).status, 404);
    const changes = await Promise.all(['paused','completed'].map(status => post(`/tasks/${t.id}/transition`, { baseVersion: 2, status })));
    assert.deepEqual(changes.map(r => r.status).sort(), [201,409]);
    const winner = changes.find(r => r.status === 201)!.body;
    await app.close(); await db.restart(); app = api.buildApp(db.pool); base = await app.listen({ host: '127.0.0.1', port: 0 });
    const state = (await request(base, `/tasks/${t.id}`, a.token)).body;
    assert.equal(state.version, 3); assert.equal(state.status, winner.status);
    const next = await post(`/tasks/${t.id}/transition`, { baseVersion: 3, status: 'active' });
    assert.equal(next.status, winner.status === 'paused' ? 201 : 409);
  } finally { await app?.close(); await db.close(); }
});
