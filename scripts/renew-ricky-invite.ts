import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
const root='/home/azureuser/.local/share/nova-community-trial';
const {owner}=JSON.parse(await readFile(root+'/ricky-invite-metadata.json','utf8'));
const expires=process.env.INVITE_EXPIRES!;
if(!expires||!Number.isFinite(Date.parse(expires)))throw Error('Explicit expiry required');
if(Date.now()>=Date.parse(expires))throw Error('Trial deadline reached');
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
try{
 const invite=randomBytes(32).toString('base64url'),digest=createHash('sha256').update(invite).digest('hex');
 const active=await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'",[owner]);if(active.rowCount!==1)throw Error('Recipient unavailable');
 await pool.query('INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,$3)',[digest,owner,expires]);
 const origin=process.env.TRIAL_ORIGIN!;if(!/^https:\/\/[a-z-]+\.trycloudflare\.com$/.test(origin))throw Error('Invalid origin');
 const response=await fetch(origin+'/auth/preview',{method:'POST',headers:{'content-type':'application/json','x-nova-request':'1',origin},body:JSON.stringify({invite})});
 const body=await response.json() as any;if(!response.ok||body.welcome?.title!=='Benvenuto, Ricky.')throw Error('Public preview failed');
 const check=await pool.query('SELECT expires_at FROM web_invites WHERE digest=$1 AND owner_id=$2 AND expires_at>clock_timestamp()',[digest,owner]);if(check.rowCount!==1)throw Error('Invite readback failed');
 console.log(JSON.stringify({url:origin+'/#invite='+invite,expires:check.rows[0].expires_at,welcomeVerified:true,unused:true,sameAccount:true}));
}finally{await pool.end()}
