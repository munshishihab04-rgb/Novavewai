import type { Pool, PoolClient } from 'pg';
import { fail, transaction } from './app.ts';

// Single-host ownership: shared transaction barrier drains old writers before a
// replacement recovers files/runs. The dedicated session owns the singleton.
export class Runtime {
  private client?: PoolClient;
  private pid?: number;
  private live = false;
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(private pool: Pool) {}
  available() { return this.live && !this.stopped; }
  onLoss(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private invalidate = () => {
    this.live = false; this.stopped = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
    this.release();
  };
  private release() {
    const client = this.client; this.client = undefined;
    // End while still checked out: release(true) installs pg-pool's idle error
    // listener, which would forward a queued lease error onto the pool. Return
    // the destroyed client only after its terminal end event drains errors.
    if (client) void client.end();
  }
  async start() {
    try {
      const client = await this.pool.connect(); this.client = client;
      const ended = () => {
        this.invalidate();
        client.removeListener('error', this.invalidate); client.removeListener('end', ended);
        client.release(true);
      };
      client.on('error', this.invalidate); client.on('end', ended);
      const row = (await client.query('SELECT pg_backend_pid() pid,pg_try_advisory_lock(913004) ok')).rows[0];
      if (!row.ok) throw new Error('Agent/storage runtime already active');
      if (this.stopped) throw new Error('Runtime lease lost');
      this.pid = row.pid; this.live = true;
      // Wait for previous runtime's in-flight transactions before any recovery.
      await transaction(this.pool, async c => {
        await c.query('SELECT pg_advisory_xact_lock(913006)');
        await this.check(c);
      });
    } catch (error) { this.invalidate(); throw error; }
  }
  async check(c: PoolClient) {
    if (!this.available()) fail(503, 'runtime_interrupted');
    // Query actual lock ownership too: a backend can disappear before its error
    // event reaches this process. The final check follows all blocking writes.
    const held = await c.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=913004 AND objsubid=1 AND pid=$1 AND granted", [this.pid]);
    if (!held.rowCount) this.invalidate();
    if (!this.available()) fail(503, 'runtime_interrupted');
  }
  async transaction<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
    return transaction(this.pool, async c => {
      await c.query('SELECT pg_advisory_xact_lock_shared(913006)');
      await this.check(c);
      const result = await run(c);
      await this.check(c);
      return result;
    });
  }
  close() { this.invalidate(); }
}
