import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { active, closed, identity, transaction } from './app.ts';

export function privacyRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/me/export', async r => transaction(pool, async c => {
    const owner = identity(r); await active(c, owner);
    const snapshot: Record<string, unknown> = { version: 'owner-export-v1' };
    const projections: Record<string, [string,string]> = {
      conversations: ['conversations','id,title,created_at'],
      tasks: ['tasks','id,conversation_id,goal,status,version,created_at'],
      artifacts: ['artifacts','id,task_id,title,current_revision,created_at'],
      revisions: ['artifact_revisions','artifact_id,revision,content,hash,created_at'],
      intents: ['action_intents','id,artifact_id,revision,operation,account,recipient,payload,binding_hash,expires_at'],
      approvals: ['approvals','id,intent_id,binding_hash,status,expires_at,consumed_at'],
      receipts: ['receipts','id,intent_id,status,reference,started_at,finished_at'],
      events: ['outbox','id,kind,resource_id,state,created_at'],
      audit: ['audit_events','id,action,resource_id,created_at'],
    };
    for (const [key, [table, fields]] of Object.entries(projections))
      snapshot[key] = (await c.query(`SELECT ${fields} FROM ${table} WHERE owner_id=$1 ORDER BY created_at`, [owner])).rows;
    return snapshot;
  }));
  app.delete('/me', { schema: { body: closed({ confirm: { type: 'string', const: 'purge' } }) } }, async r => transaction(pool, async c => {
    const owner = identity(r); await active(c, owner);
    await c.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE id=$1", [owner]);
    // A durable opaque user tombstone survives; all content and capabilities are removed.
    for (const table of ['sessions','idempotency','outbox','audit_events','conversations'])
      await c.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
    return { status: 'purged' };
  }));
}
