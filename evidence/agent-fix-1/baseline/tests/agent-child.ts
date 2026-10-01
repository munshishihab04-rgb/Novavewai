import { buildApp, migrate } from '../src/app.ts';
import { localPool } from '../scripts/config.ts';
// Explicitly controlled-provider test process. Not a production entrypoint.
const pool = localPool();
const app = buildApp(pool, { agent: { endpoint: process.env.NOVA_TEST_PROVIDER!, model: 'controlled-fixture', allowLoopback: true } });
try { await migrate(pool); console.log('READY ' + await app.listen({ port: 0, host: '127.0.0.1' })); }
catch { await app.close(); await pool.end(); process.exitCode = 1; }
process.once('SIGTERM', () => { void app.close().then(() => pool.end()); });
