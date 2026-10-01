import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate,hash} from '../src/app.ts';import {database,request} from './helpers.ts';
import {readFile,writeFile} from 'node:fs/promises';import {chromium} from 'playwright';
const call=(query:string,city:string)=>({id:randomUUID(),type:'function' as const,function:{name:'jobs_search',arguments:JSON.stringify({query,city})}});
async function settled(pool:any,id:string){for(let i=0;i<500;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
test('controlled-provider native generic dispatch persists missing city, corrections, remote and suppresses duplicates',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);let model=0;
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(messages:any[])=>{
  model++;if(messages.at(-1).role==='tool'){const r=JSON.parse(messages.at(-1).content);return {role:'assistant',content:r.question||r.notice||r.code};}
  const text=messages.at(-1).content;return {role:'assistant',content:null,tool_calls:text.startsWith('saldatore')?[call('saldatore','Bologna'),call('saldatore','Bologna')]:[call('cameriere','Bologna')]};
 }}}} as any);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Generic jobs'},'POST',randomUUID())).body;let sequence=0;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text},'POST',randomUUID());assert.equal(t.status,201);const run=await settled(db.pool,t.body.id);assert.equal(run.status,'completed');sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;return {run,results:(await db.pool.query('SELECT result FROM agent_tool_receipts WHERE run_id=$1 ORDER BY created_at',[run.id])).rows.map((x:any)=>x.result)};}
  let r=await turn('cerco lavoro come programmatore');assert.equal(r.results[0].status,'needs_city');assert.equal(r.results[0].occupation,'programmatore');
  r=await turn('a Imola');assert.equal(r.results[0].status,'search_links_only');assert.equal(r.results[0].occupation,'programmatore');assert.equal(r.results[0].requestedCity,'Imola');
  r=await turn('ora a Jesi invece di Imola');assert.equal(r.results[0].requestedCity,'Jesi');
  r=await turn('cerco customer care remoto');assert.equal(r.results[0].requestedCity,'');assert.equal(r.results[0].occupation,'customer care');
  r=await turn('saldatore a Faenza');assert.equal(r.results[1].code,'jobs_retry_suppressed');
  const events=await request(base,`/runs/${r.run.id}/events?limit=50`,user.token);assert.ok(events.body.items.some((x:any)=>x.detail?.result?.searchLinks?.length));
  const code=await readFile(new URL('../staging/jobs-generic-1/app.js',import.meta.url),'utf8');const renderer=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/)![0];
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(t,s,c){const n=document.createElement(t);if(s!==undefined)n.textContent=s;if(c)n.className=c;return n}"+renderer});await page.evaluate(e=>(window as any).renderJobReceipts(e),events.body.items);assert.equal(await page.locator('a').count(),1);assert.match(await page.locator('#messages').innerText(),/saldatore.*Faenza/s);if(process.env.JOBS_GENERIC_EVIDENCE){await page.screenshot({path:'evidence/jobs-generic-1/native-receipt.png'});await writeFile('evidence/jobs-generic-1/native-events.json',JSON.stringify(events.body,null,2));}}finally{await browser.close()}
  assert.equal((await request(base,`/runs/${r.run.id}/events?limit=50`)).status,401);
 }finally{await app.close();await db.close()}
});
