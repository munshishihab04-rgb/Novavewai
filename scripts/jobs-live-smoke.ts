import pg from 'pg';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';import assert from 'node:assert/strict';
// Live public smoke of the jobs path on the trial: synthetic user, real HTTP, real agent run. No Ricky data touched, no external job source fetched.
const root='/home/azureuser/.local/share/nova-community-trial',base=process.env.TRIAL_URL!;if(!/^https:\/\/[a-z-]+\.trycloudflare\.com$/.test(base))throw Error('origin');
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
const {bootstrap}=await import('../src/app.ts');const user=await bootstrap(pool);const invite=randomBytes(32).toString('base64url');await pool.query("INSERT INTO web_invites VALUES($1,$2,clock_timestamp()+interval '5 minutes')",[hash(invite),user.userId]);
const headers={'content-type':'application/json','x-nova-request':'1',origin:base};const login=await fetch(base+'/auth/exchange',{method:'POST',headers,body:JSON.stringify({invite})});assert.equal(login.status,200);const auth={...headers,cookie:login.headers.get('set-cookie')!.split(';')[0]};
const cr=await fetch(base+'/api/conversations',{method:'POST',headers:{...auth,'idempotency-key':'jobs-smoke-'+Date.now()},body:JSON.stringify({title:'Jobs smoke'})});assert.equal(cr.status,201);const conversation=await cr.json();
let sequence=0;const turns:any[]=[];
async function turn(text:string){const t=await fetch(base+`/api/conversations/${conversation.id}/turns`,{method:'POST',headers:{...auth,'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({baseSequence:sequence,text})});const tb=await t.json();assert.equal(t.status,201,JSON.stringify(tb));
 let run:any;for(let i=0;i<60;i++){await sleep(1500);run=await (await fetch(base+`/api/runs/${tb.id}`,{headers:auth})).json();if(['completed','failed','cancelled'].includes(run.status))break}
 const events=await (await fetch(base+`/api/runs/${tb.id}/events?limit=50`,{headers:auth})).json();sequence=(await pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[conversation.id])).rows[0].n;
 const jobs=events.items.filter((e:any)=>e.kind==='tool.succeeded'&&e.detail?.tool==='jobs_search').map((e:any)=>e.detail.result);
 const assistant=(await (await fetch(base+`/api/conversations/${conversation.id}/messages`,{headers:auth})).json());const last=(assistant.items||assistant).filter((m:any)=>m.role==='assistant').at(-1);
 turns.push({text,runStatus:run.status,jobs,assistant:last?.content?.slice(0,600)});return {run,jobs,last}}
const a=await turn('Cerco lavoro come cameriere');
const b=await turn('Bologna');
await mkdir("evidence/jobs-jsonld-1",{recursive:true});await writeFile('evidence/jobs-jsonld-1/live-trial-cameriere-bologna.json',JSON.stringify({base,checkedAt:new Date().toISOString(),syntheticOwner:user.userId,turns},null,2));
console.log(JSON.stringify({first:{status:a.run.status,results:a.jobs.map((j:any)=>j.status)},second:{status:b.run.status,results:b.jobs.map((j:any)=>({status:j.status,occupation:j.occupation,city:j.requestedCity||j.city,links:(j.searchLinks||[]).map((l:any)=>l.url),opportunities:(j.opportunities||[]).length}))},assistantSecond:b.last?.content?.slice(0,400)},null,1));
}finally{await pool.end()}
