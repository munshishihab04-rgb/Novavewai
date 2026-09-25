import pg from 'pg';
export function localPool() {
  if (process.env.PGHOST !== '127.0.0.1' || !process.env.PGPASSWORD || !process.env.PGUSER || !process.env.PGDATABASE) throw new Error('Local database configuration required');
  return new pg.Pool({ host: '127.0.0.1', port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
    password: process.env.PGPASSWORD, database: process.env.PGDATABASE, max: 10, connectionTimeoutMillis: 5000 });
}
