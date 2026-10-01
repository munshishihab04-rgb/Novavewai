import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authenticatedOwner, fail, hash, transaction } from './app.ts';

export async function initWeb(pool:Pool) {
 await pool.query(`CREATE TABLE IF NOT EXISTS web_invites(digest text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL)`);
}
export async function issueInvite(pool:Pool,owner:string,seconds=3600){
 const token=randomBytes(32).toString('base64url');
 await pool.query("INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+$3*interval '1 second')",[hash(token),owner,seconds]);return token;
}
export function webDataRoutes(app:FastifyInstance,pool:Pool){
 app.get('/workspace',async r=>transaction(pool,async c=>{
  const owner=await authenticatedOwner(c,r);
  const conversations=(await c.query('SELECT id,title,created_at FROM conversations WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])).rows;
  const artifacts=(await c.query('SELECT a.id,a.title,a.task_id,a.current_revision,t.conversation_id FROM artifacts a JOIN tasks t ON t.id=a.task_id WHERE a.owner_id=$1 ORDER BY a.created_at DESC LIMIT 100',[owner])).rows;
  const runs=(await c.query('SELECT id,conversation_id,task_id,status,error_code,created_at FROM agent_runs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])).rows;
  return {conversations,artifacts,runs,limit:100};
 }));
}
export async function buildWeb(core:FastifyInstance,pool:Pool){
 const web=Fastify({logger:false,bodyLimit:5700000,trustProxy:false});
 const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/features.js':['features.js','text/javascript; charset=utf-8']};
 const buckets=new Map<string,{at:number,n:number}>();
 web.addHook('onRequest',async(r,reply)=>{
  reply.header('cache-control','no-store').header('referrer-policy','no-referrer').header('x-content-type-options','nosniff').header('x-frame-options','DENY').header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").header('permissions-policy','microphone=(self), camera=(), geolocation=()');
  if(!['GET','HEAD'].includes(r.method)){
   if(r.headers['x-nova-request']!=='1'||r.headers.origin!==`https://${r.headers.host}`)return reply.code(403).send({error:'origin_required'});
  }
  if(r.url==='/auth/exchange'){
   const key=String(r.headers['cf-connecting-ip']??r.ip),now=Date.now();if(buckets.size>1000)buckets.clear();let b=buckets.get(key);if(!b||now-b.at>60000){b={at:now,n:0};buckets.set(key,b)}if(++b.n>20)return reply.code(429).send({error:'rate_limited'});
  }
 });
 web.setErrorHandler((_e,_r,reply)=>reply.code(500).send({error:'request_failed'}));
 for(const [url,[file,type]] of Object.entries(assets))web.get(url,async(_r,reply)=>reply.type(type).send(await readFile(new URL('../public/'+file,import.meta.url))));
 const cookieToken=(r:any)=>{const s=String(r.headers.cookie??'').split(';').map((x:string)=>x.trim()).find((x:string)=>x.startsWith('__Host-nova='))?.slice(12);return s&&/^[A-Za-z0-9_-]{43}$/.test(s)?s:undefined};
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
  const path=r.url.slice(4);if(!/^\/(workspace|conversations|runs|artifacts|tasks|files|me|documents|research|voice)(\/|\?|$)/.test(path))return reply.code(404).send({error:'not_found'});
  const response=await core.inject({method:r.method as any,url:path,headers:{authorization:`Bearer ${token}`,...(r.headers['idempotency-key']?{'idempotency-key':String(r.headers['idempotency-key'])}:{}),...(r.body!==undefined?{'content-type':'application/json'}:{})},...(r.body!==undefined?{payload:JSON.stringify(r.body)}:{})});
  if(response.headers['content-disposition'])reply.header('content-disposition',response.headers['content-disposition']);reply.code(response.statusCode).type(String(response.headers['content-type']??'application/json'));return response.rawPayload;
 });return web;
}
