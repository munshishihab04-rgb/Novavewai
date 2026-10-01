import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { canonical, closed, event, fail, hash, identity, uuid } from './app.ts';
export type Mutation = (run: (c: PoolClient, owner: string, body: any, r: FastifyRequest) => Promise<any>, status?: number) => any;
export async function audit(c: PoolClient, owner: string, action: string, resource: string) {
  await c.query('INSERT INTO audit_events(id,owner_id,action,resource_id) VALUES($1,$2,$3,$4)', [randomUUID(), owner, action, resource]);
}
export async function validIntent(c: PoolClient, owner: string, id: string, bindingHash?: string) {
  const i = (await c.query('SELECT i.*,a.current_revision, i.expires_at>clock_timestamp() AS fresh FROM action_intents i JOIN artifacts a ON a.id=i.artifact_id AND a.owner_id=i.owner_id WHERE i.owner_id=$1 AND i.id=$2', [owner, id])).rows[0];
  if (!i) fail(404, 'not_found');
  if (!i.fresh || i.revision !== i.current_revision || (bindingHash !== undefined && i.binding_hash !== bindingHash)) fail(409, 'intent_invalid');
  return i;
}
export function actionRoutes(app: FastifyInstance, pool: Pool, mutate: Mutation) {
  const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
  app.post('/intents', { schema: { body: closed({ artifactId: uuid, revision: { type: 'integer', minimum: 1 },
    operation: { const: 'simulate.send', type: 'string' }, account: { const: 'synthetic-account', type: 'string' },
    recipient: { type: 'string', pattern: '^[A-Za-z0-9._+-]{1,64}@example\\.invalid$' }, expiresInSeconds: { type: 'integer', minimum: 1, maximum: 900 } }) } }, mutate(async (c, owner, body) => {
    const row = (await c.query('SELECT r.content,a.current_revision FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE r.owner_id=$1 AND r.artifact_id=$2 AND r.revision=$3', [owner, body.artifactId, body.revision])).rows[0];
    if (!row) fail(404, 'not_found');
    if (row.current_revision !== body.revision) fail(409, 'revision_conflict');
    const id = randomUUID();
    const expiresAt = (await c.query("SELECT clock_timestamp()+$1*interval '1 second' AS expiry", [body.expiresInSeconds])).rows[0].expiry.toISOString();
    const frozen = { id, owner, operation: body.operation, account: body.account, recipient: body.recipient, artifactId: body.artifactId, revision: body.revision, payload: row.content, expiresAt };
    const bindingHash = hash(canonical(frozen));
    await c.query('INSERT INTO action_intents(id,owner_id,artifact_id,revision,operation,account,recipient,payload,binding_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, owner, body.artifactId, body.revision, body.operation, body.account, body.recipient, row.content, bindingHash, expiresAt]);
    await event(c, owner, 'intent.created', id); await audit(c, owner, 'approval.required', id);
    const { owner: _owner, ...safe } = frozen;
    return { ...safe, bindingHash, consequence: 'Synthetic adapter only; no external delivery', policy: 'require_approval' };
  }));
  app.post('/intents/:id/approve', { schema: { params: closed({ id: uuid }), body: closed({ bindingHash: digest }) } }, mutate(async (c, owner, body, r) => {
    const i = await validIntent(c, owner, (r.params as any).id, body.bindingHash);
    if ((await c.query('SELECT 1 FROM approvals WHERE intent_id=$1', [i.id])).rowCount) fail(409, 'approval_exists');
    const id = randomUUID();
    await c.query('INSERT INTO approvals(id,owner_id,intent_id,binding_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [id, owner, i.id, i.binding_hash, i.expires_at]);
    await event(c, owner, 'approval.granted', id); await audit(c, owner, 'approval.granted', id);
    return { id, intentId: i.id, status: 'approved', bindingHash: i.binding_hash };
  }));
  app.post('/intents/:id/execute', { schema: { params: closed({ id: uuid }), body: closed({ approvalId: uuid, bindingHash: digest }) } }, mutate(async (c, owner, body, r) => {
    const i = await validIntent(c, owner, (r.params as any).id, body.bindingHash);
    const consumed = await c.query("UPDATE approvals SET status='consumed',consumed_at=clock_timestamp() WHERE owner_id=$1 AND id=$2 AND intent_id=$3 AND binding_hash=$4 AND status='approved' AND expires_at>clock_timestamp() RETURNING id", [owner, body.approvalId, i.id, i.binding_hash]);
    if (!consumed.rowCount) fail(409, 'approval_invalid');
    const id = randomUUID();
    await c.query("INSERT INTO receipts(id,owner_id,intent_id,approval_id,status,session_hash) VALUES($1,$2,$3,$4,'queued',$5)", [id, owner, i.id, body.approvalId, hash(r.headers.authorization!.slice(7))]);
    await event(c, owner, 'action.execute', id); await audit(c, owner, 'approval.consumed', body.approvalId);
    return { id, intentId: i.id, status: 'queued' };
  }));
  app.post('/approvals/:id/revoke', { schema: { params: closed({ id: uuid }), body: closed({}) } }, mutate(async (c, owner, _body, r) => {
    const id = (r.params as any).id;
    if (!(await c.query("UPDATE approvals SET status='revoked' WHERE owner_id=$1 AND id=$2 RETURNING id", [owner, id])).rowCount) fail(404, 'not_found');
    await event(c, owner, 'approval.revoked', id); await audit(c, owner, 'approval.revoked', id);
    return { id, status: 'revoked' };
  }));
  app.get('/receipts/:id', { schema: { params: closed({ id: uuid }) } }, async r => {
    const row = (await pool.query('SELECT id,intent_id AS "intentId",status,reference FROM receipts WHERE owner_id=$1 AND id=$2', [identity(r), (r.params as any).id])).rows[0];
    return row ?? fail(404, 'not_found');
  });
}
