import { buildApp, migrate } from '../src/app.ts';
import { localPool } from './config.ts';

async function main() {
  const pool = localPool(); const app = buildApp(pool); let closing = false;
  const close = async () => { if (closing) return; closing = true; await app.close(); await pool.end(); };
  process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
  try { await migrate(pool); const url = await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) }); console.log('READY ' + url); }
  catch { await close(); throw new Error('Startup failed'); }
}
main().catch(() => { console.error('Server failed; check local configuration.'); process.exitCode = 1; });
