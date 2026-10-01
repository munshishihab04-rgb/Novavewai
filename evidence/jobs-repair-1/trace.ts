import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const root='/home/azureuser/.local/share/nova-community-trial';
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres',max:1,connectionTimeoutMillis:3000});
try {
 const c=await pool.connect();try {await c.query('BEGIN READ ONLY');
 // Only the reported role/city jobs receipts; never read message bodies, tokens, user IDs or checkpoints.
 const rows=(await c.query(`SELECT r.created_at, r.status AS run_status,r.model_calls,r.tool_calls,t.result->>'status' AS status,t.result->>'code' AS code,t.result->>'occupation' AS occupation,t.result->>'city' AS city FROM agent_tool_receipts t JOIN agent_runs r ON r.id=t.run_id WHERE t.tool='jobs_search' AND t.result->>'occupation'='cameriere' AND t.result->>'city'='Bologna' ORDER BY r.created_at DESC LIMIT 20`)).rows;
 await c.query('ROLLBACK');await writeFile(new URL('./native-receipts-sanitized.json',import.meta.url),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
 } finally {c.release()}
}finally{await pool.end()}
