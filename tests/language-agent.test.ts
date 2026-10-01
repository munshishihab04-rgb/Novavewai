import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';import {webDataRoutes} from '../src/web.ts';
async function settled(pool:any,id:string){for(let i=0;i<800;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
test('chat agent receives the user\'s saved reply-language preference in its system prompt; auto by default; changes apply to the next turn',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const prompts:string[]=[];
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(m:any[])=>{prompts.push(m[0].content);return {role:'assistant',content:'ok'}}}}} as any);webDataRoutes(app,db.pool);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Lingua'},'POST',randomUUID())).body;let seq=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:seq,text},'POST',randomUUID());assert.equal(t.status,201);const run=await settled(db.pool,t.body.id);assert.equal(run.status,'completed',run.error_code);seq=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n}
  await turn('Ciao, amar naam Amina, I need help con il permesso di soggiorno');
  assert.match(prompts[0],/REPLY LANGUAGE: automatic/);assert.match(prompts[0],/MIX/);assert.match(prompts[0],/explicitly asks/);
  await request(base,'/me/preferences',user.token,{language:{chat:'bn'}},'PUT',randomUUID());
  await turn('grazie');
  assert.match(prompts[1],/ALWAYS reply in Bengali/);assert.match(prompts[1],/Bengali script/);assert.match(prompts[1],/even if the user writes in Italian, English or a mix/);
  await request(base,'/me/preferences',user.token,{language:{chat:'bn-latn'}},'PUT',randomUUID());await turn('ok');
  assert.match(prompts[2],/Latin script/);assert.match(prompts[2],/do not use Bengali script/);
 }finally{await app.close();await db.close()}
});
