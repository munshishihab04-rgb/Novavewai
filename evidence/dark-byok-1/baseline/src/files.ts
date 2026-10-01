import type { Runtime } from './runtime.ts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { authenticatedOwner, canonical, closed, event, fail, hash, idempotentResult, identity, uuid } from './app.ts';
import { recoverFiles } from './file-lifecycle.ts';
import { LocalFiles } from './local-files.ts';
export interface FileOptions { fileRoot?: string; fileHooks?: { afterReservation?: () => Promise<void> } }
const projection = `id,conversation_id AS "conversationId",name,mime,size,hash,state,'local-encrypted-development' AS storage`;
export function fileRoutes(app: FastifyInstance, pool: Pool, options: FileOptions, runtime: Runtime) {
  const store = options.fileRoot ? new LocalFiles(options.fileRoot) : undefined;
  if (store) app.addHook('onReady', async () => {
    try {
      await runtime.transaction(async c => {
        await c.query('SELECT pg_advisory_xact_lock(913003)');
        const binding = (await c.query('SELECT root_hash,key_fingerprint FROM local_storage_binding')).rows[0];
        const rootHash = hash(resolve(store.root));
        if (binding && binding.root_hash !== rootHash) throw new Error('Local storage root mismatch');
        await store.init(!binding);
        if (binding && binding.key_fingerprint !== store.fingerprint()) throw new Error('Local storage key mismatch');
        if (!binding) await c.query('INSERT INTO local_storage_binding(root_hash,key_fingerprint) VALUES($1,$2)', [rootHash, store.fingerprint()]);
      });
      await recoverFiles(pool, store, runtime);
    } catch (error) { runtime.close(); throw error; }
  });
  app.post('/files', { schema: { body: closed({ conversationId: uuid, name: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}\\.txt$' }, mime: { type: 'string', const: 'text/plain' }, dataBase64: { type: 'string', minLength: 4, maxLength: 21848 } }) } }, async (r, reply) => {
    if (!store) fail(503, 'file_storage_unavailable');
    const body = r.body as any, key = r.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) return fail(400, 'idempotency_key_required');
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (!bytes.length || bytes.length > 16384) fail(413, 'file_too_large');
    if (bytes.toString('base64') !== body.dataBase64) fail(400, 'invalid_text_file');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail(400, 'invalid_text_file'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || text.trimStart().startsWith('%PDF-')) fail(400, 'invalid_text_file');
    const owner = identity(r), fingerprint = hash(canonical({ method: r.method, url: r.url, body }));
    const reserved = await runtime.transaction(async c => {
      await authenticatedOwner(c, r);
      const old = await idempotentResult(c, owner, key, fingerprint);
      if (old) return { replay: old.response };
      if (!(await c.query('SELECT 1 FROM conversations WHERE owner_id=$1 AND id=$2', [owner, body.conversationId])).rowCount) fail(404, 'not_found');
      const quota = (await c.query('SELECT count(*)::int n,coalesce(sum(size),0)::int bytes FROM files WHERE owner_id=$1', [owner])).rows[0];
      if (quota.n >= 16 || quota.bytes + bytes.length > 131072) fail(413, 'file_quota_exceeded');
      const id = randomUUID(), digest = createHash('sha256').update(bytes).digest('hex');
      await c.query("INSERT INTO files(id,owner_id,conversation_id,name,mime,size,hash,state,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)", [id, owner, body.conversationId, body.name, body.mime, bytes.length, digest, key, fingerprint]);
      return { id };
    });
    if (reserved.replay) return reply.code(201).send(reserved.replay);
    await options.fileHooks?.afterReservation?.();
    const result = await runtime.transaction(async c => {
      await authenticatedOwner(c, r);
      if (!(await c.query("SELECT 1 FROM files WHERE owner_id=$1 AND id=$2 AND state='pending'", [owner, reserved.id])).rowCount) fail(409, 'upload_cancelled');
      await store!.put(owner, reserved.id!, bytes);
      await authenticatedOwner(c, r);
      const row = (await c.query(`UPDATE files SET state='ready' WHERE owner_id=$1 AND id=$2 AND state='pending' RETURNING ${projection}`, [owner, reserved.id])).rows[0];
      await event(c, owner, 'file.ready', reserved.id!);
      await c.query('INSERT INTO idempotency(owner_id,key,fingerprint,response,status) VALUES($1,$2,$3,$4,201)', [owner, key, fingerprint, row]);
      return row;
    });
    reply.code(201).send(result);
  });
  for (const content of [false, true]) app.get('/files/:id' + (content ? '/content' : ''), { schema: { params: closed({ id: uuid }) } }, async (r, reply) => runtime.transaction(async c => {
    const owner = await authenticatedOwner(c, r);
    const row = (await c.query(`SELECT ${projection} FROM files WHERE owner_id=$1 AND id=$2 AND state='ready'`, [owner, (r.params as any).id])).rows[0];
    if (!row) fail(404, 'not_found');
    if (!content) return row;
    if (!store) fail(503, 'file_storage_unavailable');
    let bytes: Buffer;
    try { bytes = await store!.get(owner, row.id, row.size, row.hash); } catch { return fail(409, 'file_integrity_failure'); }
    await authenticatedOwner(c, r);
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${row.name}"`).header('x-content-type-options', 'nosniff').header('cache-control', 'no-store');
    return bytes;
  }));
  return store;
}
