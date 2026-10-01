import pg from 'pg';import {readFile} from 'node:fs/promises';
// Purge synthetic smoke accounts (username smoke_*) created by scripts/public-access-smoke.ts.
const root='/home/azureuser/.local/share/nova-community-trial';const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
const r=await pool.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE status='active' AND id IN (SELECT owner_id FROM account_credentials WHERE username LIKE 'smoke\\_%') RETURNING id");
await pool.query("DELETE FROM sessions WHERE owner_id IN (SELECT owner_id FROM account_credentials WHERE username LIKE 'smoke\\_%')");
console.log('smoke accounts purged:',r.rowCount);await pool.end();
