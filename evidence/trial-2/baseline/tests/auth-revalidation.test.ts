import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, request } from './helpers.ts';
import { migrate, bootstrap, buildApp, hash } from '../src/app.ts';

// Adapted from evidence/review-1/adversarial.test.ts; keep that review immutable.
async function fixture() {
  const db = await database(); await migrate(db.pool);
  const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  // An unrelated live session must not authorize the original request.
  await db.pool.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '24 hours')", [hash(randomUUID()), a.userId]);
  const app = buildApp(db.pool); const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID()) => request(base, path, a.token, body, 'POST', key);
  const replayKey = randomUUID(), replayBody = { title: 'Private cached conversation' };
  const original = await post('/conversations', replayBody, replayKey);
  assert.equal(original.status, 201);
  assert.equal((await post('/tasks', { conversationId: original.body.id, goal: 'Keep private' })).status, 201);
  return { db, a, b, app, base, post, replayKey, replayBody, async close() { await app.close(); await db.close(); } };
}
async function waitForOwnerWaiter(f: Awaited<ReturnType<typeof fixture>>) {
  for (let n = 0; n < 300; n++) {
    const result = await f.db.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=$1%' AND pid<>pg_backend_pid()");
    if (result.rows[0].n > 0) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Expected HTTP transaction blocked on owner row');
}
async function protectedState(f: Awaited<ReturnType<typeof fixture>>) {
  const owner = (await f.db.pool.query('SELECT * FROM users WHERE id=$1', [f.a.userId])).rows;
  const content: Record<string, unknown> = { owner };
  for (const table of ['conversations', 'tasks', 'idempotency', 'outbox']) {
    content[table] = (await f.db.pool.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY 1,2`, [f.a.userId])).rows;
  }
  return content;
}

for (const invalidation of ['expiry', 'revoke', 'rebind'] as const) {
  for (const route of ['mutation', 'replay', 'export', 'purge'] as const) {
    test(`AUTH-RECHECK ${invalidation} ${route}: reject stale authentication after owner-lock wait`, async () => {
      const f = await fixture(); const blocker = await f.db.pool.connect();
      let pending: ReturnType<typeof request> | undefined;
      try {
        const before = await protectedState(f);
        if (invalidation === 'expiry') {
          await f.db.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1", [hash(f.a.token)]);
        }
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.a.userId]);
        pending = route === 'mutation' ? f.post('/conversations', { title: 'Forbidden late write' })
          : route === 'replay' ? f.post('/conversations', f.replayBody, f.replayKey)
          : route === 'export' ? request(f.base, '/me/export', f.a.token)
          : request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
        await waitForOwnerWaiter(f);
        if (invalidation === 'expiry') {
          await f.db.pool.query('SELECT pg_sleep(2.1)');
          assert.equal((await f.db.pool.query('SELECT expires_at<clock_timestamp() expired FROM sessions WHERE token_hash=$1', [hash(f.a.token)])).rows[0].expired, true);
        } else {
          // Local operator action, not a public session-management endpoint.
          await blocker.query('DELETE FROM sessions WHERE token_hash=$1', [hash(f.a.token)]);
          if (invalidation === 'rebind') {
            // Delete/reinsert avoids the owner-immutability trigger; a token now
            // belonging to B must not authorize the request authenticated as A.
            await blocker.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '24 hours')", [hash(f.a.token), f.b.userId]);
          }
        }
        await blocker.query('COMMIT');
        const result = await pending;
        assert.equal(result.status, 401, 'Recheck must bind current expiry, original token and original owner before any I/O or cached replay');
        assert.deepEqual(result.body, { error: 'unauthorized' }, 'No private content or cached response may escape');
        assert.deepEqual(await protectedState(f), before, 'No mutation, purge, cache or outbox change may commit');
      } finally {
        await blocker.query('ROLLBACK'); blocker.release();
        await pending?.catch(() => {}); await f.close();
      }
    });
  }
}
