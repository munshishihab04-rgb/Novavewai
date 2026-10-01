// Live language smoke on the public origin: throwaway account → onboarding save (bn) → preference read-back →
// chat turn in Italian must be answered in Bengali script → switch pref to en → mixed-language turn answered in English.
// Writes evidence/onboarding/language-live-smoke.json. Purge the account afterwards with scripts/purge-smoke-accounts.ts.
import {randomBytes} from 'node:crypto';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
// TRIAL_URL may include a mount path (https://licenzpol.it/nova); the Origin header must be the bare origin.
const base=process.env.TRIAL_URL!.replace(/\/$/,'');if(!/^https:\/\/[a-z0-9.-]+(\/[a-z0-9_-]+)?$/.test(base))throw Error('origin');const origin=new URL(base).origin;
const username='smoke_'+randomBytes(4).toString('hex'),password='Smoke-'+randomBytes(9).toString('base64url');
let cookie='';const H=()=>({'content-type':'application/json','x-nova-request':'1',origin,cookie});
async function call(path:string,body?:any,method='POST'){const r=await fetch(base+(path.startsWith('/auth/')?'':'/api')+path,{method:body?method:'GET',redirect:'manual',headers:{...H(),...(body?{'idempotency-key':randomBytes(8).toString('hex')}:{})},body:body?JSON.stringify(body):undefined});const sc=r.headers.get('set-cookie');if(sc&&/__Host-nova=/.test(sc))cookie=sc.split(';')[0];const txt=await r.text();let j:any;try{j=JSON.parse(txt)}catch{j=txt}return {status:r.status,body:j}}
const out:Record<string,unknown>={base,username};const evidenceDir=process.env.EVIDENCE_DIR||'evidence/onboarding';
const bengali=(s:string)=>(s.match(/[\u0980-\u09FF]/g)||[]).length,latin=(s:string)=>(s.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
async function turn(conv:string,text:string){const m0=await call(`/conversations/${conv}/messages`);const items0=m0.body.items||m0.body||[];const baseSequence=items0.length?Math.max(...items0.map((x:any)=>x.sequence||0)):0;const run=await call(`/conversations/${conv}/turns`,{baseSequence,text});assert.equal(run.status,201,JSON.stringify(run.body));const id=run.body.id;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const st=await call(`/runs/${id}`);if(['completed','waiting_user','failed','cancelled','outcome_unknown'].includes(st.body.status)){const m=await call(`/conversations/${conv}/messages`);const items=m.body.items||m.body||[];const last=[...items].reverse().find((x:any)=>x.role==='assistant');return {status:st.body.status,reply:last?.text||''}}}throw Error('run timeout')}
try{
 const reg=await call('/auth/register',{username,password});assert.equal(reg.status,201,JSON.stringify(reg.body));
 const p0=await call('/me/preferences');assert.equal(p0.body.onboarded,false);assert.equal(p0.body.language.ui,'it');out.firstVisitFlag=true;
 const save=await call('/me/preferences',{language:{ui:'bn',chat:'bn',voice:'bn'},onboarded:true},'PUT');assert.equal(save.status,200,JSON.stringify(save.body));assert.deepEqual(save.body.language,{ui:'bn',chat:'bn',voice:'bn'});assert.equal(save.body.onboarded,true);out.onboardingSaved=true;
 const conv=await call('/conversations',{title:'lingua'});assert.equal(conv.status,201,JSON.stringify(conv.body));const cid=conv.body.id;
 const t1=await turn(cid,'Ciao, mi chiamo Amina. Puoi spiegarmi in due frasi cosa puoi fare per me?');out.turn1={pref:'bn',userLanguage:'it',status:t1.status,reply:t1.reply,bengaliChars:bengali(t1.reply),latinChars:latin(t1.reply)};
 assert.ok(bengali(t1.reply)>20&&bengali(t1.reply)>latin(t1.reply),'reply must be in Bengali script although the user wrote Italian');
 const sw=await call('/me/preferences',{language:{chat:'en'}},'PUT');assert.equal(sw.body.language.chat,'en');assert.equal(sw.body.language.ui,'bn','ui untouched');
 const t2=await turn(cid,'Ami ekta CV banate chai, ma non so da dove iniziare. Can you help?');out.turn2={pref:'en',userLanguage:'banglish+it+en mixed',status:t2.status,reply:t2.reply,bengaliChars:bengali(t2.reply),latinChars:latin(t2.reply)};
 assert.ok(latin(t2.reply)>30&&bengali(t2.reply)===0,'reply must be English after the switch');
 assert.ok(/\b(the|you|your|can|help|CV)\b/i.test(t2.reply),'looks English');
 out.result='ok';
}catch(e){out.result='fail';out.error=String(e).slice(0,600);out.cookieSet=!!cookie}
await writeFile(evidenceDir+'/language-live-smoke.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));if(out.result!=='ok')process.exit(1);
