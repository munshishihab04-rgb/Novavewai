import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, foundation, request } from './helpers.ts';

test('Closed query and body schemas, redacted parser/DB errors, expired sessions and cross-owner foreign keys', async () => {
 const db = await database(); let app: any;
 try {
  const api = (await foundation())!; await api.migrate(db.pool); const a = await api.bootstrap(db.pool), b = await api.bootstrap(db.pool);
  app = api.buildApp(db.pool); const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, token=a.token) => request(base,path,token,body,'POST',randomUUID());
  const c = (await post('/conversations', { title: 'Synthetic' })).body;
  const t = (await post('/tasks', { conversationId: c.id, goal: 'Test isolation' })).body;
  assert.equal((await request(base, `/tasks/${t.id}?owner=${b.userId}`, a.token)).status, 400);
  assert.equal((await post('/tasks', { conversationId: c.id, goal: 'Cross owner' }, b.token)).status, 404);
  assert.equal((await post('/artifacts', { taskId: t.id, title: 'Cross owner', content: { text: 'x', language: 'it' } }, b.token)).status, 404);
  assert.equal((await post('/artifacts', { taskId: t.id, title: 'Unknown key', content: { text: 'x', language: 'it', system: 'bypass' } })).status, 400);
  const broken = await fetch(base + '/conversations', { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type':'application/json' }, body: '{"SECRET_INPUT":' });
  assert.equal(broken.status, 400); assert.deepEqual(await broken.json(), { error: 'invalid_request' });
  const noAuth = await fetch(base + '/tasks', { method:'POST', headers:{ 'content-type':'application/json' }, body:'not-json' }); assert.equal(noAuth.status,401);
  await db.pool.query(`CREATE FUNCTION injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SECRET_DB_DETAIL'; END $$;
    CREATE TRIGGER injected_failure BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION injected_failure()`);
  const before = (await db.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n;
  assert.deepEqual(await post('/conversations', { title: 'Failure' }), { status:500, body:{ error:'internal_error' } });
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, before);
  await db.pool.query('DROP TRIGGER injected_failure ON conversations');
  await db.pool.query('CREATE TRIGGER injected_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION injected_failure()');
  const taskCount = (await db.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n;
  assert.equal((await post('/tasks', { conversationId: c.id, goal: 'Must roll back when outbox fails' })).status,500);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM tasks')).rows[0].n, taskCount);
  assert.equal((await db.pool.query('SHOW listen_addresses')).rows[0].listen_addresses,'127.0.0.1');
  const hba = (await db.pool.query('SELECT auth_method FROM pg_hba_file_rules WHERE error IS NULL')).rows;
  assert.ok(hba.length > 0 && hba.every(r => r.auth_method === 'scram-sha-256'));
  await db.pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE owner_id=$1", [a.userId]);
  assert.equal((await request(base, `/tasks/${t.id}`, a.token)).status,401);
 } finally { await app?.close(); await db.close(); }
});
