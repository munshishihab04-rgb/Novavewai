import {generatedFileRoutes} from './generated-files.ts';
import { Runtime } from './runtime.ts';
import { createArtifact, reviseArtifact } from './artifacts.ts';
import { agentRoutes, type AgentOptions } from './agent.ts';
import { fileRoutes, type FileOptions } from './files.ts';
import { provenanceRoutes } from './provenance.ts';
import { contextRoutes } from './context.ts';
import { privacyRoutes } from './privacy.ts';
import { actionRoutes } from './actions.ts';
import Fastify, { type FastifyRequest } from 'fastify';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';

export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
export class SafeError extends Error { detail?: string; constructor(public status: number, public code: string) { super(code); } }
export const fail = (status: number, code: string): never => { throw new SafeError(status, code); };
export async function transaction<T>(pool: Pool, run: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const value = await run(c); await c.query('COMMIT'); return value; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function migrate(pool: Pool) {
  await transaction(pool, async c => {
    await c.query('SELECT pg_advisory_xact_lock(913002)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const directory = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await c.query(await readFile(new URL(name, directory), 'utf8'));
      await c.query('INSERT INTO schema_migrations VALUES($1)', [name]);
    }
  });
}
export async function bootstrap(pool: Pool) {
  const userId = randomUUID(), token = randomBytes(32).toString('base64url');
  await transaction(pool, async c => {
    await c.query('INSERT INTO users(id) VALUES($1)', [userId]);
    await c.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '24 hours')", [hash(token), userId]);
  });
  return { userId, token };
}
export async function active(c: PoolClient, owner: string) {
  const user = await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [owner]);
  if (!user.rowCount) fail(401, 'unauthorized');
}
export async function event(c: PoolClient, owner: string, kind: string, resource: string) {
  await c.query('INSERT INTO outbox(id,owner_id,kind,resource_id) VALUES($1,$2,$3,$4)', [randomUUID(), owner, kind, resource]);
}
const text = { type: 'string', minLength: 1, maxLength: 300 };
export const uuid = { type: 'string', format: 'uuid' };
export function closed(properties: object, required = Object.keys(properties)) { return { type: 'object', additionalProperties: false, properties, required }; }
export const identity = (r: FastifyRequest) => (r as any).owner as string;
export async function authenticatedOwner(c: PoolClient, r: FastifyRequest) {
  const owner = identity(r);
  await active(c, owner);
  // Check after the lock wait, before protected I/O or cached replay. now()
  // is frozen at BEGIN and would accept sessions that expired while waiting.
  if (!(await c.query('SELECT 1 FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp()', [owner, hash(r.headers.authorization!.slice(7))])).rowCount) fail(401, 'unauthorized');
  return owner;
}
// Call only after authenticatedOwner: the owner lock serializes BOTH durable
// namespaces. files.request_key is the upload reservation; idempotency contains
// completed responses only. Recovery releases reservations by deleting pending
// files, never by deleting a possibly unrelated completed response.
export async function idempotentResult(c: PoolClient, owner: string, key: string, fingerprint: string) {
  const old = (await c.query('SELECT fingerprint,response,status FROM idempotency WHERE owner_id=$1 AND key=$2', [owner, key])).rows[0];
  if (old) { if (old.fingerprint !== fingerprint) fail(409, 'idempotency_conflict'); return old; }
  const pending = (await c.query('SELECT fingerprint FROM files WHERE owner_id=$1 AND request_key=$2', [owner, key])).rows[0];
  if (pending) fail(409, pending.fingerprint === fingerprint ? 'upload_pending' : 'idempotency_conflict');
}
export function buildApp(pool: Pool, options: FileOptions & { agent?: AgentOptions } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 65536, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const runtime = new Runtime(pool);
  app.addHook('onReady', () => runtime.start());
  app.addHook('onClose', async () => { runtime.close(); });
  app.decorateRequest('owner', '');
  app.addHook('onRoute', route => { route.schema = { ...route.schema, querystring: route.schema?.querystring ?? closed({}) }; });
  app.addHook('onRequest', async r => {
    if (!runtime.available()) fail(503, 'agent_unavailable');
    const auth = r.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'unauthorized');
    const result = await pool.query("SELECT s.owner_id FROM sessions s JOIN users u ON u.id=s.owner_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'", [hash(auth!.slice(7))]);
    if (!result.rowCount) fail(401, 'unauthorized');
    (r as any).owner = result.rows[0].owner_id;
  });
  app.setErrorHandler((error: any, _r, reply) => {
    const status = error instanceof SafeError ? error.status : error.validation || error.statusCode === 400 ? 400 : error.statusCode === 413 ? 413 : 500;
    reply.status(status).send({ error: error instanceof SafeError ? error.code : status === 400 ? 'invalid_request' : status === 413 ? 'request_too_large' : 'internal_error', ...(error instanceof SafeError && typeof error.detail === 'string' ? { detail: error.detail } : {}) });
  });
  app.setNotFoundHandler((_r, reply) => reply.status(404).send({ error: 'not_found' }));
  const mutate = (run: (c: PoolClient, owner: string, body: any, r: FastifyRequest) => Promise<any>, status = 201) => async (r: FastifyRequest, reply: any) => {
    const key = r.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) return fail(400, 'idempotency_key_required');
    const owner = identity(r), fingerprint = hash(canonical({ method: r.method, url: r.url, body: r.body ?? null }));
    const result = await runtime.transaction(async c => {
      await authenticatedOwner(c, r);
      const old = await idempotentResult(c, owner, key, fingerprint);
      if (old) return { status: old.status, body: old.response };
      const body = await run(c, owner, r.body, r);
      await c.query('INSERT INTO idempotency(owner_id,key,fingerprint,response,status) VALUES($1,$2,$3,$4,$5)', [owner, key, fingerprint, body, status]);
      return { status, body };
    });
    reply.status(result.status).send(result.body);
  };
  app.post('/conversations', { schema: { body: closed({ title: text, ephemeral: { type: 'boolean' } }, ['title']) } }, mutate(async (c, owner, body) => {
    const id = randomUUID();
    await c.query('INSERT INTO conversations(id,owner_id,title,ephemeral) VALUES($1,$2,$3,$4)', [id, owner, body.title, body.ephemeral === true]);
    await event(c, owner, 'conversation.created', id);
    return { id, title: body.title, ephemeral: body.ephemeral === true };
  }));
  app.post('/tasks', { schema: { body: closed({ conversationId: uuid, goal: text }) } }, mutate(async (c, owner, body) => {
    if (!(await c.query('SELECT 1 FROM conversations WHERE owner_id=$1 AND id=$2', [owner, body.conversationId])).rowCount) fail(404, 'not_found');
    const id = randomUUID();
    await c.query('INSERT INTO tasks(id,owner_id,conversation_id,goal) VALUES($1,$2,$3,$4)', [id, owner, body.conversationId, body.goal]);
    await event(c, owner, 'task.created', id);
    return { id, conversationId: body.conversationId, goal: body.goal, status: 'created', version: 1 };
  }));
  app.post('/tasks/:id/transition', { schema: { params: closed({ id: uuid }), body: closed({ baseVersion: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['active','paused','completed','cancelled'] } }) } }, mutate(async (c, owner, body, r) => {
    const id = (r.params as any).id;
    const row = (await c.query('SELECT status,version FROM tasks WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0];
    if (!row) fail(404, 'not_found');
    const transitions: Record<string,string[]> = { created: ['active','cancelled'], active: ['paused','completed','cancelled'], paused: ['active','cancelled'] };
    if (row.version !== body.baseVersion || !transitions[row.status]?.includes(body.status)) fail(409, 'task_conflict');
    await c.query('UPDATE tasks SET status=$3,version=version+1 WHERE owner_id=$1 AND id=$2', [owner, id, body.status]);
    await event(c, owner, 'task.' + body.status, id);
    return { id, status: body.status, version: row.version + 1 };
  }));
  app.get('/tasks/:id', { schema: { params: closed({ id: uuid }) } }, async r => {
    const row = (await pool.query('SELECT id,conversation_id AS "conversationId",goal,status,version FROM tasks WHERE owner_id=$1 AND id=$2', [identity(r), (r.params as any).id])).rows[0];
    return row ?? fail(404, 'not_found');
  });
  const content = closed({ text: { type: 'string', maxLength: 20000 }, language: { type: 'string', enum: ['it', 'bn', 'en'] } });
  app.post('/artifacts', { schema: { body: closed({ taskId: uuid, title: text, content }) } }, mutate(async (c, owner, body) => {
    return createArtifact(c, owner, body);
  }));
  app.post('/artifacts/:id/revisions', { schema: { params: closed({ id: uuid }), body: closed({ baseRevision: { type: 'integer', minimum: 1 }, content }) } }, mutate(async (c, owner, body, r) => {
    const id = (r.params as any).id;
    return reviseArtifact(c, owner, id, body);
  }));
  for (const suffix of ['', '/export']) app.get('/artifacts/:id/revisions/:revision' + suffix, { schema: { params: closed({ id: uuid, revision: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' } }) } }, async r => {
    const p = r.params as any;
    const row = (await pool.query('SELECT artifact_id AS id,revision,content,hash FROM artifact_revisions WHERE owner_id=$1 AND artifact_id=$2 AND revision=$3', [identity(r), p.id, Number(p.revision)])).rows[0];
    if (!row) fail(404, 'not_found');
    return suffix ? { ...row, renderer: 'canonical-json-v1' } : row;
  });
  generatedFileRoutes(app,pool,runtime);
  const fileStore = fileRoutes(app, pool, options, runtime);
  provenanceRoutes(app, pool, mutate, fileStore);
  contextRoutes(app, pool, mutate);
  privacyRoutes(app, pool, fileStore);
  actionRoutes(app, pool, mutate);
  agentRoutes(app, pool, mutate, runtime, options.agent, fileStore);
  return app;
}
