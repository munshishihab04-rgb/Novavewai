import { privacyRoutes } from './privacy.ts';
import { actionRoutes } from './actions.ts';
import Fastify, { type FastifyRequest } from 'fastify';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';

export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
export class SafeError extends Error { constructor(public status: number, public code: string) { super(code); } }
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
export const closed = (properties: object, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const identity = (r: FastifyRequest) => (r as any).owner as string;
export function buildApp(pool: Pool) {
  const app = Fastify({ logger: false, bodyLimit: 65536, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.decorateRequest('owner', '');
  app.addHook('onRoute', route => { route.schema = { ...route.schema, querystring: closed({}) }; });
  app.addHook('onRequest', async r => {
    const auth = r.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) fail(401, 'unauthorized');
    const result = await pool.query("SELECT s.owner_id FROM sessions s JOIN users u ON u.id=s.owner_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'", [hash(auth!.slice(7))]);
    if (!result.rowCount) fail(401, 'unauthorized');
    (r as any).owner = result.rows[0].owner_id;
  });
  app.setErrorHandler((error: any, _r, reply) => {
    const status = error instanceof SafeError ? error.status : error.validation || error.statusCode === 400 ? 400 : error.statusCode === 413 ? 413 : 500;
    reply.status(status).send({ error: error instanceof SafeError ? error.code : status === 400 ? 'invalid_request' : status === 413 ? 'request_too_large' : 'internal_error' });
  });
  app.setNotFoundHandler((_r, reply) => reply.status(404).send({ error: 'not_found' }));
  const mutate = (run: (c: PoolClient, owner: string, body: any, r: FastifyRequest) => Promise<any>, status = 201) => async (r: FastifyRequest, reply: any) => {
    const key = r.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) fail(400, 'idempotency_key_required');
    const owner = identity(r), fingerprint = hash(canonical({ method: r.method, url: r.url, body: r.body ?? null }));
    const result = await transaction(pool, async c => {
      await active(c, owner);
      // Recheck the session under the same owner lock as all mutations/purge.
      if (!(await c.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hash(r.headers.authorization!.slice(7))])).rowCount) fail(401, 'unauthorized');
      const old = (await c.query('SELECT * FROM idempotency WHERE owner_id=$1 AND key=$2', [owner, key])).rows[0];
      if (old) { if (old.fingerprint !== fingerprint) fail(409, 'idempotency_conflict'); return { status: old.status, body: old.response }; }
      const body = await run(c, owner, r.body, r);
      await c.query('INSERT INTO idempotency(owner_id,key,fingerprint,response,status) VALUES($1,$2,$3,$4,$5)', [owner, key, fingerprint, body, status]);
      return { status, body };
    });
    reply.status(result.status).send(result.body);
  };
  app.post('/conversations', { schema: { body: closed({ title: text }) } }, mutate(async (c, owner, body) => {
    const id = randomUUID();
    await c.query('INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,$3)', [id, owner, body.title]);
    await event(c, owner, 'conversation.created', id);
    return { id, title: body.title };
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
    if (!(await c.query('SELECT 1 FROM tasks WHERE owner_id=$1 AND id=$2', [owner, body.taskId])).rowCount) fail(404, 'not_found');
    const id = randomUUID(), digest = hash(canonical(body.content));
    await c.query('INSERT INTO artifacts(id,owner_id,task_id,title,current_revision) VALUES($1,$2,$3,$4,1)', [id, owner, body.taskId, body.title]);
    await c.query('INSERT INTO artifact_revisions(owner_id,artifact_id,revision,content,hash) VALUES($1,$2,1,$3,$4)', [owner, id, body.content, digest]);
    await event(c, owner, 'artifact.created', id);
    return { id, revision: 1, content: body.content, hash: digest };
  }));
  app.post('/artifacts/:id/revisions', { schema: { params: closed({ id: uuid }), body: closed({ baseRevision: { type: 'integer', minimum: 1 }, content }) } }, mutate(async (c, owner, body, r) => {
    const id = (r.params as any).id;
    const artifact = (await c.query('SELECT current_revision FROM artifacts WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0];
    if (!artifact) fail(404, 'not_found');
    if (artifact.current_revision !== body.baseRevision) fail(409, 'revision_conflict');
    const revision = artifact.current_revision + 1, digest = hash(canonical(body.content));
    await c.query('INSERT INTO artifact_revisions(owner_id,artifact_id,revision,content,hash) VALUES($1,$2,$3,$4,$5)', [owner, id, revision, body.content, digest]);
    await c.query('UPDATE artifacts SET current_revision=$3 WHERE owner_id=$1 AND id=$2', [owner, id, revision]);
    await event(c, owner, 'artifact.revised', id);
    return { id, revision, content: body.content, hash: digest };
  }));
  for (const suffix of ['', '/export']) app.get('/artifacts/:id/revisions/:revision' + suffix, { schema: { params: closed({ id: uuid, revision: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' } }) } }, async r => {
    const p = r.params as any;
    const row = (await pool.query('SELECT artifact_id AS id,revision,content,hash FROM artifact_revisions WHERE owner_id=$1 AND artifact_id=$2 AND revision=$3', [identity(r), p.id, Number(p.revision)])).rows[0];
    if (!row) fail(404, 'not_found');
    return suffix ? { ...row, renderer: 'canonical-json-v1' } : row;
  });
  privacyRoutes(app, pool);
  actionRoutes(app, pool, mutate);
  return app;
}
