import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, request } from './helpers.ts';
import { migrate, bootstrap, buildApp, hash } from '../src/app.ts';

async function fixture() {
  const db = await database(); await migrate(db.pool);
  const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  let app = buildApp(db.pool), base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID(), token = a.token) => request(base, path, token, body, 'POST', key);
  const conv = (await post('/conversations', { title: 'Synthetic context' })).body;
  return { db, a, b, conv, post, get: (path: string, token = a.token) => request(base, path, token),
    async restart() { await app.close(); await db.restart(); app = buildApp(db.pool); base = await app.listen({ host: '127.0.0.1', port: 0 }); },
    async close() { await app.close(); await db.close(); } };
}

test('CONTEXT AUTH: exact token revoked during owner lock blocks message read and append', async () => {
  const f = await fixture();
  const blocker = await f.db.pool.connect(); let pending: Promise<any> | undefined;
  try {
    const path = `/conversations/${f.conv.id}/messages`;
    await f.post(path, { baseSequence: 0, text: 'Never disclose after revocation' });
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.a.userId]);
    pending = Promise.all([f.get(path), f.post(path, { baseSequence: 1, text: 'forbidden' })]);
    let waiting = false;
    for (let n = 0; n < 300; n++) {
      const result = await f.db.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=$1%'");
      if (result.rows[0].n >= 2) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(waiting, true);
    await blocker.query('DELETE FROM sessions WHERE token_hash=$1', [hash(f.a.token)]); await blocker.query('COMMIT');
    assert.deepEqual((await pending).map((x: any) => x.status), [401, 401]);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n, 1);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); await pending?.catch(() => {}); await f.close(); }
});

test('PROVENANCE: exact revision, literal snapshot, conversation boundaries and declared scopes', async () => {
  const f = await fixture();
  try {
    const message = (await f.post(`/conversations/${f.conv.id}/messages`, { baseSequence: 0, text: 'I speak italiano' })).body;
    const made = await f.post('/sources', { conversationId: f.conv.id, messageId: message.id });
    assert.equal(made.status, 201); const source = made.body;
    assert.equal(source.trust, 'user_supplied'); assert.equal(source.snapshot, 'I speak italiano');
    const task = (await f.post('/tasks', { conversationId: f.conv.id, goal: 'Draft' })).body;
    const artifact = (await f.post('/artifacts', { taskId: task.id, title: 'Draft', content: { text: 'italiano', language: 'it' } })).body;
    const body = { sourceId: source.id, artifactId: artifact.id, revision: 1, targetKind: 'field', target: '/text', excerpt: 'italiano', territory: 'IT (declared)', validFrom: '2026-01-01', validUntil: '2026-12-31' };
    const evidence = await f.post('/evidence', body); assert.equal(evidence.status, 201);
    assert.equal(evidence.body.verificationMethod, 'literal_excerpt'); assert.equal(evidence.body.status, 'unverified');
    assert.equal((await f.post('/evidence', { ...body, excerpt: 'French' })).status, 400);
    assert.equal((await f.post('/evidence', { ...body, target: '/invented' })).status, 400);
    assert.equal((await f.post('/evidence', { ...body, validUntil: '2025-01-01' })).status, 400);
    assert.equal((await f.post('/evidence', { ...body, verified: true })).status, 400);
    assert.equal((await f.post('/evidence', body, randomUUID(), f.b.token)).status, 404);
    const other = (await f.post('/conversations', { title: 'Other' })).body;
    assert.equal((await f.post('/sources', { conversationId: other.id, messageId: message.id })).status, 404);
    const otherMessage = (await f.post(`/conversations/${other.id}/messages`, { baseSequence: 0, text: 'italiano' })).body;
    const otherSource = (await f.post('/sources', { conversationId: other.id, messageId: otherMessage.id })).body;
    assert.equal((await f.post('/evidence', { ...body, sourceId: otherSource.id })).status, 409);
    assert.equal((await f.post('/evidence', { ...body, targetKind: 'claim', target: 'language claim' })).status, 201);
    await f.post(`/artifacts/${artifact.id}/revisions`, { baseRevision: 1, content: { text: 'new', language: 'it' } });
    await f.restart();
    const path = `/artifacts/${artifact.id}/revisions/1/evidence`;
    const read = await f.get(path); assert.equal(read.body.items.length, 2);
    assert.equal(read.body.items[0].excerpt, 'italiano');
    assert.equal((await f.get(path, f.b.token)).status, 404);
    assert.equal((await f.get(`/artifacts/${artifact.id}/revisions/2/evidence`)).body.items.length, 0);
    for (const table of ['sources', 'evidence']) await assert.rejects(f.db.pool.query(`DELETE FROM ${table} WHERE owner_id=$1`, [f.a.userId]), /immutable/);
    const exported = await f.get('/me/export'); assert.equal(exported.body.sources.length, 2); assert.equal(exported.body.evidence.length, 2);
  } finally { await f.close(); }
});

test('MESSAGES: immutable owned sequence, replay, pagination and restart', async () => {
  const f = await fixture();
  try {
    const path = `/conversations/${f.conv.id}/messages`, key = randomUUID();
    const body = { baseSequence: 0, text: 'I speak বাংলা and italiano' };
    const first = await f.post(path, body, key);
    assert.equal(first.status, 201);
    assert.equal(first.body.role, 'user'); assert.equal(first.body.sequence, 1);
    assert.deepEqual(await f.post(path, body, key), first);
    assert.equal((await f.post(path, { ...body, text: 'different' }, key)).status, 409);
    const concurrent = await Promise.all(['Second', 'Other'].map(text => f.post(path, { baseSequence: 1, text })));
    assert.deepEqual(concurrent.map(x => x.status).sort(), [201, 409]);
    assert.equal((await f.post(path, { baseSequence: 2, text: 'Third' })).status, 201);
    assert.equal((await f.get(path, f.b.token)).status, 404);
    assert.equal((await f.post(path, { baseSequence: 3, text: 'Intrusion' }, randomUUID(), f.b.token)).status, 404);
    assert.equal((await f.post(path, { baseSequence: 3, text: 'Impersonate', role: 'assistant' })).status, 400);
    assert.equal((await f.get(path + '?limit=51')).status, 400);
    await f.restart();
    const page = await f.get(path + '?after=0&limit=2');
    assert.equal(page.status, 200); assert.equal(page.body.items.length, 2); assert.equal(page.body.nextAfter, 2);
    assert.equal(page.body.items[0].text, body.text);
    const last = await f.get(path + '?after=2&limit=2');
    assert.equal(last.body.items[0].text, 'Third'); assert.equal(last.body.nextAfter, null);
    await assert.rejects(f.db.pool.query('UPDATE messages SET text=$1 WHERE id=$2', ['tamper', first.body.id]), /immutable/);
    await assert.rejects(f.db.pool.query('INSERT INTO messages(id,owner_id,conversation_id,sequence,text) VALUES($1,$2,$3,4,$4)', [randomUUID(), f.b.userId, f.conv.id, 'wrong owner']), /foreign key/);
    const exported = await f.get('/me/export'); assert.equal(exported.body.messages.length, 3);
  } finally { await f.close(); }
});
