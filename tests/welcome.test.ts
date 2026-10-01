import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.ts';
import { bootstrap,buildApp,migrate } from '../src/app.ts';
import {buildWeb,initWeb,issueInvite} from '../src/web.ts';
test('personal invite preview: private, non-consuming, expiring and origin protected',async()=>{
 const db=await database();await migrate(db.pool);await initWeb(db.pool);const a=await bootstrap(db.pool),b=await bootstrap(db.pool);const core=buildApp(db.pool);const web=await buildWeb(core,db.pool);const headers={host:'trial.example',origin:'https://trial.example','x-nova-request':'1'};
 try{
 const invite=await issueInvite(db.pool,a.userId,60),other=await issueInvite(db.pool,b.userId,60);
 const preview=()=>web.inject({method:'POST',url:'/auth/preview',headers,payload:{invite}});
 assert.equal((await preview()).statusCode,200);
 await db.pool.query('INSERT INTO web_welcomes(owner_id,title,message) VALUES($1,$2,$3)',[a.userId,'Benvenuto, Ricky.','Il mio carissimo socio e mentore.']);
 assert.equal((await preview()).json().welcome.title,'Benvenuto, Ricky.');
 assert.equal((await preview()).json().welcome.message,'Il mio carissimo socio e mentore.');
 assert.equal((await web.inject({method:'POST',url:'/auth/preview',headers,payload:{invite:other}})).json().welcome,null);
 assert.equal((await web.inject({method:'POST',url:'/auth/preview',headers:{...headers,origin:'https://evil.example'},payload:{invite}})).statusCode,403);
 assert.equal((await web.inject({method:'POST',url:'/auth/preview',headers,payload:{invite:'bad'}})).statusCode,401);
 const login=await web.inject({method:'POST',url:'/auth/exchange',headers,payload:{invite}});assert.equal(login.statusCode,200);assert.equal((await preview()).statusCode,401);
 await db.pool.query("UPDATE web_invites SET expires_at=clock_timestamp()-interval '1 second'");
 assert.equal((await web.inject({method:'POST',url:'/auth/preview',headers,payload:{invite:other}})).statusCode,401);
 }finally{await web.close();await core.close();await db.close()}
});
