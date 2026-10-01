import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';import {webDataRoutes} from '../src/web.ts';
import {sweepEphemeral} from '../src/context.ts';
test('temporary conversations: hidden from the workspace list, deletable by their owner only (cascade + file cleanup), swept after expiry',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool),other=await bootstrap(db.pool);const root=await mkdtemp(join(tmpdir(),'nova-eph-'));
 const app=buildApp(db.pool,{fileRoot:root});webDataRoutes(app,db.pool);try{const base=await app.listen({port:0,host:'127.0.0.1'});
  const normal=(await request(base,'/conversations',user.token,{title:'Normale'},'POST',randomUUID())).body;
  const temp=await request(base,'/conversations',user.token,{title:'Chat temporanea',ephemeral:true},'POST',randomUUID());assert.equal(temp.status,201,JSON.stringify(temp.body));assert.equal(temp.body.ephemeral,true);
  // Works like any conversation: messages, tasks, files.
  const t=await request(base,'/tasks',user.token,{conversationId:temp.body.id,goal:'g'},'POST',randomUUID());assert.equal(t.status,201);
  assert.equal((await request(base,`/conversations/${temp.body.id}/messages`,user.token,{baseSequence:0,text:'ciao'},'POST',randomUUID())).status,201);
  assert.equal((await request(base,'/artifacts',user.token,{taskId:t.body.id,title:'bozza',content:{text:'x',language:'it'}},'POST',randomUUID())).status,201);
  const up=await request(base,'/files/upload',user.token,{conversationId:temp.body.id,name:'nota.txt',mime:'text/plain',dataBase64:Buffer.from('ciao').toString('base64')},'POST',randomUUID());assert.equal(up.status,201,JSON.stringify(up.body));
  // Hidden from the list, still readable by id.
  const ws=await request(base,'/workspace',user.token);assert.ok(ws.body.conversations.some((c:any)=>c.id===normal.id));assert.ok(!ws.body.conversations.some((c:any)=>c.id===temp.body.id),'ephemeral hidden from list');
  assert.equal((await request(base,`/conversations/${temp.body.id}/messages?limit=10&after=0`,user.token)).status,200);
  // Other owner cannot delete it; owner can; everything cascades and the uploaded blob is scheduled for cleanup.
  assert.equal((await request(base,`/conversations/${temp.body.id}`,other.token,{},'DELETE',randomUUID())).status,404);
  const del=await request(base,`/conversations/${temp.body.id}`,user.token,{},'DELETE',randomUUID());assert.equal(del.status,200,JSON.stringify(del.body));assert.equal(del.body.deleted,true);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM conversations WHERE id=$1',[temp.body.id])).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM tasks WHERE conversation_id=$1',[temp.body.id])).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM files WHERE conversation_id=$1',[temp.body.id])).rows[0].n,0);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM file_cleanup WHERE id=$1',[up.body.id])).rows[0].n,0,'blob cleanup ran synchronously');
  assert.equal((await request(base,`/conversations/${temp.body.id}/messages?limit=10&after=0`,user.token)).status,404);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM messages WHERE conversation_id=$1',[temp.body.id])).rows[0].n,0);
  // Immutability of ordinary history is untouched outside the cascade.
  await assert.rejects(db.pool.query('DELETE FROM messages WHERE conversation_id=$1',[normal.id]).then(async()=>{await request(base,`/conversations/${normal.id}/messages`,user.token,{baseSequence:0,text:'m'},'POST',randomUUID());return db.pool.query('DELETE FROM messages WHERE conversation_id=$1',[normal.id])}),/immutable/);
  // Normal conversations are NOT deletable through this endpoint (explicit choice: no accidental history loss).
  assert.equal((await request(base,`/conversations/${normal.id}`,user.token,{},'DELETE',randomUUID())).status,409);
  // Expiry sweep: an old ephemeral conversation disappears, a fresh one and normal ones stay.
  const old=(await request(base,'/conversations',user.token,{title:'Vecchia temp',ephemeral:true},'POST',randomUUID())).body;await db.pool.query("UPDATE conversations SET created_at=now()-interval '2 days' WHERE id=$1",[old.id]);
  const fresh=(await request(base,'/conversations',user.token,{title:'Fresca temp',ephemeral:true},'POST',randomUUID())).body;
  const swept=await sweepEphemeral(db.pool);assert.equal(swept,1);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM conversations WHERE id=ANY($1)',[[old.id,fresh.id,normal.id]])).rows[0].n,2);
 }finally{await app.close();await db.close()}
});
