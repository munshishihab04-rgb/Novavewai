import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, request } from './helpers.ts';
import { buildApp, bootstrap, migrate } from '../src/app.ts';
import { accountLimitsFromEnv } from '../src/accounts.ts';

const reply = (text: string) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] });

test('account limits from env: default 60, parsed override, uuid list validated', () => {
  assert.deepEqual(accountLimitsFromEnv({}), { dailyRunsPerAccount: 60, unlimitedOwners: [] });
  const a = randomUUID(), b = randomUUID();
  assert.deepEqual(accountLimitsFromEnv({ NOVA_DAILY_RUNS_PER_ACCOUNT: '5', NOVA_UNLIMITED_OWNERS: ` ${a}, ${b.toUpperCase()} ,` }), { dailyRunsPerAccount: 5, unlimitedOwners: [a, b] });
  assert.throws(() => accountLimitsFromEnv({ NOVA_DAILY_RUNS_PER_ACCOUNT: '0' }), /NOVA_DAILY_RUNS_PER_ACCOUNT/);
  assert.throws(() => accountLimitsFromEnv({ NOVA_DAILY_RUNS_PER_ACCOUNT: 'many' }), /NOVA_DAILY_RUNS_PER_ACCOUNT/);
  assert.throws(() => accountLimitsFromEnv({ NOVA_UNLIMITED_OWNERS: 'ricky' }), /NOVA_UNLIMITED_OWNERS/);
});

test('daily run guard: 429 daily_limit_reached after N runs per account per day, exempt owners unlimited, no cross-account leakage', async () => {
  const db = await database(); await migrate(db.pool);
  const user = await bootstrap(db.pool), vip = await bootstrap(db.pool), neighbour = await bootstrap(db.pool);
  const fileRoot = await mkdtemp(join(tmpdir(), 'nova-limit-files-'));
  const provider = http.createServer(async (req, res) => { for await (const _ of req) {} res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply('ok'))); });
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r));
  const agent = { endpoint: `http://127.0.0.1:${(provider.address() as any).port}/v1/chat/completions`, model: 'fixture', allowLoopback: true, dailyRunsPerAccount: 2, unlimitedOwners: [vip.userId] };
  const app = buildApp(db.pool, { agent, fileRoot } as any); const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const send = (token: string, path: string, body?: unknown) => request(base, path, token, body, undefined, body === undefined ? undefined : randomUUID());
  const settled = async (token: string, id: string) => { const end = Date.now() + 6000; while (Date.now() < end) { const r = await send(token, '/runs/' + id); if (!['queued','running'].includes(r.body.status)) return r.body; await new Promise(r => setTimeout(r, 15)); } assert.fail('run did not settle'); };
  try {
    const turns = async (token: string, n: number) => {
      const c = (await send(token, '/conversations', { title: 'limit' })).body; const out: any[] = [];
      for (let i = 0; i < n; i++) { const r = await send(token, `/conversations/${c.id}/turns`, { baseSequence: i * 2, text: 'ciao ' + i }); out.push(r); if (r.status === 201) await settled(token, r.body.id); }
      return out;
    };
    const u = await turns(user.token, 3);
    assert.deepEqual(u.map(r => r.status), [201, 201, 429]);
    assert.equal(u[2].body.error, 'daily_limit_reached'); assert.match(u[2].body.detail, /domani|limite/i);
    assert.equal((await db.pool.query('SELECT runs FROM account_usage WHERE owner_id=$1 AND day=current_date', [user.userId])).rows[0].runs, 2, 'rejected turn must not be counted');
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM agent_runs WHERE owner_id=$1', [user.userId])).rows[0].n, 2, 'no run row for rejected turn');
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM messages WHERE owner_id=$1 AND role=$2', [user.userId, 'user'])).rows[0].n, 2, 'rejected message must not be persisted');
    assert.deepEqual((await turns(vip.token, 3)).map(r => r.status), [201, 201, 201], 'exempt owner has no daily cap');
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM account_usage WHERE owner_id=$1', [vip.userId])).rows[0].n, 0);
    assert.deepEqual((await turns(neighbour.token, 2)).map(r => r.status), [201, 201], 'other accounts keep their own budget');
    await db.pool.query('UPDATE account_usage SET day=current_date-1 WHERE owner_id=$1', [user.userId]);
    assert.deepEqual((await turns(user.token, 1)).map(r => r.status), [201], "yesterday's usage does not count");
  } finally { await app.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r())); await db.close(); await rm(fileRoot, { recursive: true, force: true }); }
});
