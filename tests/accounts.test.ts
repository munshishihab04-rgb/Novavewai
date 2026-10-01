import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.ts';
import { bootstrap, buildApp, migrate, hash } from '../src/app.ts';
import { buildWeb, initWeb, issueInvite, webDataRoutes } from '../src/web.ts';
import { hashPassword, verifyPassword, normalizeUsername, validUsername, validPassword, scryptStats } from '../src/accounts.ts';

const headers={host:'trial.example',origin:'https://trial.example','x-nova-request':'1'};
async function fixture(options:any={}){
 const db=await database();await migrate(db.pool);await initWeb(db.pool);
 const core=buildApp(db.pool);webDataRoutes(core,db.pool);await core.ready();
 const web=await buildWeb(core,db.pool,options);await web.ready();
 const post=(url:string,payload:any,extra:Record<string,string>={})=>web.inject({method:'POST',url,headers:{...headers,...extra},payload});
 return {db,core,web,post,async close(){await web.close();await core.close();await db.close()}};
}

test('password hashing: scrypt with random salt, constant-time verify, dummy path',async()=>{
 const stored=await hashPassword('correct horse battery');
 assert.match(stored,/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{43}$/);
 assert.notEqual(stored,await hashPassword('correct horse battery'),'salt must be random');
 assert.equal(await verifyPassword('correct horse battery',stored),true);
 assert.equal(await verifyPassword('wrong',stored),false);
 assert.equal(await verifyPassword('anything','garbage'),false);
 assert.equal(normalizeUsername('  Mario.Rossi '),'mario.rossi');
 for(const ok of ['abc','mario_rossi','a.b-c','x'.repeat(32)])assert.equal(validUsername(ok),true,ok);
 for(const bad of ['ab','x'.repeat(33),'Mario','mario rossi','mario@x','','ünico'])assert.equal(validUsername(bad),false,bad);
 assert.equal(validPassword('123456789'),false);assert.equal(validPassword('1234567890'),true);assert.equal(validPassword('x'.repeat(201)),false);assert.equal(validPassword('x'.repeat(200)),true);
});

test('self-service register/login/logout: cookie flags, 7-day session, validation, duplicates',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.post('/auth/register',{username:'ab',password:'passwordlunga1'})).json().error,'invalid_username');
  assert.equal((await f.post('/auth/register',{username:'mario rossi',password:'passwordlunga1'})).statusCode,400);
  const weak=await f.post('/auth/register',{username:'mario',password:'short'});assert.equal(weak.statusCode,400);assert.equal(weak.json().error,'weak_password');
  assert.equal((await f.post('/auth/register',{username:'mario'})).statusCode,400);
  assert.equal((await f.post('/auth/register',{username:'mario',password:'passwordlunga1',extra:1})).statusCode,400);
  const reg=await f.post('/auth/register',{username:'Mario.Rossi',password:'passwordlunga1'});
  assert.equal(reg.statusCode,201,reg.body);assert.equal(reg.json().username,'mario.rossi');
  const cookie=String(reg.headers['set-cookie']);
  assert.match(cookie,/^__Host-nova=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  const token=cookie.split(';')[0].slice(12);
  const session=(await f.db.pool.query('SELECT expires_at,owner_id FROM sessions WHERE token_hash=$1',[hash(token)])).rows[0];
  const days=(session.expires_at.getTime()-Date.now())/86400000;assert.ok(days>6.9&&days<=7.01,String(days));
  const cred=(await f.db.pool.query('SELECT username,password_hash,last_login_at FROM account_credentials WHERE owner_id=$1',[session.owner_id])).rows[0];
  assert.equal(cred.username,'mario.rossi');assert.notEqual(cred.password_hash,'passwordlunga1');assert.match(cred.password_hash,/^scrypt\$/);assert.equal(cred.last_login_at,null);
  const auth={...headers,cookie:cookie.split(';')[0]};
  const created=await f.web.inject({method:'POST',url:'/api/conversations',headers:{...auth,'idempotency-key':'first'},payload:{title:'ACCOUNT'}});assert.equal(created.statusCode,201);
  assert.equal((await f.web.inject({url:'/api/workspace',headers:auth})).json().conversations[0].title,'ACCOUNT');
  // duplicate, case-insensitive
  const dup=await f.post('/auth/register',{username:'MARIO.ROSSI',password:'passwordlunga2'});assert.equal(dup.statusCode,409);assert.equal(dup.json().error,'username_taken');
  assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM users')).rows[0].n,1,'failed registration must not leave a user row');
  // logout
  const out=await f.web.inject({method:'POST',url:'/auth/logout',headers:auth,payload:{}});assert.equal(out.statusCode,200);assert.match(String(out.headers['set-cookie']),/Max-Age=0/);
  assert.equal((await f.web.inject({url:'/api/workspace',headers:auth})).statusCode,401);
  // login
  const bad=await f.post('/auth/login',{username:'mario.rossi',password:'passwordlunga2'});assert.equal(bad.statusCode,401);assert.equal(bad.json().error,'invalid_credentials');assert.equal(bad.headers['set-cookie'],undefined);
  const before=scryptStats.dummyVerifications;
  const unknown=await f.post('/auth/login',{username:'nessuno',password:'passwordlunga1'});assert.equal(unknown.statusCode,401);assert.equal(unknown.json().error,'invalid_credentials');
  assert.equal(scryptStats.dummyVerifications,before+1,'unknown username must still run scrypt against the dummy hash');
  assert.equal((await f.post('/auth/login',{username:'MARIO ROSSI!',password:'passwordlunga1'})).statusCode,401);
  assert.equal((await f.post('/auth/login',{username:'mario.rossi'})).statusCode,401);
  const login=await f.post('/auth/login',{username:' Mario.Rossi ',password:'passwordlunga1'});assert.equal(login.statusCode,200,login.body);
  const cookie2=String(login.headers['set-cookie']);assert.match(cookie2,/HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
  const auth2={...headers,cookie:cookie2.split(';')[0]};
  assert.equal((await f.web.inject({url:'/api/workspace',headers:auth2})).json().conversations[0].title,'ACCOUNT','login must reach the same account');
  const after=(await f.db.pool.query('SELECT last_login_at FROM account_credentials WHERE username=$1',['mario.rossi'])).rows[0];assert.ok(after.last_login_at instanceof Date);
  // purged users cannot log in
  await f.db.pool.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE id=$1",[session.owner_id]);
  assert.equal((await f.post('/auth/login',{username:'mario.rossi',password:'passwordlunga1'})).statusCode,401);
  // invite flow untouched: 24h session
  const a=await bootstrap(f.db.pool);const invite=await issueInvite(f.db.pool,a.userId,60);const ex=await f.post('/auth/exchange',{invite});assert.equal(ex.statusCode,200);assert.match(String(ex.headers['set-cookie']),/Max-Age=86400$/);
 }finally{await f.close()}
});

test('new auth routes: CSRF, generic + registration + login-failure rate limits, registration_closed',async()=>{
 const f=await fixture();
 try{
  for(const url of ['/auth/register','/auth/login']){
   assert.equal((await f.post(url,{username:'csrf',password:'passwordlunga1'},{origin:'https://evil.example'})).statusCode,403);
   assert.equal((await f.web.inject({method:'POST',url,headers:{host:'trial.example',origin:'https://trial.example'},payload:{username:'csrf',password:'passwordlunga1'}})).statusCode,403);
  }
  // registration bucket: 5 per IP per hour (counts attempts, also failed ones)
  for(let i=0;i<5;i++)assert.equal((await f.post('/auth/register',{username:'user'+i,password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.1'})).statusCode,201);
  const sixth=await f.post('/auth/register',{username:'user5',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.1'});assert.equal(sixth.statusCode,429);assert.equal(sixth.json().error,'rate_limited');
  assert.equal((await f.post('/auth/register',{username:'user5',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.2'})).statusCode,201,'other IP unaffected');
  // login failure throttle: 10 failures per IP+username in 15 minutes
  for(let i=0;i<10;i++)assert.equal((await f.post('/auth/login',{username:'user0',password:'sbagliata'+i+'xx'},{'cf-connecting-ip':'10.0.0.3'})).statusCode,401);
  const throttled=await f.post('/auth/login',{username:'user0',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.3'});
  assert.equal(throttled.statusCode,429);assert.equal(throttled.json().error,'rate_limited');assert.ok(Number.isInteger(throttled.json().retry_after)&&throttled.json().retry_after>0&&throttled.json().retry_after<=900);
  assert.equal((await f.post('/auth/login',{username:'user1',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.3'})).statusCode,200,'other username from same IP unaffected');
  assert.equal((await f.post('/auth/login',{username:'user0',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.4'})).statusCode,200,'same username from other IP unaffected');
  // generic 20/min bucket also applies to login
  for(let i=0;i<20;i++)await f.post('/auth/login',{username:'user'+(i%3),password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.5'});
  assert.equal((await f.post('/auth/login',{username:'user2',password:'passwordlunga1'},{'cf-connecting-ip':'10.0.0.5'})).statusCode,429);
 }finally{await f.close()}
 const closed=await fixture({registration:false});
 try{
  const r=await closed.post('/auth/register',{username:'chiuso',password:'passwordlunga1'});assert.equal(r.statusCode,403);assert.equal(r.json().error,'registration_closed');
  assert.equal((await closed.db.pool.query('SELECT count(*)::int n FROM users')).rows[0].n,0);
 }finally{await closed.close()}
});
