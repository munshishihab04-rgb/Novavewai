import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {hash,transaction} from '../src/app.ts';
const root='/home/azureuser/.local/share/nova-community-trial';
const expires='2026-09-26T13:50:00Z';
if(Date.now()>=Date.parse(expires))throw Error('Trial deadline passed');
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
try{
 const owner=randomUUID(),invite=randomBytes(32).toString('base64url');
 await transaction(pool,async c=>{await c.query('INSERT INTO users(id) VALUES($1)',[owner]);await c.query('INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,$3)',[hash(invite),owner,expires])});
 const result=await pool.query(`SELECT u.status,i.expires_at,(SELECT count(*)::int FROM conversations WHERE owner_id=u.id) conversations,(SELECT count(*)::int FROM sessions WHERE owner_id=u.id) sessions FROM users u JOIN web_invites i ON i.owner_id=u.id WHERE u.id=$1 AND i.digest=$2`,[owner,hash(invite)]);
 const row=result.rows[0];if(!row||row.status!=='active'||row.conversations!==0||row.sessions!==0)throw Error('Invite verification failed');
 await writeFile(root+'/ricky-invite-metadata.json',JSON.stringify({recipient:'Ricky',owner,expires,createdAt:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({recipient:'Ricky',url:'https://loving-say-than-seemed.trycloudflare.com/#invite='+invite,expires:row.expires_at,isolatedAccount:true,unused:row.sessions===0}));
}finally{await pool.end()}
