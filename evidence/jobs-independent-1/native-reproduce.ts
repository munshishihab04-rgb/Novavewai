import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {buildApp,bootstrap,migrate} from '../../src/app.ts';
import {database,request} from '../../tests/helpers.ts';
const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
let nextTool='jobs_search',query='cameriere',city='Milano';const calls:any[]=[];
const app=buildApp(db.pool,{agent:{endpoint:'https://example.org/v1',model:'review-fixture',jobsSearch:async(input:any)=>{calls.push({tool:'jobs_search',input});return {status:'ok',jobs:[]}},search:async(input:string)=>{calls.push({tool:'web_search',input});return {text:'REVIEW FIXTURE, no real search',sources:[]}},provider:{complete:async(messages:any[])=> messages.at(-1).role==='tool'?{role:'assistant',content:'REVIEW FIXTURE completed'}:{role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:nextTool,arguments:JSON.stringify(nextTool==='jobs_search'?{query,city}:{query})}}]}}}} as any);
const evidence:any[]=[];
async function turn(base:string,cid:string,text:string){const seq=(await db.pool.query('SELECT coalesce(max(sequence),0)::int n FROM messages WHERE conversation_id=$1',[cid])).rows[0].n;const r=await request(base,`/conversations/${cid}/turns`,user.token,{baseSequence:seq,text},'POST',randomUUID());assert.equal(r.status,201);for(let i=0;i<300;i++){const run=(await db.pool.query('SELECT * FROM agent_runs WHERE id=$1',[r.body.id])).rows[0];if(run&&!['queued','running'].includes(run.status)){assert.equal(run.status,'completed');return (await db.pool.query('SELECT result FROM agent_tool_receipts WHERE run_id=$1',[r.body.id])).rows[0].result;}await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
try{const base=await app.listen({port:0,host:'127.0.0.1'});
 async function conversation(){return (await request(base,'/conversations',user.token,{title:'Independent review fixture'},'POST',randomUUID())).body.id;}
 const c1=await conversation();city='Bologna';await turn(base,c1,'Cerco cameriere a Bologna');city='Milano';let before=calls.length;const corrected=await turn(base,c1,'Ora cerca a Milano invece di Bologna');assert.equal(corrected.status,'needs_city');assert.equal(calls.length,before);evidence.push({id:'I1',case:'explicit correction Bologna to Milano',receipt:corrected,sourceCalls:0});
 const c2=await conversation();city='Bologna';await turn(base,c2,'Cerco cameriere a Bologna');city='Parma';before=calls.length;await turn(base,c2,'Ora cerco cameriere a Parma');assert.equal(calls.at(-1).input.city,'Bologna');evidence.push({id:'I1',case:'new unsupported city silently replaced by old supported city',sourceCall:calls.at(-1)});
 const c3=await conversation();city='Milano';query='dishwasher';await turn(base,c3,'Dishwasher in Milano, direct employers only');assert.equal(calls.at(-1).input.query,'dishwasher');evidence.push({id:'I2',case:'native dispatch drops direct employers only constraint when model omits it',sourceCall:calls.at(-1)});
 const c4=await conversation();nextTool='web_search';query='lavapiatti Milano';before=calls.length;await turn(base,c4,'Cerco lavoro come lavapiatti');assert.equal(calls.length,before+1);evidence.push({id:'I3',case:'generic web_search has no server jobs-city/policy guard; model supplies missing city',sourceCall:calls.at(-1)});
 await writeFile(new URL('./native-reproductions.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await app.close();await db.close()}
