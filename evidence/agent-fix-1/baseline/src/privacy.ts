import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { cleanupFiles } from './file-lifecycle.ts';
import type { LocalFiles } from './local-files.ts';
import { authenticatedOwner, closed, transaction } from './app.ts';

export function privacyRoutes(app: FastifyInstance, pool: Pool, store?: LocalFiles) {
  app.get('/me/export', async r => transaction(pool, async c => {
    const owner = await authenticatedOwner(c, r);
    const snapshot: Record<string, unknown> = { version: 'owner-export-v1', fileDelivery: { binaryIncluded: false, download: '/files/:id/content', storage: 'local-encrypted-development' } };
    const projections: Record<string, [string,string]> = {
      conversations: ['conversations','id,title,created_at'],
      files: ['files','id,conversation_id,name,mime,size,hash,state,created_at'],
      sources: ['sources','id,conversation_id,message_id,file_id,snapshot,hash,trust,created_at'],
      evidence: ['evidence','id,source_id,artifact_id,revision,target_kind,target,excerpt,territory,valid_from,valid_until,verification_method,status,created_at'],
      messages: ['messages','id,conversation_id,sequence,text,role,created_at'],
      agentRuns: ['agent_runs','id,conversation_id,task_id,status,model_calls,tool_calls,error_code,created_at,updated_at'],
      agentEvents: ['agent_events','id,run_id,kind,detail,created_at'],
      agentToolReceipts: ['agent_tool_receipts','run_id,call_id,tool,input_hash,result,created_at'],
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
  app.delete('/me', { schema: { body: closed({ confirm: { type: 'string', const: 'purge' } }) } }, async (r, reply) => {
    const owner = await transaction(pool, async c => {
      const owner = await authenticatedOwner(c, r);
      await c.query('INSERT INTO file_cleanup(id,owner_id) SELECT id,owner_id FROM files WHERE owner_id=$1 ON CONFLICT DO NOTHING', [owner]);
      await c.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE id=$1", [owner]);
      // Opaque cleanup work survives while all content/capabilities are removed.
      for (const table of ['sessions','idempotency','outbox','audit_events','conversations'])
        await c.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
      return owner;
    });
    const pending = (await pool.query('SELECT 1 FROM file_cleanup WHERE owner_id=$1 LIMIT 1', [owner])).rowCount;
    if (pending) {
      try { if (!store) throw new Error('Storage unavailable'); await cleanupFiles(pool, store, owner); }
      catch { return reply.code(202).send({ status: 'purging' }); }
    }
    return { status: 'purged' };
  });
}
