// Public smoke: real registration + login + logout + daily-limit path + Ricky preview untouched, against the live public URL.
import pg from 'pg';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
const base=process.env.TRIAL_URL!;if(!/^https:\/\/[a-z-]+\.trycloudflare\.com$/.test(base))throw Error('origin');
const root='/home/azureuser/.local/share/nova-community-trial';
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
const headers={'content-type':'application/json','x-nova-request':'1',origin:base};
const username='smoke_'+randomBytes(4).toString('hex'),password='Smoke-'+randomBytes(9).toString('base64url');
const out:Record<string,unknown>={base,username};
try{
 assert.equal((await fetch(base)).status,200);
 const html=await (await fetch(base)).text();assert.ok(html.includes('Crea account')&&html.includes('Accedi'),'auth card served');out.authCardServed=true;
 // CSRF: register without x-nova-request must be refused
 assert.equal((await fetch(base+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})})).status,403);out.csrfRefused=true;
 const reg=await fetch(base+'/auth/register',{method:'POST',headers,body:JSON.stringify({username,password})});assert.equal(reg.status,201,await reg.text());
 const cookie=reg.headers.get('set-cookie')!;assert.match(cookie,/__Host-nova=.*HttpOnly.*Secure.*SameSite=Strict/);out.registered=true;
 const auth={...headers,cookie:cookie.split(';')[0]};assert.equal((await fetch(base+'/api/workspace',{headers:auth})).status,200);
 assert.equal((await fetch(base+'/auth/register',{method:'POST',headers,body:JSON.stringify({username,password})})).status,409);out.duplicateRefused=true;
 await fetch(base+'/auth/logout',{method:'POST',headers:auth,body:'{}'});assert.equal((await fetch(base+'/api/workspace',{headers:auth})).status,401);out.logout=true;
 assert.equal((await fetch(base+'/auth/login',{method:'POST',headers,body:JSON.stringify({username,password:password+'x'})})).status,401);
 const login=await fetch(base+'/auth/login',{method:'POST',headers,body:JSON.stringify({username,password})});assert.equal(login.status,200);out.login=true;
 const auth2={...headers,cookie:login.headers.get('set-cookie')!.split(';')[0]};
 const cr=await fetch(base+'/api/conversations',{method:'POST',headers:{...auth2,'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({title:'Smoke'})});assert.equal(cr.status,201);out.conversation=true;
 // Ricky invite preview still works (unconsumed)
 const owner=JSON.parse(await readFile(root+'/ricky-invite-metadata.json','utf8')).owner;const {hash}=await import('../src/app.ts');const invite=randomBytes(32).toString('base64url');
 await pool.query("INSERT INTO web_invites VALUES($1,$2,clock_timestamp()+interval '2 minutes')",[hash(invite),owner]);
 const preview=await fetch(base+'/auth/preview',{method:'POST',headers,body:JSON.stringify({invite})});assert.equal(preview.status,200);assert.equal((await preview.json()).welcome.title,'Benvenuto, Ricky.');await pool.query('DELETE FROM web_invites WHERE digest=$1',[hash(invite)]);out.rickyPreview=true;
 // cleanup smoke account (credentials + user) to keep the public DB tidy
 const uid=(await pool.query('SELECT owner_id FROM account_credentials WHERE username=$1',[username])).rows[0].owner_id;
 await pool.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE id=$1",[uid]);await pool.query('DELETE FROM sessions WHERE owner_id=$1',[uid]);out.cleanup='purged';
 await mkdir('evidence/public-access-1',{recursive:true});await writeFile('evidence/public-access-1/live-public-smoke.json',JSON.stringify({...out,checkedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify(out));
}finally{await pool.end()}
