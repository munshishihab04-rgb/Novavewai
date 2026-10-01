import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authenticatedOwner, fail, hash, transaction } from './app.ts';
import { Throttle, loginAccount, registerAccount, SESSION_SECONDS } from './accounts.ts';
import { cvCard } from './cv-schema.ts';
import { loadPreferences, savePreferences, validatePreferences } from './language.ts';

export async function initWeb(pool:Pool) {
 await pool.query(`CREATE TABLE IF NOT EXISTS web_invites(digest text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS web_welcomes(owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,title text NOT NULL,message text NOT NULL)`);
}
export async function issueInvite(pool:Pool,owner:string,seconds=3600){
 const token=randomBytes(32).toString('base64url');
 await pool.query("INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+$3*interval '1 second')",[hash(token),owner,seconds]);return token;
}
export function webDataRoutes(app:FastifyInstance,pool:Pool){
 // Language preferences: independent ui / chat / voice. PUT merges partial updates; invalid values → 400.
 app.get('/me/preferences',async r=>transaction(pool,async c=>loadPreferences(c,await authenticatedOwner(c,r))));
 app.put('/me/preferences',{schema:{body:{type:'object'}}},async r=>transaction(pool,async c=>{const owner=await authenticatedOwner(c,r);const current=await loadPreferences(c,owner);const next=validatePreferences(r.body,current.language);if(!next)return fail(400,'invalid_preferences');const ob=(r.body as any)?.onboarded;if(ob!==undefined&&ob!==true)return fail(400,'invalid_preferences');await savePreferences(c,owner,next,ob===true);return loadPreferences(c,owner)}));
 // Minimal account card for the drawer: username when self-registered, otherwise an invite-based guest label.
 app.get('/me',async r=>transaction(pool,async c=>{const owner=await authenticatedOwner(c,r);const row=(await c.query('SELECT username,created_at FROM account_credentials WHERE owner_id=$1',[owner])).rows[0];return {id:owner,username:row?.username??null,kind:row?'account':'invite',since:row?.created_at??null}}));
 app.get('/workspace',async r=>transaction(pool,async c=>{
  const owner=await authenticatedOwner(c,r);
  const conversations=(await c.query('SELECT id,title,created_at FROM conversations WHERE owner_id=$1 AND NOT ephemeral ORDER BY created_at DESC LIMIT 100',[owner])).rows;
  // `cv` is a compact card projection of structured CV revisions (never the whole content); null for other artifacts.
  const artifacts=(await c.query('SELECT a.id,a.title,a.task_id,a.current_revision,t.conversation_id,r.content->\'file\' AS file,r.content->\'cv\' AS cv_raw FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN artifact_revisions r ON r.artifact_id=a.id AND r.revision=a.current_revision WHERE a.owner_id=$1 ORDER BY a.created_at DESC LIMIT 100',[owner])).rows.map(({cv_raw,...row})=>({...row,cv:cv_raw&&typeof cv_raw==='object'&&cv_raw.identity?cvCard(cv_raw):null}));
  const runs=(await c.query('SELECT id,conversation_id,task_id,status,error_code,created_at FROM agent_runs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])).rows;
  return {conversations,artifacts,runs,limit:100};
 }));
}
export interface WebOptions{nativeVoice?:boolean;/** Self-service registration; default open. Env NOVA_PUBLIC_REGISTRATION=off closes it. */registration?:boolean}
export const registrationOpenFromEnv=(env:Record<string,string|undefined>=process.env)=>env.NOVA_PUBLIC_REGISTRATION?.trim().toLowerCase()!=='off';
export async function buildWeb(core:FastifyInstance,pool:Pool,options:WebOptions={}){
 const web=Fastify({logger:false,bodyLimit:5700000,trustProxy:false});
 const registrationOpen=options.registration??registrationOpenFromEnv();
 const registrations=new Throttle(5,3600000),loginFailures=new Throttle(10,900000);
 const clientKey=(r:any)=>String(r.headers['cf-connecting-ip']??r.ip);
 const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/features.js':['features.js','text/javascript; charset=utf-8'],'/dashboard.js':['dashboard.js','text/javascript; charset=utf-8'],'/dark.css':['dark.css','text/css; charset=utf-8'],'/icons.js':['icons.js','text/javascript; charset=utf-8'],'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/NotoSansBengali-Regular.ttf':['NotoSansBengali-Regular.ttf','font/ttf'],'/NotoSansBengali-Bold.ttf':['NotoSansBengali-Bold.ttf','font/ttf']};
 const buckets=new Map<string,{at:number,n:number}>();
 web.addHook('onRequest',async(r,reply)=>{
  reply.header('cache-control','no-store').header('referrer-policy','no-referrer').header('x-content-type-options','nosniff').header('x-frame-options','DENY').header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").header('permissions-policy','microphone=(self), camera=(), geolocation=()');
  if(!['GET','HEAD'].includes(r.method)){
   if(r.headers['x-nova-request']!=='1'||r.headers.origin!==`https://${r.headers.host}`)return reply.code(403).send({error:'origin_required'});
  }
  if(r.url==='/auth/exchange'||r.url==='/auth/preview'||r.url==='/auth/register'||r.url==='/auth/login'){
   const key=clientKey(r),now=Date.now();if(buckets.size>1000)buckets.clear();let b=buckets.get(key);if(!b||now-b.at>60000){b={at:now,n:0};buckets.set(key,b)}if(++b.n>20)return reply.code(429).send({error:'rate_limited'});
  }
 });
 web.setErrorHandler((_e,_r,reply)=>reply.code(500).send({error:'request_failed'}));
 for(const [url,[file,type]] of Object.entries(assets))web.get(url,async(_r,reply)=>{const bytes=await readFile(new URL('../public/'+file,import.meta.url));return reply.type(type).send(file==='index.html'&&options.nativeVoice?bytes.toString().replace('</head>','<script src="/native.js" defer></script></head>'):bytes)});
 if(options.nativeVoice)web.get('/native.js',async(_r,reply)=>reply.type('text/javascript; charset=utf-8').send(await readFile(new URL('../staging/voice-files/public/native.js',import.meta.url))));
 const cookieToken=(r:any)=>{const s=String(r.headers.cookie??'').split(';').map((x:string)=>x.trim()).find((x:string)=>x.startsWith('__Host-nova='))?.slice(12);return s&&/^[A-Za-z0-9_-]{43}$/.test(s)?s:undefined};
 const sessionCookie=(token:string,seconds:number)=>`__Host-nova=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
 const credentials=(body:any)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>k==='username'||k==='password')?{username:body.username,password:body.password}:undefined;
 web.post('/auth/register',async(r,reply)=>{
  if(!registrationOpen)return reply.code(403).send({error:'registration_closed'});
  const input=credentials(r.body);if(!input)return reply.code(400).send({error:'invalid_request'});
  if(registrations.blocked(clientKey(r)))return reply.code(429).send({error:'rate_limited'});
  const result=await registerAccount(pool,input.username,input.password);
  if(!result.ok)return reply.code(result.error==='username_taken'?409:400).send({error:result.error});
  registrations.hit(clientKey(r));reply.header('set-cookie',sessionCookie(result.session,SESSION_SECONDS));return reply.code(201).send({ok:true,username:String(input.username).trim().toLowerCase()});
 });
 web.post('/auth/login',async(r,reply)=>{
  const input=credentials(r.body);const username=typeof input?.username==='string'?input.username.trim().toLowerCase().slice(0,64):'';
  const key=clientKey(r)+'|'+username;const wait=loginFailures.blocked(key);if(wait)return reply.code(429).send({error:'rate_limited',retry_after:wait});
  const result=await loginAccount(pool,input?.username,input?.password);
  if(!result.ok){loginFailures.hit(key);return reply.code(401).send({error:'invalid_credentials'})}
  loginFailures.reset(key);reply.header('set-cookie',sessionCookie(result.session,SESSION_SECONDS));return {ok:true};
 });
 web.post('/auth/preview',async(r,reply)=>{
  const invite=(r.body as any)?.invite;if(typeof invite!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(invite))return reply.code(401).send({error:'invalid_invite'});
  const row=(await pool.query("SELECT w.title,w.message FROM web_invites i JOIN users u ON u.id=i.owner_id LEFT JOIN web_welcomes w ON w.owner_id=i.owner_id WHERE i.digest=$1 AND i.expires_at>clock_timestamp() AND u.status='active'",[hash(invite)])).rows[0];
  if(!row)return reply.code(401).send({error:'invalid_invite'});
  return {welcome:row.title?{title:row.title,message:row.message}:null};
 });
 web.post('/auth/exchange',async(r,reply)=>{
  const invite=(r.body as any)?.invite;if(typeof invite!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(invite))return reply.code(401).send({error:'invalid_invite'});
  const token=await transaction(pool,async c=>{
   const candidate=(await c.query("SELECT owner_id FROM web_invites WHERE digest=$1 AND expires_at>clock_timestamp()",[hash(invite)])).rows[0];if(!candidate)return;
   if(!(await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",[candidate.owner_id])).rowCount)return;
   if(!(await c.query('DELETE FROM web_invites WHERE digest=$1 AND expires_at>clock_timestamp() RETURNING owner_id',[hash(invite)])).rowCount)return;
   const session=randomBytes(32).toString('base64url');await c.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '24 hours')",[hash(session),candidate.owner_id]);return session;
  });
  if(!token)return reply.code(401).send({error:'invalid_invite'});
  reply.header('set-cookie',`__Host-nova=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);return {ok:true};
 });
 web.post('/auth/logout',async(r,reply)=>{const token=cookieToken(r);if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);reply.header('set-cookie','__Host-nova=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return {ok:true}});
 web.all('/api/*',async(r,reply)=>{
  const token=cookieToken(r);if(!token)return reply.code(401).send({error:'unauthorized'});
  const path=r.url.slice(4);if(!/^\/(workspace|conversations|runs|artifacts|tasks|files|me|documents|research|voice|providers)(\/|\?|$)/.test(path))return reply.code(404).send({error:'not_found'});
  const response=await core.inject({method:r.method as any,url:path,headers:{authorization:`Bearer ${token}`,...(r.headers['idempotency-key']?{'idempotency-key':String(r.headers['idempotency-key'])}:{}),...(r.body!==undefined?{'content-type':'application/json'}:{})},...(r.body!==undefined?{payload:JSON.stringify(r.body)}:{})});
  if(response.headers['content-disposition'])reply.header('content-disposition',response.headers['content-disposition']);reply.code(response.statusCode).type(String(response.headers['content-type']??'application/json'));return response.rawPayload;
 });return web;
}
