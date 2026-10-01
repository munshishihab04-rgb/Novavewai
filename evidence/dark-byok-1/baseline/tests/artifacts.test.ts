import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, foundation, request } from './helpers.ts';

test('Artifact append-only revisions, concurrent conflict and owner-scoped revision export', async () => {
  const db = await database(); let app: any;
  try {
    const api = (await foundation())!; await api.migrate(db.pool);
    const a = await api.bootstrap(db.pool), b = await api.bootstrap(db.pool);
    app = api.buildApp(db.pool); const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const post = (path: string, body: unknown) => request(base, path, a.token, body, 'POST', randomUUID());
    const conv = (await post('/conversations', { title: 'Synthetic' })).body;
    const task = (await post('/tasks', { conversationId: conv.id, goal: 'Draft' })).body;
    const made = await post('/artifacts', { taskId: task.id, title: 'Synthetic draft', content: { text: 'First', language: 'it' } });
    assert.equal(made.status, 201);
    const artifact = made.body;
    const updates = await Promise.all(['Second', 'Concurrent'].map(text => post(`/artifacts/${artifact.id}/revisions`, { baseRevision: 1, content: { text, language: 'it' } })));
    assert.deepEqual(updates.map(r => r.status).sort(), [201, 409]);
    const first = await request(base, `/artifacts/${artifact.id}/revisions/1`, a.token);
    assert.equal(first.body.content.text, 'First');
    const exported = await request(base, `/artifacts/${artifact.id}/revisions/1/export`, a.token);
    assert.equal(exported.status, 200); assert.equal(exported.body.content.text, 'First');
    assert.equal(exported.body.hash, first.body.hash); assert.equal(exported.body.renderer, 'canonical-json-v1');
    for (const suffix of ['', '/export']) assert.equal((await request(base, `/artifacts/${artifact.id}/revisions/1${suffix}`, b.token)).status, 404);
    await assert.rejects(db.pool.query("UPDATE artifact_revisions SET content='{}' WHERE artifact_id=$1", [artifact.id]), /immutable/);
    await assert.rejects(db.pool.query('DELETE FROM artifact_revisions WHERE artifact_id=$1', [artifact.id]), /immutable/);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM artifact_revisions WHERE artifact_id=$1', [artifact.id])).rows[0].n, 2);
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind LIKE 'artifact.%'")).rows[0].n, 2);
  } finally { await app?.close(); await db.close(); }
});
