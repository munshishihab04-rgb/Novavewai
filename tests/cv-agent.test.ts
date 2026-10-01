import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';
import {capabilityRoutes} from '../src/capabilities.ts';import {webDataRoutes} from '../src/web.ts';import {extractPdf} from '../src/documents.ts';
import {toolDefinitions,validateTools} from '../src/agent-tools.ts';import {capabilitySummary} from '../src/identity.ts';
const tc=(name:string,args:any)=>({id:randomUUID(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
async function settled(pool:any,id:string){for(let i=0;i<800;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
const facts={identity:{full_name:'Amina Rahman',headline:'Magazziniera',city:'Bologna'},experiences:[{role:'Magazziniera',employer:'Logistica Srl',city:'Bologna',start:'2022-03',end:null,bullets:['Gestione inventario']}]};
test('cv tools are offered with closed schemas and an honest capability line',()=>{
 const names=toolDefinitions.map((t:any)=>t.function.name);assert.ok(names.includes('cv_upsert'));assert.ok(names.includes('cv_export'));
 assert.throws(()=>validateTools([tc('cv_upsert',{facts:{identity:{full_name:'A',photo:'x'}}})]),/tool_schema/);
 assert.throws(()=>validateTools([tc('cv_export',{artifactId:randomUUID(),template:'fancy',language:'it'})]),/tool_schema/);
 assert.ok(validateTools([tc('cv_upsert',{facts,change_summary:'prima raccolta'})]).length);
 const summary=capabilitySummary(toolDefinitions);assert.match(summary,/curriculum|CV/);assert.match(summary,/PDF/);
 assert.ok(!capabilitySummary(toolDefinitions.filter((t:any)=>!t.function.name.startsWith('cv_'))).match(/3 modelli|tre modelli/),'cv capability disappears without the tools');
});
test('cv_upsert creates revision 1 then 2 (immutable, hash changes), stamps verification, cv_export renders a real PDF per template; owner isolation and caps hold',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool),other=await bootstrap(db.pool);
 let script:((messages:any[])=>any)|null=null;
 const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(messages:any[])=>script!(messages)}}} as any);capabilityRoutes(app,db.pool);webDataRoutes(app,db.pool);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'CV'},'POST',randomUUID())).body;let sequence=0;let taskId:string|undefined;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text,...(taskId?{taskId}:{})},'POST',randomUUID());assert.equal(t.status,201,JSON.stringify(t.body));taskId=t.body.taskId;const run=await settled(db.pool,t.body.id);sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;return {run,results:(await db.pool.query('SELECT tool,result FROM agent_tool_receipts WHERE run_id=$1 ORDER BY created_at',[run.id])).rows};}
  // Turn 1: model proposes facts from the user's words → revision 1, verification=proposto.
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'Salvato. Che studi hai fatto?'}:{role:'assistant',content:null,tool_calls:[tc('cv_upsert',{facts,change_summary:'prima raccolta'})]};
  let r=await turn('Mi chiamo Amina Rahman, faccio la magazziniera a Bologna da marzo 2022 alla Logistica Srl');assert.equal(r.run.status,'completed',r.run.error_code);
  const up1=r.results.find((x:any)=>x.tool==='cv_upsert')!.result;assert.equal(up1.revision,1);assert.equal(up1.verification['identity.full_name'],'raccolto','value present verbatim in the user turn');assert.equal(up1.verification['identity.city'],'raccolto');assert.equal(up1.verification['experiences[0]'],'proposto','entry contains model-derived parts (dates, bullets)');assert.equal(up1.missing[0].field,'education');assert.equal(up1.completeness.done,2);
  const artifactId=up1.artifactId;const rev1=(await db.pool.query('SELECT content,hash FROM artifact_revisions WHERE artifact_id=$1 AND revision=1',[artifactId])).rows[0];assert.equal(rev1.content.kind,'cv');assert.equal(rev1.content.schema_version,1);assert.equal(rev1.content.cv.identity.full_name,'Amina Rahman');assert.ok(rev1.content.text.includes('Amina Rahman'),'plain text mirror for legacy readers');
  // Turn 2: the user explicitly confirms → server stamps confermato_utente ONLY for fields present in this upsert; revision 2 is new, revision 1 untouched.
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'Confermato.'}:{role:'assistant',content:null,tool_calls:[tc('cv_upsert',{artifactId,baseRevision:1,facts:{identity:{full_name:'Amina Rahman'},education:[{title:'Diploma',institution:'Istituto Aldini',city:'Bologna',start:'',end:'2018-07'}]},change_summary:'conferma nome, aggiunta istruzione'})]};
  r=await turn('Sì, confermo: il nome è giusto. Ho il diploma all’Istituto Aldini di Bologna, 2018');assert.equal(r.run.status,'completed',r.run.error_code);
  const up2=r.results.find((x:any)=>x.tool==='cv_upsert')!.result;assert.equal(up2.revision,2);assert.equal(up2.verification['identity.full_name'],'confermato_utente');assert.equal(up2.verification['education[0]'],'confermato_utente','confirmation applies to this turn’s values');assert.equal(up2.verification['experiences[0]'],'proposto','untouched facts keep their previous status');
  const rows=(await db.pool.query('SELECT revision,hash,content FROM artifact_revisions WHERE artifact_id=$1 ORDER BY revision',[artifactId])).rows;assert.equal(rows.length,2);assert.notEqual(rows[0].hash,rows[1].hash);assert.equal(rows[0].content.cv.education.length,0,'revision 1 immutable');assert.equal(rows[1].content.cv.education.length,1);assert.equal(rows[1].content.change_summary,'conferma nome, aggiunta istruzione');
  await assert.rejects(db.pool.query('UPDATE artifact_revisions SET content=$2 WHERE artifact_id=$1 AND revision=1',[artifactId,{}]),/immutable/);
  // Stale baseRevision is a conflict, not a silent overwrite.
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:JSON.parse(m.at(-1).content).error||'ok'}:{role:'assistant',content:null,tool_calls:[tc('cv_upsert',{artifactId,baseRevision:1,facts:{summary:'x'},change_summary:'stale'})]};
  r=await turn('aggiungi un profilo');assert.equal(r.run.status,'completed',r.run.error_code);assert.equal(r.results[0].result.error,'revision_conflict');
  // Export: 3 templates render a real PDF with the name; receipt points to an owner-bound download; the generated file is the exact rendered bytes.
  for(const template of ['modern','classic','professional']){
   script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'Ecco il PDF.'}:{role:'assistant',content:null,tool_calls:[tc('cv_export',{artifactId,template,language:'it'})]};
   r=await turn(`esporta in ${template}`);assert.equal(r.run.status,'completed',r.run.error_code);const ex=r.results.find((x:any)=>x.tool==='cv_export')!.result;
   assert.equal(ex.template,template);assert.equal(ex.revision,2);assert.match(ex.download,/^\/artifacts\/[0-9a-f-]+\/revisions\/1\/download$/);assert.equal(ex.format,'pdf');assert.ok(ex.sha256);
   const dl=await fetch(base+ex.download,{headers:{authorization:`Bearer ${user.token}`}});assert.equal(dl.status,200);const bytes=Buffer.from(await dl.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const text=await extractPdf(bytes);assert.ok(text.text.includes('Amina Rahman'),template);assert.ok(text.text.includes('Istituto Aldini'),template);
   assert.equal((await fetch(base+ex.download,{headers:{authorization:`Bearer ${other.token}`}})).status,404,'other owner cannot download');
  }
  // Unknown template is refused by schema before any worker call.
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'x'}:{role:'assistant',content:null,tool_calls:[tc('cv_export',{artifactId,template:'fancy',language:'it'})]};
  r=await turn('esporta fancy');assert.equal(r.run.status,'failed');assert.equal(r.run.error_code,'tool_schema');
  // Preview projection of a CV revision (GET pdf) honours ?template, rejects other owners, keeps old artifacts working.
  const preview=await fetch(`${base}/artifacts/${artifactId}/revisions/2/pdf?template=professional`,{headers:{authorization:`Bearer ${user.token}`}});assert.equal(preview.status,200);assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.equal((await fetch(`${base}/artifacts/${artifactId}/revisions/2/pdf?template=professional`,{headers:{authorization:`Bearer ${other.token}`}})).status,404);
  // Size cap: an oversized upsert is rejected as invalid_cv, no revision written.
  const before=(await db.pool.query('SELECT count(*)::int n FROM artifact_revisions WHERE artifact_id=$1',[artifactId])).rows[0].n;
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:JSON.parse(m.at(-1).content).error||'ok'}:{role:'assistant',content:null,tool_calls:[tc('cv_upsert',{artifactId,baseRevision:2,facts:{experiences:Array.from({length:20},()=>({role:'R',employer:'E',city:'C',start:'2020-01',end:null,bullets:Array.from({length:6},()=>'y'.repeat(230))}))},change_summary:'troppo'})]};
  r=await turn('aggiungi tutto');assert.equal(r.run.status,'completed',r.run.error_code);assert.equal(r.results[0].result.error,'invalid_cv');assert.equal((await db.pool.query('SELECT count(*)::int n FROM artifact_revisions WHERE artifact_id=$1',[artifactId])).rows[0].n,before);
  // Other owner cannot export this artifact through the agent either.
  const oc=(await request(base,'/conversations',other.token,{title:'CV altrui'},'POST',randomUUID())).body;
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'x'}:{role:'assistant',content:null,tool_calls:[tc('cv_export',{artifactId,template:'modern',language:'it'})]};
  const t=await request(base,`/conversations/${oc.id}/turns`,other.token,{baseSequence:0,text:'esporta'},'POST',randomUUID());const orun=await settled(db.pool,t.body.id);assert.equal(orun.status,'failed');assert.equal(orun.error_code,'tool_not_found');
  // Workspace exposes the cv card summary for the UI.
  const ws=await request(base,'/workspace',user.token);
  const card=(ws.body.artifacts||[]).find((a:any)=>a.id===artifactId);assert.ok(card,'cv artifact listed');assert.equal(card.cv.full_name,'Amina Rahman');assert.equal(card.cv.sections_total,8);
 }finally{await app.close();await db.close()}
});
