// Create (once) a personal partner account + welcome + single-use invite.
// Usage: RECIPIENT="Hira Khan" SLUG=hira-khan TRIAL_ORIGIN=https://x.trycloudflare.com INVITE_EXPIRES=2026-10-02T22:00:00Z npx tsx scripts/invite-partner.ts
// Re-running with an existing metadata file issues a NEW invite for the SAME account (conversations preserved).
import pg from 'pg';import {readFile,writeFile} from 'node:fs/promises';import {randomBytes,randomUUID} from 'node:crypto';import {hash,transaction} from '../src/app.ts';import {initWeb} from '../src/web.ts';
const root='/home/azureuser/.local/share/nova-community-trial';
const recipient=process.env.RECIPIENT!,slug=process.env.SLUG!,origin=process.env.TRIAL_ORIGIN!,expires=process.env.INVITE_EXPIRES!;
if(!recipient||!/^[a-z0-9-]{3,40}$/.test(slug))throw Error('RECIPIENT and SLUG required');
if(!/^https:\/\/[a-z-]+\.trycloudflare\.com$/.test(origin))throw Error('TRIAL_ORIGIN must be the current public origin');
if(!(Date.parse(expires)>Date.now()))throw Error('INVITE_EXPIRES must be a future ISO timestamp');
const title=process.env.WELCOME_TITLE??`Benvenuta, ${recipient.split(' ')[0]}.`;
const message=process.env.WELCOME_MESSAGE??`Questo accesso è solo tuo.\n\nNOVA è il progetto a cui sto dedicando tutto: un assistente che parla la lingua delle persone e le aiuta nelle cose concrete — documenti, lavoro, CV — con onestà e senza inventare nulla.\n\nAverti come socia in questo cammino per me conta molto. Provalo con calma, mettilo alla prova e dimmi con sincerità cosa funziona e cosa no: il tuo sguardo mi serve.\n\nGrazie per esserci.`;
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
const metaPath=`${root}/${slug}-invite-metadata.json`;
try{
 await initWeb(pool);
 let owner:string;let created=false;
 try{owner=JSON.parse(await readFile(metaPath,'utf8')).owner}catch{owner=randomUUID();created=true;await pool.query('INSERT INTO users(id) VALUES($1)',[owner])}
 const invite=randomBytes(32).toString('base64url');
 await transaction(pool,async c=>{
  await c.query('INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,$3)',[hash(invite),owner,expires]);
  await c.query('INSERT INTO web_welcomes(owner_id,title,message) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message',[owner,title,message]);
 });
 const row=(await pool.query(`SELECT u.status,(SELECT count(*)::int FROM conversations WHERE owner_id=u.id) conversations FROM users u WHERE u.id=$1`,[owner])).rows[0];if(row?.status!=='active')throw Error('account not active');
 await writeFile(metaPath,JSON.stringify({recipient,owner,expires,createdAt:new Date().toISOString(),role:'partner'},null,2),{mode:0o600});
 // preview must work without consuming the invite
 const preview=await fetch(origin+'/auth/preview',{method:'POST',headers:{'content-type':'application/json','x-nova-request':'1',origin},body:JSON.stringify({invite})});
 const ok=preview.status===200&&(await preview.json()).welcome?.title===title;
 const still=(await pool.query('SELECT 1 FROM web_invites WHERE digest=$1',[hash(invite)])).rowCount===1;
 console.log(JSON.stringify({recipient,accountCreated:created,conversationsPreserved:row.conversations,previewOk:ok,inviteNotConsumed:still,expires}));
 console.log('LINK',`${origin}/#invite=${invite}`);
}finally{await pool.end()}
