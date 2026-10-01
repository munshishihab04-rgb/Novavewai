// Live identity probe on the public trial: ask the real agent who created Nova and what it can do.
import pg from 'pg';import {readFile,writeFile} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';import assert from 'node:assert/strict';
const base=process.env.TRIAL_URL!;if(!/^https:\/\/[a-z-]+\.trycloudflare\.com$/.test(base))throw Error('origin');
const root='/home/azureuser/.local/share/nova-community-trial';const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 const {bootstrap}=await import('../src/app.ts');const user=await bootstrap(pool);const invite=randomBytes(32).toString('base64url');await pool.query("INSERT INTO web_invites VALUES($1,$2,clock_timestamp()+interval '5 minutes')",[hash(invite),user.userId]);
 const headers={'content-type':'application/json','x-nova-request':'1',origin:base};const login=await fetch(base+'/auth/exchange',{method:'POST',headers,body:JSON.stringify({invite})});assert.equal(login.status,200);const auth={...headers,cookie:login.headers.get('set-cookie')!.split(';')[0]};
 const cr=await fetch(base+'/api/conversations',{method:'POST',headers:{...auth,'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({title:'Identity probe'})});const conversation=await cr.json();
 let sequence=0;const answers:any[]=[];
 for(const text of ['Ciao! Chi ti ha creata? Chi c\'è dietro Nova?','Cosa sai fare esattamente? Riesci a leggere la foto di un documento?']){
  const t=await fetch(base+`/api/conversations/${conversation.id}/turns`,{method:'POST',headers:{...auth,'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({baseSequence:sequence,text})});const tb=await t.json();assert.equal(t.status,201,JSON.stringify(tb));
  let run:any;for(let i=0;i<60;i++){await sleep(1500);run=await (await fetch(base+`/api/runs/${tb.id}`,{headers:auth})).json();if(['completed','failed','cancelled','waiting_user'].includes(run.status))break}
  const msgs=await (await fetch(base+`/api/conversations/${conversation.id}/messages`,{headers:auth})).json();const list=msgs.items||msgs;const last=list.filter((m:any)=>m.role==='assistant').at(-1);
  sequence=(await pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[conversation.id])).rows[0].n;
  answers.push({question:text,runStatus:run.status,answer:last?.text??last?.content??null});
 }
 await pool.query("UPDATE users SET status='purged',purged_at=clock_timestamp() WHERE id=$1",[user.userId]);
 await writeFile('evidence/public-access-1/live-identity-probe.json',JSON.stringify({base,checkedAt:new Date().toISOString(),answers},null,2));
 console.log(JSON.stringify(answers,null,1));
}finally{await pool.end()}
