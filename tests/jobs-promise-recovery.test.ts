import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';
async function settled(pool:any,id:string){for(let i=0;i<500;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
// Observed on the public trial (2026-10-01): after "Barista" the model answered "Certo — cerco barista a Bologna. Vuoi
// che includa anche part-time…?" WITHOUT calling jobs_search, so the user got a promise and no cards. The server must
// not let a "cerco …" promise end a turn when occupation + city are already resolvable from the user's own turns.
test('a model reply that promises a job search without calling jobs_search is completed by the server with a real jobs_search (grounded on user turns only)',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const seen:string[]=[];
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(messages:any[])=>{
  const last=messages.at(-1);seen.push(last.role);
  if(last.role==='tool'){const r=JSON.parse(last.content);return {role:'assistant',content:`RESULT ${r.status} ${r.occupation??''} ${r.requestedCity??r.city??''}`}}
  // The model promises but does not act (the exact live behaviour).
  return {role:'assistant',content:'Certo — cerco **barista a Bologna**.\n\nVuoi che includa anche part-time o turni serali?'};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Promise'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());assert.equal(t.status,201);const run=await settled(db.pool,t.body.id);sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;const events=(await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items;const last=(await db.pool.query("SELECT text FROM messages WHERE conversation_id=$1 AND role='assistant' ORDER BY sequence DESC LIMIT 1",[c.id])).rows[0]?.text;return {run,events,last}}
  await turn('Cerco lavoro come barista');
  const r=await turn('Bologna');
  assert.equal(r.run.status,'completed');
  const jobs=r.events.filter((e:any)=>e.kind==='tool.succeeded'&&e.detail?.tool==='jobs_search');
  assert.equal(jobs.length,1,'server performed the promised jobs_search');
  assert.equal(jobs[0].detail.result.occupation,'barista');assert.equal(jobs[0].detail.result.requestedCity??jobs[0].detail.result.city,'Bologna');
  assert.ok(r.events.some((e:any)=>e.kind==='tool.recovered'&&e.detail?.reason==='promised_search_without_tool'),'recovery is auditable');
  assert.match(r.last,/^RESULT /,'the final reply is produced after the tool result, not the empty promise');
 }finally{await app.close();await db.close()}
});
test('no recovery when the text does not promise a search, or when the city is still missing (the question stands)',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(messages:any[])=>{
  if(messages.at(-1).role==='tool')return {role:'assistant',content:'RESULT'};
  const text=messages.at(-1).content;return {role:'assistant',content:text.startsWith('Cerco')?'In quale città vuoi cercare lavoro come barista?':'Ecco cosa posso fare per te.'};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'No promise'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());const run=await settled(db.pool,t.body.id);sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;return (await request(base,`/runs/${run.id}/events?limit=50`,user.token)).body.items}
  let ev=await turn('Cerco lavoro come barista');assert.equal(ev.filter((e:any)=>e.detail?.tool==='jobs_search').length,0,'asking for the city is fine; no city → no search');
  ev=await turn('Ciao, cosa sai fare?');assert.equal(ev.filter((e:any)=>e.detail?.tool==='jobs_search').length,0);
 }finally{await app.close();await db.close()}
});
