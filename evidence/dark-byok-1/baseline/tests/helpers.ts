import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import pg from 'pg';

export async function database() {
  const dir = await mkdtemp(join(tmpdir(), 'nova-j0-'));
  await chmod(dir, 0o700);
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const password = randomBytes(32).toString('hex');
  const embedded = new EmbeddedPostgres({ databaseDir: join(dir, 'db'), user: 'nova_test', password,
    port, persistent: true, authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1', '-k', dir], onLog: () => {}, onError: () => {} });
  const config = { host: '127.0.0.1', port, user: 'nova_test', password, database: 'postgres' };
  try { await embedded.initialise(); await embedded.start(); }
  catch (error) { await embedded.stop().catch(() => {}); await rm(dir, { recursive: true, force: true }); throw error; }
  let pool = new pg.Pool(config);
  return {
    get pool() { return pool; },
    config,
    async restart() { await pool.end(); await embedded.stop(); await embedded.start(); pool = new pg.Pool(config); },
    async close() { await pool.end(); await embedded.stop(); await rm(dir, { recursive: true, force: true }); },
  };
}

export async function foundation() {
  try { return await import('../src/app.ts'); }
  catch (error: any) { if (error.code === 'ERR_MODULE_NOT_FOUND') return null; throw error; }
}

export async function request(base: string, path: string, token?: string, body?: unknown, method?: string, key?: string) {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}
