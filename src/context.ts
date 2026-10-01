import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { authenticatedOwner, closed, event, fail, transaction, uuid } from './app.ts';
export type Mutate = (run: (c: PoolClient, owner: string, body: any, r: FastifyRequest) => Promise<any>, status?: number) => any;
export const EPHEMERAL_TTL_HOURS = 24;
// Owner-scoped hard delete of a temporary conversation. Only `ephemeral` rows qualify: ordinary history is never
// deletable here (409), so a mis-click cannot erase saved work. Cascades reach tasks/artifacts/messages/files/runs;
// file blobs go through the durable file_cleanup ledger so a crash between the two steps cannot leak bytes.
export async function deleteEphemeral(c: PoolClient, owner: string, id: string) {
  const row = (await c.query('SELECT ephemeral FROM conversations WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0];
  if (!row) fail(404, 'not_found');
  if (!row.ephemeral) fail(409, 'conversation_not_ephemeral');
  if ((await c.query("SELECT 1 FROM agent_runs WHERE owner_id=$1 AND conversation_id=$2 AND status IN ('queued','running')", [owner, id])).rowCount) fail(409, 'run_active');
  await c.query('INSERT INTO file_cleanup(id,owner_id) SELECT id,owner_id FROM files WHERE owner_id=$1 AND conversation_id=$2 ON CONFLICT DO NOTHING', [owner, id]);
  // Transaction-local permission for the cascade through the immutability triggers (see migration 018).
  await c.query("SET LOCAL nova.ephemeral_cascade='on'");
  await c.query('DELETE FROM conversations WHERE owner_id=$1 AND id=$2 AND ephemeral', [owner, id]);
  await event(c, owner, 'conversation.deleted', id);
}
/** Deletes expired temporary conversations (all owners). Returns the number removed. Blobs → file_cleanup ledger. */
export async function sweepEphemeral(pool: Pool, ttlHours = EPHEMERAL_TTL_HOURS) {
  return transaction(pool, async c => {
    const rows = (await c.query("SELECT id,owner_id FROM conversations WHERE ephemeral AND created_at < clock_timestamp() - make_interval(hours=>$1) FOR UPDATE SKIP LOCKED", [ttlHours])).rows;
    if (rows.length) await c.query("SET LOCAL nova.ephemeral_cascade='on'");
    for (const r of rows) {
      if ((await c.query("SELECT 1 FROM agent_runs WHERE conversation_id=$1 AND status IN ('queued','running')", [r.id])).rowCount) continue;
      await c.query('INSERT INTO file_cleanup(id,owner_id) SELECT id,owner_id FROM files WHERE conversation_id=$1 ON CONFLICT DO NOTHING', [r.id]);
      await c.query('DELETE FROM conversations WHERE id=$1 AND ephemeral', [r.id]);
    }
    return rows.length;
  });
}
export function contextRoutes(app: FastifyInstance, pool: Pool, mutate: Mutate) {
  const params = closed({ id: uuid });
  app.post('/conversations/:id/messages', { schema: { params, body: closed({ baseSequence: { type: 'integer', minimum: 0, maximum: 2147483646 }, text: { type: 'string', minLength: 1, maxLength: 16384 } }) } }, mutate(async (c, owner, body, r) => {
    const conversationId = (r.params as any).id;
    if (!(await c.query('SELECT 1 FROM conversations WHERE owner_id=$1 AND id=$2', [owner, conversationId])).rowCount) fail(404, 'not_found');
    if (Buffer.byteLength(body.text) > 16384) fail(413, 'message_too_large');
    const last = (await c.query('SELECT coalesce(max(sequence),0)::int n FROM messages WHERE owner_id=$1 AND conversation_id=$2', [owner, conversationId])).rows[0].n;
    if (last !== body.baseSequence) fail(409, 'sequence_conflict');
    const id = randomUUID(), sequence = last + 1;
    await c.query('INSERT INTO messages(id,owner_id,conversation_id,sequence,text) VALUES($1,$2,$3,$4,$5)', [id, owner, conversationId, sequence, body.text]);
    await event(c, owner, 'message.created', id);
    return { id, conversationId, sequence, text: body.text, role: 'user', channel: 'text' };
  }));
  app.get('/conversations/:id/messages', { schema: { params, querystring: closed({ after: { type: 'string', pattern: '^(0|[1-9][0-9]{0,8})$' }, limit: { type: 'string', pattern: '^([1-9]|[1-4][0-9]|50)$' } }, []) } }, async r => transaction(pool, async c => {
    const owner = await authenticatedOwner(c, r), id = (r.params as any).id, q = r.query as any;
    if (!(await c.query('SELECT 1 FROM conversations WHERE owner_id=$1 AND id=$2', [owner, id])).rowCount) fail(404, 'not_found');
    const limit = Number(q.limit ?? 20);
    const rows = (await c.query(`SELECT id,conversation_id AS "conversationId",sequence,text,role,channel,CASE WHEN role='assistant' THEN 'agent_generated' ELSE provenance END AS provenance FROM messages WHERE owner_id=$1 AND conversation_id=$2 AND sequence>$3 ORDER BY sequence LIMIT $4`, [owner, id, Number(q.after ?? 0), limit + 1])).rows;
    return { items: rows.slice(0, limit), nextAfter: rows.length > limit ? rows[limit - 1].sequence : null };
  }));
}
