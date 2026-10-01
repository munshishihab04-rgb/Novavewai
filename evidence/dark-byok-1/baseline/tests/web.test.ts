import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { database } from './helpers.ts';
import { bootstrap, buildApp, migrate, hash } from '../src/app.ts';
import { buildWeb, initWeb, issueInvite, webDataRoutes } from '../src/web.ts';

test('private web login: one-use invite, secure cookie, CSRF, auth and owner isolation',async()=>{
 const db=await database();await migrate(db.pool);await initWeb(db.pool);
 const a=await bootstrap(db.pool),b=await bootstrap(db.pool);
 const core=buildApp(db.pool);webDataRoutes(core,db.pool);await core.ready();
 const web=await buildWeb(core,db.pool);await web.ready();
 const headers={host:'trial.example','origin':'https://trial.example','x-nova-request':'1'};
 try{
  assert.equal((await web.inject({url:'/api/workspace'})).statusCode,401);
  assert.equal((await web.inject({url:'/'})).statusCode,200);
  const invite=await issueInvite(db.pool,a.userId,60);
  assert.equal((await web.inject({method:'POST',url:'/auth/exchange',headers:{...headers,origin:'https://evil.example'},payload:{invite}})).statusCode,403);
  assert.equal((await web.inject({method:'POST',url:'/auth/exchange',headers:{host:'trial.example'},payload:{invite}})).statusCode,403);
  const login=await web.inject({method:'POST',url:'/auth/exchange',headers,payload:{invite}});
  assert.equal(login.statusCode,200,login.body);
  const cookie=String(login.headers['set-cookie']).split(';')[0];assert.match(String(login.headers['set-cookie']),/HttpOnly/);assert.match(String(login.headers['set-cookie']),/Secure/);assert.match(String(login.headers['set-cookie']),/SameSite=Strict/);
  assert.equal((await web.inject({method:'POST',url:'/auth/exchange',headers,payload:{invite}})).statusCode,401);
  const auth={...headers,cookie};
  const created=await web.inject({method:'POST',url:'/api/conversations',headers:{...auth,'idempotency-key':'new'},payload:{title:'PRIVATE WEB'}});assert.equal(created.statusCode,201);
  const workspace=await web.inject({url:'/api/workspace',headers:auth});assert.equal(workspace.statusCode,200);assert.equal(workspace.json().conversations[0].title,'PRIVATE WEB');assert.ok(!workspace.body.includes('token_hash'));
  const other=await issueInvite(db.pool,b.userId,60);const otherLogin=await web.inject({method:'POST',url:'/auth/exchange',headers,payload:{invite:other}});const otherCookie=String(otherLogin.headers['set-cookie']).split(';')[0];
  assert.equal((await web.inject({url:`/api/conversations/${created.json().id}/messages`,headers:{...headers,cookie:otherCookie}})).statusCode,404);
  assert.equal((await web.inject({method:'POST',url:'/api/conversations',headers:{...auth,origin:'https://evil.example','idempotency-key':'evil'},payload:{title:'evil'}})).statusCode,403);
  const expired=randomBytes(32).toString('base64url');await db.pool.query("INSERT INTO web_invites(digest,owner_id,expires_at) VALUES($1,$2,clock_timestamp()-interval '1 second')",[hash(expired),a.userId]);
  assert.equal((await web.inject({method:'POST',url:'/auth/exchange',headers,payload:{invite:expired}})).statusCode,401);
  assert.equal((await web.inject({method:'POST',url:'/auth/logout',headers:auth,payload:{}})).statusCode,200);
  assert.equal((await web.inject({url:'/api/workspace',headers:auth})).statusCode,401);
 }finally{await web.close();await core.close();await db.close();}
});
