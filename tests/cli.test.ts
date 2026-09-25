import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { database, request } from './helpers.ts';

function run(script: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: new URL('..', import.meta.url), env, stdio: ['ignore','pipe','pipe'] });
  let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
  return { child, output: () => output, exit: once(child, 'exit') };
}
test('Local bootstrap CLI writes private credential file; real server subprocess restarts and serves persisted tasks', async () => {
  const db = await database(); const dir = await mkdtemp(join(tmpdir(), 'nova-cli-')); let server: ReturnType<typeof run> | undefined;
  try {
    const env = { ...process.env, PGHOST: db.config.host, PGPORT: String(db.config.port), PGUSER: db.config.user, PGPASSWORD: db.config.password, PGDATABASE: db.config.database, PORT: '0' };
    const file = join(dir, 'session.json');
    const bootstrap = run('scripts/bootstrap.ts', env, [file]);
    assert.equal((await bootstrap.exit)[0], 0, 'local bootstrap CLI must succeed');
    const credentials = JSON.parse(await readFile(file, 'utf8'));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok(!bootstrap.output().includes(credentials.token));
    const launch = async () => {
      server = run('scripts/server.ts', env);
      const base = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server readiness timeout')), 10000);
        server!.child.stdout.on('data', x => { const match = String(x).match(/READY (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
        server!.child.on('exit', () => { clearTimeout(timer); reject(new Error('server exited before readiness')); });
      });
      return base;
    };
    let base = await launch();
    const c = await request(base, '/conversations', credentials.token, { title: 'CLI socket' }, 'POST', 'cli-conv');
    assert.equal(c.status, 201);
    const t = await request(base, '/tasks', credentials.token, { conversationId: c.body.id, goal: 'Survive process restart' }, 'POST', 'cli-task');
    const workerRun = run('scripts/worker.ts', env);
    assert.equal((await workerRun.exit)[0], 0, 'bounded synthetic worker CLI must succeed');
    assert.equal((await db.pool.query("SELECT count(*)::int n FROM outbox WHERE state<>'done'")).rows[0].n, 0);
    server!.child.kill('SIGTERM'); assert.equal((await server!.exit)[0], 0);
    base = await launch();
    assert.deepEqual((await request(base, '/tasks/' + t.body.id, credentials.token)).body, t.body);
    server!.child.kill('SIGTERM'); assert.equal((await server!.exit)[0], 0);
  } finally {
    if (server && server.child.exitCode === null) { server.child.kill('SIGTERM'); await server.exit; }
    await db.close(); await rm(dir, { recursive: true, force: true });
  }
});
