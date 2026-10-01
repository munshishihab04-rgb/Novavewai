import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';import {database} from './helpers.ts';import {buildApp,bootstrap,migrate} from '../src/app.ts';
// Regression tests for two admission gaps: global capacity serialized across owners
// under database coordination, and a durable idempotent /voice/sessions handshake
// (duplicate, concurrent, lost-ack, cancel, revoke, restart) without duplicate provider calls.
class Speech extends EventEmitter{sent:any[]=[];closed=false;send(e:any){this.sent.push(e)}close(){this.closed=true}}
async function fixture(){const db=await database();await migrate(db.pool);const connects:string[]=[];let hold:null|Promise<void>=null;let release=()=>{};
 const build=()=>{const app=buildApp(db.pool,{agent:{endpoint:'https://fixture.invalid',model:'controlled',voice:{connect:async(sdp:string)=>{connects.push(sdp);if(hold)await hold;return {sdp:'answer-'+connects.length,transport:new Speech()}}},provider:{complete:async()=>({role:'assistant',content:'unused'})}}} as any);return app};
 let app=build();await app.ready();
 const send=(url:string,payload?:any,token?:string,key=randomUUID())=>app.inject({url,method:payload?'POST':'GET',headers:{authorization:'Bearer '+token,'idempotency-key':key},payload});
 const user=async()=>{const u=await bootstrap(db.pool);const c=(await send('/conversations',{title:'Voice'},u.token)).json();return {...u,c}};
 return {db,connects,send,user,holdConnect(){hold=new Promise<void>(r=>{release=r})},releaseConnect(){release();hold=null},get app(){return app},async restart(){await app.close();app=build();await app.ready()},close:async()=>{await app.close();await db.close()}}}
const offer=(c:any,sdp='synthetic-offer')=>({conversationId:c.id,sdp,language:'auto'});
const live=async(f:any)=>(await f.db.pool.query("SELECT count(*)::int n FROM voice_sessions WHERE status IN ('active','connecting')")).rows[0].n;
test('global voice capacity of four is serialized across owners under database coordination',async()=>{const f=await fixture();try{
 const users=await Promise.all(Array.from({length:8},()=>f.user()));f.holdConnect();
 const pending=users.map(u=>f.send('/voice/sessions',offer(u.c),u.token));await new Promise(r=>setTimeout(r,300));
 assert.ok(await live(f)<=4,'more than four sessions admitted concurrently');f.releaseConnect();const results=await Promise.all(pending);
 const codes=results.map(r=>r.statusCode).sort();assert.deepEqual(codes,[201,201,201,201,429,429,429,429],JSON.stringify(results.map(r=>r.json())));
 assert.equal(f.connects.length,4,'rejected owners must not cost provider calls');assert.equal(await live(f),4);
 const admitted=results.filter(r=>r.statusCode===201).map(r=>r.json());const rejected=users.filter(u=>!admitted.some(a=>a.conversationId===u.c.id));
 assert.equal((await f.send('/voice/sessions',offer(rejected[0].c),rejected[0].token)).statusCode,429,'still full');
 const owner=users.find(u=>u.c.id===admitted[0].conversationId)!;assert.equal((await f.send('/voice/sessions/'+admitted[0].id+'/stop',{},owner.token)).statusCode,200);
 assert.equal((await f.send('/voice/sessions',offer(rejected[0].c),rejected[0].token)).statusCode,201,'positive control: freed slot admits a waiting owner');assert.equal(await live(f),4);
}finally{await f.close()}});
test('duplicate handshake replays the durable answer without a second provider call and rejects mismatched payloads',async()=>{const f=await fixture();try{
 const u=await f.user(),other=await f.user();const key=randomUUID();const first=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(first.statusCode,201,first.body);
 const again=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(again.statusCode,201);assert.deepEqual(again.json(),first.json());assert.equal(f.connects.length,1);
 assert.equal((await f.send('/voice/sessions',offer(u.c,'another-offer-sdp'),u.token,key)).json().error,'idempotency_conflict');
 assert.equal((await f.send('/voice/sessions',offer(u.c),u.token)).json().error,'voice_active','fresh key is a genuinely new request');
 assert.equal((await f.send('/voice/sessions',offer(u.c),other.token,key)).statusCode,404,'key namespace is per owner; foreign conversation');
 const byKey=await f.send('/voice/sessions?requestKey='+key,undefined,u.token);assert.equal(byKey.statusCode,200);assert.equal(byKey.json().id,first.json().id);assert.equal(byKey.json().status,'active');assert.equal(byKey.json().sdp,undefined,'read-only recovery never returns provider answer');
 assert.equal((await f.send('/voice/sessions?requestKey='+key,undefined,other.token)).statusCode,404);
 assert.equal((await f.send('/voice/sessions',{conversationId:u.c.id,sdp:'synthetic-offer',language:'auto'},u.token,'' as any)).statusCode,400,'idempotency key required');
 assert.equal(f.connects.length,1);
}finally{await f.close()}});
test('lost ack during connection: pending is reported honestly, recovery is read-only, replay follows the real outcome',async()=>{const f=await fixture();try{
 const u=await f.user();const key=randomUUID();f.holdConnect();const original=f.send('/voice/sessions',offer(u.c),u.token,key);await new Promise(r=>setTimeout(r,100));
 const dup=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(dup.statusCode,409);assert.equal(dup.json().error,'voice_pending');
 const byKey=(await f.send('/voice/sessions?requestKey='+key,undefined,u.token)).json();assert.equal(byKey.status,'connecting');assert.ok(byKey.id);assert.equal(byKey.conversationId,u.c.id);
 assert.equal(f.connects.length,1);f.releaseConnect();const done=await original;assert.equal(done.statusCode,201);assert.equal(done.json().id,byKey.id);
 const replay=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(replay.statusCode,201);assert.deepEqual(replay.json(),done.json());assert.equal(f.connects.length,1);
 // Cancel while connecting: the unknown session id is recoverable by key and stoppable before the answer arrives.
 const u2=await f.user();const key2=randomUUID();f.holdConnect();const second=f.send('/voice/sessions',offer(u2.c),u2.token,key2);await new Promise(r=>setTimeout(r,100));
 const id2=(await f.send('/voice/sessions?requestKey='+key2,undefined,u2.token)).json().id;assert.equal((await f.send('/voice/sessions/'+id2+'/stop',{},u2.token)).statusCode,200);f.releaseConnect();
 assert.equal((await second).json().error,'voice_stopped');const after=await f.send('/voice/sessions',offer(u2.c),u2.token,key2);assert.equal(after.statusCode,409);assert.equal(after.json().error,'voice_stopped');
 assert.equal((await f.send('/voice/sessions/'+id2,undefined,u2.token)).json().status,'stopped');assert.equal(f.connects.length,2,'replay after cancellation never reconnects');
}finally{await f.close()}});
test('replay respects revocation and restart: stale answers are never replayed for dead sessions',async()=>{const f=await fixture();try{
 const u=await f.user();const key=randomUUID();const first=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(first.statusCode,201);
 await f.restart();const state=(await f.send('/voice/sessions/'+first.json().id,undefined,u.token)).json();assert.ok(['stopped','failed'].includes(state.status),JSON.stringify(state));
 const replay=await f.send('/voice/sessions',offer(u.c),u.token,key);assert.equal(replay.statusCode,409);assert.equal(replay.json().error,'voice_stopped');assert.equal(f.connects.length,1);
 const fresh=await f.send('/voice/sessions',offer(u.c),u.token);assert.equal(fresh.statusCode,201,'positive control: a new key opens a new session after restart');assert.equal(f.connects.length,2);
 await f.db.pool.query('DELETE FROM sessions WHERE owner_id=$1',[u.userId]);assert.equal((await f.send('/voice/sessions',offer(u.c),u.token,key)).statusCode,401);assert.equal(f.connects.length,2);
}finally{await f.close()}});
