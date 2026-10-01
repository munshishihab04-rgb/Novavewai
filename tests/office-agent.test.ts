import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {database,request} from './helpers.ts';import {webDataRoutes} from '../src/web.ts';
import {validateTools,toolDefinitions} from '../src/agent-tools.ts';import {capabilitySummary} from '../src/identity.ts';import {extractOffice} from '../src/office.ts';
const tc=(name:string,args:any)=>({id:randomUUID(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}});
async function settled(pool:any,id:string){for(let i=0;i<800;i++){const r=(await pool.query('SELECT * FROM agent_runs WHERE id=$1',[id])).rows[0];if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('timeout')}
test('create_file accepts docx/xlsx formats with matching extensions; capability line is honest',()=>{
 assert.ok(validateTools([tc('create_file',{name:'tabella.xlsx',format:'xlsx',text:'a,b\n1,2',entries:[]})]).length);
 assert.ok(validateTools([tc('create_file',{name:'lettera.docx',format:'docx',text:'# Titolo\ntesto',entries:[]})]).length);
 assert.throws(()=>validateTools([tc('create_file',{name:'tabella.xls',format:'xlsx',text:'a',entries:[]})]),/invalid_generated_file/);
 assert.throws(()=>validateTools([tc('create_file',{name:'x.docx',format:'xlsx',text:'a',entries:[]})]),/invalid_generated_file/);
 const s=capabilitySummary(toolDefinitions);assert.match(s,/DOCX/);assert.match(s,/XLSX/);assert.match(s,/CSV/);
});
test('agent creates xlsx/docx/csv files, downloads carry the right MIME and real bytes; uploaded xlsx/docx are extracted so read_file can read them; revisions re-render',async()=>{
 const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool),other=await bootstrap(db.pool);let script:(m:any[])=>any=()=>({role:'assistant',content:'x'});
 const root=await mkdtemp(join(tmpdir(),'nova-office-'));const app=buildApp(db.pool,{fileRoot:root,agent:{endpoint:'https://example.org',model:'controlled-no-network',provider:{complete:async(m:any[])=>script(m)}}} as any);webDataRoutes(app,db.pool);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const c=(await request(base,'/conversations',user.token,{title:'Office'},'POST',randomUUID())).body;let sequence=0,taskId:string|undefined;
  async function turn(text:string){const t=await request(base,`/conversations/${c.id}/turns`,user.token,{baseSequence:sequence,text,...(taskId?{taskId}:{})},'POST',randomUUID());assert.equal(t.status,201,JSON.stringify(t.body));taskId=t.body.taskId;const run=await settled(db.pool,t.body.id);sequence=(await db.pool.query('SELECT max(sequence)::int n FROM messages WHERE conversation_id=$1',[c.id])).rows[0].n;assert.equal(run.status,'completed',run.error_code);return (await db.pool.query('SELECT tool,result FROM agent_tool_receipts WHERE run_id=$1 ORDER BY created_at',[run.id])).rows}
  const files:Record<string,any>={};
  for(const [name,format,text] of [['ore.xlsx','xlsx','nome,ore\nAmina,38\n"Li, Wei",40'],['lettera.docx','docx','# Lettera\n## Oggetto\nRichiesta documenti\n- punto uno'],['ore.csv','text','nome,ore\nAmina,38']]){
   script=m=>m.at(-1).role==='tool'?{role:'assistant',content:'Fatto.'}:{role:'assistant',content:null,tool_calls:[tc('create_file',{name,format,text,entries:[]})]};
   const r=await turn('crea '+name);files[name]=r.find(x=>x.tool==='create_file')!.result;assert.match(files[name].download,/\/download$/);
  }
  const expectMime:Record<string,string>={'ore.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','lettera.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','ore.csv':'text/csv; charset=utf-8'};
  for(const [name,f] of Object.entries(files)){
   const dl=await fetch(base+f.download,{headers:{authorization:`Bearer ${user.token}`}});assert.equal(dl.status,200,name);assert.equal(dl.headers.get('content-type'),expectMime[name],name);
   const bytes=Buffer.from(await dl.arrayBuffer());
   if(name.endsWith('.csv'))assert.equal(bytes.toString(),'nome,ore\nAmina,38');else{assert.equal(bytes.subarray(0,2).toString(),'PK',name);const ex=await extractOffice(name,bytes);assert.equal(ex.status,'extracted',name);assert.ok(ex.text!.includes(name.endsWith('.xlsx')?'Li, Wei':'Richiesta documenti'),name)}
   assert.equal((await fetch(base+f.download,{headers:{authorization:`Bearer ${other.token}`}})).status,404,'owner isolation '+name);
  }
  // Revision via the editor route (CSV text) re-renders the xlsx from the new text.
  const rev=await request(base,`/artifacts/${files['ore.xlsx'].id}/revisions`,user.token,{baseRevision:1,content:{text:'nome,ore\nAmina,41',language:'en'}},'POST',randomUUID());assert.equal(rev.status,201,JSON.stringify(rev.body));
  const dl2=await fetch(`${base}/artifacts/${files['ore.xlsx'].id}/revisions/2/download`,{headers:{authorization:`Bearer ${user.token}`}});const ex2=await extractOffice('ore.xlsx',Buffer.from(await dl2.arrayBuffer()));assert.ok(ex2.text!.includes('41'));assert.ok(!ex2.text!.includes('38'));
  // Workspace exposes the file kind so the UI can choose the table editor.
  const ws=await request(base,'/workspace',user.token);assert.equal(ws.body.artifacts.find((a:any)=>a.id===files['ore.xlsx'].id).file.format,'xlsx');
  // Upload: an .xlsx the user brings in is extracted to CSV text and read_file returns it.
  const xlsxBytes=Buffer.from(await (await fetch(base+files['ore.xlsx'].download,{headers:{authorization:`Bearer ${user.token}`}})).arrayBuffer());
  const up=await request(base,'/files/upload',user.token,{conversationId:c.id,name:'turni.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',dataBase64:xlsxBytes.toString('base64')},'POST',randomUUID());assert.equal(up.status,201,JSON.stringify(up.body));
  assert.equal(up.body.extraction.status,'extracted');assert.equal(up.body.extraction.method,'openpyxl');
  script=m=>m.at(-1).role==='tool'?{role:'assistant',content:JSON.parse(m.at(-1).content).text}:{role:'assistant',content:null,tool_calls:[tc('read_file',{fileId:up.body.id})]};
  const rr=await turn('leggi il file');assert.equal(rr[0].result.extraction,'extracted');assert.ok(rr[0].result.text.includes('Li, Wei'));
  const docxBytes=Buffer.from(await (await fetch(base+files['lettera.docx'].download,{headers:{authorization:`Bearer ${user.token}`}})).arrayBuffer());
  const upd=await request(base,'/files/upload',user.token,{conversationId:c.id,name:'bozza.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:docxBytes.toString('base64')},'POST',randomUUID());assert.equal(upd.body.extraction.method,'python-docx');assert.ok(upd.body.extraction.text.includes('Oggetto'));
 }finally{await app.close();await db.close()}
});
