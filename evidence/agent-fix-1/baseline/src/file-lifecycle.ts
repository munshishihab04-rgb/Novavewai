import type { Pool } from 'pg';
import { transaction } from './app.ts';
import type { LocalFiles } from './local-files.ts';
// Serialized by the owner row, including inactive owners; cleanup cannot recreate content.
export async function cleanupFiles(pool: Pool, store: LocalFiles, owner?: string) {
  const owners = owner ? [{ owner_id: owner }] : (await pool.query('SELECT DISTINCT owner_id FROM file_cleanup')).rows;
  for (const row of owners) await transaction(pool, async c => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.owner_id]);
    const jobs = (await c.query('SELECT id FROM file_cleanup WHERE owner_id=$1', [row.owner_id])).rows;
    for (const job of jobs) { await store.remove(job.id); await c.query('DELETE FROM file_cleanup WHERE id=$1', [job.id]); }
  });
}
export async function recoverFiles(pool: Pool, store: LocalFiles) {
  const owners = (await pool.query("SELECT DISTINCT owner_id FROM files WHERE state='pending'")).rows;
  for (const row of owners) await transaction(pool, async c => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.owner_id]);
    await c.query("INSERT INTO file_cleanup(id,owner_id) SELECT id,owner_id FROM files WHERE owner_id=$1 AND state='pending' ON CONFLICT DO NOTHING", [row.owner_id]);
    await c.query("DELETE FROM files WHERE owner_id=$1 AND state='pending'", [row.owner_id]);
  });
  await cleanupFiles(pool, store);
}
