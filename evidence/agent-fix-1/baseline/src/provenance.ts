import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { authenticatedOwner, closed, event, fail, hash, transaction, uuid } from './app.ts';
import type { LocalFiles } from './local-files.ts';
import type { Mutate } from './context.ts';
export function provenanceRoutes(app: FastifyInstance, pool: Pool, mutate: Mutate, store?: LocalFiles) {
  app.post('/sources', { schema: { body: { ...closed({ conversationId: uuid, messageId: uuid, fileId: uuid }, ['conversationId']), oneOf: [{ required: ['messageId'] }, { required: ['fileId'] }] } } }, mutate(async (c, owner, body, r) => {
    if (body.fileId) {
      const file = (await c.query("SELECT id,size,hash FROM files WHERE owner_id=$1 AND conversation_id=$2 AND id=$3 AND state='ready'", [owner, body.conversationId, body.fileId])).rows[0];
      if (!file) fail(404, 'not_found');
      if (!store) fail(503, 'file_storage_unavailable');
      let bytes: Buffer;
      try { bytes = await store!.get(owner, file.id, file.size, file.hash); } catch { return fail(409, 'file_integrity_failure'); }
      await authenticatedOwner(c, r);
      const id = randomUUID(), snapshot = bytes.toString('utf8');
      await c.query('INSERT INTO sources(id,owner_id,conversation_id,file_id,snapshot,hash) VALUES($1,$2,$3,$4,$5,$6)', [id, owner, body.conversationId, file.id, snapshot, file.hash]);
      await event(c, owner, 'source.created', id);
      return { id, conversationId: body.conversationId, fileId: file.id, snapshot, hash: file.hash, trust: 'user_supplied' };
    }
    const message = (await c.query('SELECT text FROM messages WHERE owner_id=$1 AND conversation_id=$2 AND id=$3', [owner, body.conversationId, body.messageId])).rows[0];
    if (!message) fail(404, 'not_found');
    const id = randomUUID(), digest = hash(message.text);
    await c.query('INSERT INTO sources(id,owner_id,conversation_id,message_id,snapshot,hash) VALUES($1,$2,$3,$4,$5,$6)', [id, owner, body.conversationId, body.messageId, message.text, digest]);
    await event(c, owner, 'source.created', id);
    return { id, conversationId: body.conversationId, messageId: body.messageId, snapshot: message.text, hash: digest, trust: 'user_supplied' };
  }));
  const date = { type: 'string', format: 'date' }, bounded = { type: 'string', minLength: 1, maxLength: 300 };
  app.post('/evidence', { schema: { body: closed({ sourceId: uuid, artifactId: uuid, revision: { type: 'integer', minimum: 1, maximum: 2147483647 }, targetKind: { type: 'string', enum: ['field','claim'] }, target: bounded, excerpt: { type: 'string', minLength: 1, maxLength: 16384 }, territory: bounded, validFrom: date, validUntil: date }) } }, mutate(async (c, owner, body) => {
    const source = (await c.query('SELECT conversation_id,snapshot FROM sources WHERE owner_id=$1 AND id=$2', [owner, body.sourceId])).rows[0];
    const revision = (await c.query('SELECT t.conversation_id FROM artifact_revisions r JOIN artifacts a ON a.owner_id=r.owner_id AND a.id=r.artifact_id JOIN tasks t ON t.owner_id=a.owner_id AND t.id=a.task_id WHERE r.owner_id=$1 AND r.artifact_id=$2 AND r.revision=$3', [owner, body.artifactId, body.revision])).rows[0];
    if (!source || !revision) fail(404, 'not_found');
    if (source.conversation_id !== revision.conversation_id) fail(409, 'conversation_conflict');
    if (!source.snapshot.includes(body.excerpt) || body.validFrom > body.validUntil || (body.targetKind === 'field' && !['/text','/language'].includes(body.target))) fail(400, 'invalid_evidence');
    const id = randomUUID();
    await c.query('INSERT INTO evidence(id,owner_id,source_id,artifact_id,revision,target_kind,target,excerpt,territory,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, owner, body.sourceId, body.artifactId, body.revision, body.targetKind, body.target, body.excerpt, body.territory, body.validFrom, body.validUntil]);
    await event(c, owner, 'evidence.created', id);
    return { id, ...body, verificationMethod: 'literal_excerpt', status: 'unverified' };
  }));
  app.get('/artifacts/:id/revisions/:revision/evidence', { schema: { params: closed({ id: uuid, revision: { type: 'string', pattern: '^[1-9][0-9]{0,8}$' } }) } }, async r => transaction(pool, async c => {
    const owner = await authenticatedOwner(c, r), p = r.params as any;
    if (!(await c.query('SELECT 1 FROM artifact_revisions WHERE owner_id=$1 AND artifact_id=$2 AND revision=$3', [owner, p.id, p.revision])).rowCount) fail(404, 'not_found');
    const items = (await c.query(`SELECT id,source_id AS "sourceId",artifact_id AS "artifactId",revision,target_kind AS "targetKind",target,excerpt,territory,valid_from::text AS "validFrom",valid_until::text AS "validUntil",verification_method AS "verificationMethod",status FROM evidence WHERE owner_id=$1 AND artifact_id=$2 AND revision=$3 ORDER BY created_at,id`, [owner, p.id, p.revision])).rows;
    return { items };
  }));
}
