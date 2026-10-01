// Live-ish proof for CV v1: controlled provider (no network), real HTTP path, real PDF worker.
// Scenario: "Voglio fare il mio CV" → name → headline+city → experience → confirmation + export in 3 templates.
// Writes evidence/cv-v1/samples/*.pdf, scenario.json and (if pdftoppm is available) page-1 PNGs.
import {randomUUID} from 'node:crypto';import {writeFile,mkdir} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {capabilityRoutes} from '../src/capabilities.ts';import {webDataRoutes} from '../src/web.ts';
import {database,request} from '../tests/helpers.ts';import {extractPdf} from '../src/documents.ts';
const tc=(name:string,args:any)=>({id:randomUUID(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
async function settled(pool:any,id:string){for(let i=0;i<1500;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
const out='evidence/cv-v1/samples/';await mkdir(out,{recursive:true});
const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);
// Deterministic "model": extracts facts from the user's words following the next_question receipt; never invents.
let artifactId:string|undefined,baseRevision=0;
const provider={complete:async(messages:any[])=>{
 const last=messages.at(-1);
 if(last.role==='tool'){const r=JSON.parse(last.content);if(r.error)return {role:'assistant',content:'Errore: '+r.error};artifactId=r.artifactId??artifactId;if(r.revision&&r.card)baseRevision=r.revision;
  if(r.next_question)return {role:'assistant',content:null,tool_calls:[tc('ask_question',{text:r.next_question})]};
  if(r.download)return {role:'assistant',content:`Il tuo CV in PDF (modello ${r.template}, ${r.language}) è pronto: ${r.name}. È la versione ${r.revision} del CV; se cambi qualcosa lo rigeneriamo.`};
  return {role:'assistant',content:null,tool_calls:[tc('ask_question',{text:'Ho salvato tutto. Confermi i dati? Che modello preferisci: moderno, classico o professionale?'})]}}
 const text:string=last.content;const t=text.toLowerCase();
 if(/voglio fare il mio cv/.test(t))return {role:'assistant',content:null,tool_calls:[tc('ask_question',{text:'Volentieri. Come ti chiami? (nome e cognome come vuoi che compaiano sul CV)'})]};
 if(/mi chiamo/.test(t)){const name=text.match(/mi chiamo ([^.,\n]+)/i)![1].trim();return {role:'assistant',content:null,tool_calls:[tc('cv_upsert',{facts:{identity:{full_name:name}},change_summary:'nome'})]}}
 if(/faccio (la|il) /.test(t)){const headline=text.match(/faccio (?:la|il) ([^.,\n]+?)(?: a | e |,|\.|$)/i)![1].trim();const city=text.match(/ a ([A-Z][a-zà-ù]+)/)?.[1]??'';return {role:'assistant',content:null,tool_calls:[tc('cv_upsert',{artifactId,baseRevision,facts:{identity:{headline:headline.charAt(0).toUpperCase()+headline.slice(1),city}},change_summary:'ruolo e città'})]}}
 if(/dal |da /.test(t)&&/presso|alla|da /.test(t)){return {role:'assistant',content:null,tool_calls:[tc('cv_upsert',{artifactId,baseRevision,facts:{experiences:[{role:'Magazziniera',employer:'Logistica Emilia Srl',city:'Bologna',start:'2022-03',end:null,bullets:['Gestione inventario e controllo merci in ingresso','Preparazione ordini con lettore barcode']}],education:[{title:'Diploma di scuola superiore',institution:'Istituto Aldini Valeriani',city:'Bologna',start:'',end:'2018-07'}],skills:[{name:'Muletto (patentino)',level:''},{name:'Excel',level:'base'}],languages:[{name:'Italiano',level:'B2'},{name:'Bengalese',level:'madrelingua'},{name:'Inglese',level:'A2'}],consent_line:'Autorizzo il trattamento dei miei dati personali ai sensi del D.Lgs. 196/2003 e del GDPR (Reg. UE 2016/679).'},change_summary:'esperienza, istruzione, competenze, lingue, consenso'})]}}
 const m=t.match(/confermo.*(moderno|classico|professionale)/);if(m){const template=({moderno:'modern',classico:'classic',professionale:'professional'} as any)[m[1]];return {role:'assistant',content:null,tool_calls:[tc('cv_export',{artifactId,template,language:'it'})]}}
 return {role:'assistant',content:'Non ho capito, puoi ripetere?'};
}};
const app=buildApp(db.pool,{agent:{endpoint:'https://example.org',model:'controlled-no-network',provider}} as any);capabilityRoutes(app,db.pool);webDataRoutes(app,db.pool);
const transcript:any[]=[];
try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Il mio CV'},'POST',randomUUID())).body;let sequence=0,taskId:string|undefined;
 async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text,...(taskId?{taskId}:{})},'POST',randomUUID());if(t.status!==201)throw Error(JSON.stringify(t.body));taskId=t.body.taskId;const run=await settled(db.pool,t.body.id);const msgs=(await db.pool.query('SELECT role,text,sequence FROM messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence',[c.id,sequence])).rows;sequence=msgs.at(-1).sequence;const receipts=(await db.pool.query('SELECT tool,result FROM agent_tool_receipts WHERE run_id=$1 ORDER BY created_at',[run.id])).rows;transcript.push({user:text,run:{status:run.status,error:run.error_code},assistant:msgs.filter(m=>m.role==='assistant').map(m=>m.text),tools:receipts.map(r=>({tool:r.tool,result:r.tool==='cv_export'?{...r.result,note:undefined}:{artifactId:r.result.artifactId,revision:r.result.revision,completeness:r.result.completeness,verification:r.result.verification,next_question:r.result.next_question}}))});if(!['completed','waiting_user'].includes(run.status))throw Error(`run ${run.status} ${run.error_code}`);return receipts}
 await turn('Voglio fare il mio CV');
 await turn('Mi chiamo Amina Rahman');
 await turn('Faccio la magazziniera a Bologna');
 await turn('Lavoro dal marzo 2022 alla Logistica Emilia Srl di Bologna: gestione inventario, controllo merci in ingresso e preparazione ordini con lettore barcode. Ho il diploma all’Istituto Aldini Valeriani (2018), patentino del muletto, Excel base. Parlo italiano B2, bengalese madrelingua, inglese A2. Aggiungi la frase sul consenso privacy.');
 const samples:any[]=[];
 for(const [word,template] of [['moderno','modern'],['classico','classic'],['professionale','professional']]){
  const receipts=await turn(`Confermo tutto, va bene così. Scegli il modello ${word}.`);const ex=receipts.find(r=>r.tool==='cv_export')!.result;
  const dl=await fetch(base+ex.download,{headers:{authorization:`Bearer ${user.token}`}});const bytes=Buffer.from(await dl.arrayBuffer());
  const file=`${out}cv-sample-${template}.pdf`;await writeFile(file,bytes);const text=await extractPdf(bytes);
  samples.push({template,file,bytes:bytes.length,sha256:ex.sha256,pages:text.pages,containsName:text.text.includes('Amina Rahman'),revision:ex.revision,download:ex.download});
 }
 const ws=await request(base,'/workspace',user.token);
 await writeFile('evidence/cv-v1/scenario.json',JSON.stringify({transcript,samples,workspaceCvCard:ws.body.artifacts.find((a:any)=>a.cv)?.cv,generatedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({samples,card:ws.body.artifacts.find((a:any)=>a.cv)?.cv},null,2));
 let png='skipped: pdftoppm not installed';try{execFileSync('which',['pdftoppm']);for(const s of samples)execFileSync('pdftoppm',['-png','-r','80','-f','1','-l','1',s.file,s.file.replace(/\.pdf$/,'-p1')]);png='rendered'}catch{}
 console.log('PNG:',png);
}finally{await app.close();await db.close()}
