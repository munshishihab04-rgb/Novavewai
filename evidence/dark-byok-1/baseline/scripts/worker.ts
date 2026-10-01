import { migrate } from '../src/app.ts';
import { drain, type SyntheticAdapter } from '../src/worker.ts';
import { localPool } from './config.ts';
const synthetic: SyntheticAdapter = {
  kind: 'synthetic',
  async send({ idempotencyKey, signal }) {
    if (signal.aborted) throw new Error('Cancelled');
    // Deliberately no network implementation: this is a declared local simulation.
    return { outcome: 'succeeded', reference: 'synthetic-' + idempotencyKey };
  },
};
async function main() {
  const pool = localPool();
  try { await migrate(pool); await drain(pool, synthetic); console.log('Synthetic worker batch complete; no external delivery.'); }
  finally { await pool.end(); }
}
main().catch(() => { console.error('Worker failed; durable leases will recover on a later batch.'); process.exitCode = 1; });
