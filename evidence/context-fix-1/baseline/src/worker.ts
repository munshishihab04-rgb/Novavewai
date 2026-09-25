import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './app.ts';
import { audit } from './actions.ts';

export interface SyntheticAdapter {
  kind: 'synthetic';
  send(input: { idempotencyKey: string; account: string; recipient: string; payload: unknown; signal: AbortSignal }): Promise<{ outcome: 'succeeded'; reference: string }>;
}
export interface Lease { id: string; owner_id: string; kind: string; resource_id: string; lease_token: string; }
export async function claim(pool: Pool, leaseMs = 30000): Promise<Lease | null> {
  const candidates = await pool.query("SELECT id,owner_id FROM outbox WHERE state='pending' OR (state='leased' AND lease_until<clock_timestamp()) ORDER BY created_at,id LIMIT 32");
  for (const candidate of candidates.rows) {
    const found = await transaction(pool, async c => {
      if (!(await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE SKIP LOCKED", [candidate.owner_id])).rowCount) return null;
      const result = await c.query("UPDATE outbox SET state='leased',lease_token=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond',attempts=attempts+1 WHERE id=$1 AND (state='pending' OR (state='leased' AND lease_until<clock_timestamp())) RETURNING id,owner_id,kind,resource_id,lease_token", [candidate.id, randomUUID(), leaseMs]);
      return result.rows[0] ?? null;
    });
    if (found) return found;
  }
  return null;
}
async function fence(c: PoolClient, lease: Lease) {
  if (!(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='active' FOR UPDATE", [lease.owner_id])).rowCount) return false;
  return !!(await c.query("SELECT 1 FROM outbox WHERE id=$1 AND owner_id=$2 AND state='leased' AND lease_token=$3 AND lease_until>clock_timestamp() FOR UPDATE", [lease.id, lease.owner_id, lease.lease_token])).rowCount;
}
async function done(c: PoolClient, lease: Lease) {
  await c.query("UPDATE outbox SET state='done',lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2", [lease.id, lease.lease_token]);
}
async function policy(c: PoolClient, lease: Lease) {
  return (await c.query(`SELECT r.id,r.status,i.account,i.recipient,i.payload,
    (i.expires_at>clock_timestamp() AND p.expires_at>clock_timestamp() AND p.status='consumed'
     AND p.binding_hash=i.binding_hash AND a.current_revision=i.revision
     AND s.expires_at>clock_timestamp() AND t.status IN ('created','active')) AS allowed
    FROM receipts r JOIN action_intents i ON i.id=r.intent_id
    JOIN approvals p ON p.id=r.approval_id AND p.intent_id=i.id
    JOIN artifacts a ON a.id=i.artifact_id JOIN tasks t ON t.id=a.task_id AND t.owner_id=r.owner_id
    LEFT JOIN sessions s ON s.token_hash=r.session_hash AND s.owner_id=r.owner_id
    WHERE r.id=$1 AND r.owner_id=$2 FOR UPDATE OF r`, [lease.resource_id, lease.owner_id])).rows[0];
}
export async function processLease(pool: Pool, lease: Lease, adapter: SyntheticAdapter, timeoutMs = 5000) {
  if (adapter.kind !== 'synthetic') throw new Error('Only synthetic adapter permitted');
  const ready = await transaction(pool, async c => {
    if (!await fence(c, lease)) return false;
    if (lease.kind !== 'action.execute') { await done(c, lease); return false; }
    const receipt = await policy(c, lease);
    if (!receipt) { await done(c, lease); return false; }
    if (receipt.status === 'executing') {
      await c.query("UPDATE receipts SET status='outcome_unknown',finished_at=clock_timestamp() WHERE id=$1", [receipt.id]);
      await audit(c, lease.owner_id, 'action.outcome_unknown', receipt.id); await done(c, lease); return false;
    }
    if (receipt.status !== 'queued') { await done(c, lease); return false; }
    if (!receipt.allowed) {
      await c.query("UPDATE receipts SET status='cancelled',finished_at=clock_timestamp() WHERE id=$1", [receipt.id]);
      await audit(c, lease.owner_id, 'action.cancelled', receipt.id); await done(c, lease); return false;
    }
    await c.query("UPDATE receipts SET status='executing',started_at=clock_timestamp() WHERE id=$1", [receipt.id]);
    return true;
  });
  if (!ready) return;
  // The durable executing marker precedes I/O. Owner lock serializes purge, revision changes,
  // revocation and competing claims while an already-authorized call is in flight.
  await transaction(pool, async c => {
    if (!await fence(c, lease)) return;
    const receipt = await policy(c, lease);
    if (!receipt || receipt.status !== 'executing') return;
    if (!receipt.allowed) {
      await c.query("UPDATE receipts SET status='cancelled',finished_at=clock_timestamp() WHERE id=$1", [receipt.id]); await done(c, lease); return;
    }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let status = 'outcome_unknown', reference: string | null = null;
    try {
      const response = await Promise.race([adapter.send({ idempotencyKey: receipt.id, account: receipt.account, recipient: receipt.recipient, payload: receipt.payload, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
      if (response.outcome === 'succeeded' && /^synthetic-[A-Za-z0-9_-]{1,100}$/.test(response.reference)) { status = 'succeeded'; reference = response.reference; }
    } catch { /* Ambiguous outcome must never auto-retry. Raw provider errors are not persisted. */ }
    finally { if (timer) clearTimeout(timer); }
    await c.query('UPDATE receipts SET status=$2,reference=$3,finished_at=clock_timestamp() WHERE id=$1', [receipt.id, status, reference]);
    await audit(c, lease.owner_id, 'action.' + status, receipt.id); await done(c, lease);
  });
}
export async function drain(pool: Pool, adapter: SyntheticAdapter) {
  for (let count = 0; count < 1000; count++) { const lease = await claim(pool); if (!lease) return; await processLease(pool, lease, adapter); }
  throw new Error('Worker batch limit reached');
}
