import { open, unlink } from 'node:fs/promises';
import { bootstrap, migrate } from '../src/app.ts';
import { localPool } from './config.ts';

async function main() {
  const path = process.argv[2]; if (!path) throw new Error('Output path required');
  // Exclusive create refuses symlinks/existing files; credentials never appear in logs/stdout.
  const file = await open(path, 'wx', 0o600); let ok = false;
  try {
    const pool = localPool();
    try { await migrate(pool); const identity = await bootstrap(pool); await file.writeFile(JSON.stringify(identity)); await file.sync(); ok = true; }
    finally { await pool.end(); }
  } finally { await file.close(); if (!ok) await unlink(path); }
  console.log('Local session created in restricted output file (24h expiry).');
}
main().catch(() => { console.error('Bootstrap failed; check local configuration and output path.'); process.exitCode = 1; });
