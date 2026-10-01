// Independent harness (reviewer agent 2). Temporary embedded DB, synthetic provider, no network.
import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {database} from '../../tests/helpers.ts';import {buildApp,bootstrap,migrate} from '../../src/app.ts';import {validateTools} from '../../src/agent-tools.ts';
class Speech extends EventEmitter{sent:any[]=[];closed=false;send(e:any){this.sent.push(e)}close(){this.closed=true}input(id:string,text:string){this.emit('event',{type:'input_audio_buffer.committed',item_id:id});this.emit('event',{type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text})}}
const files:Record<string,any>={
 'report.pdf':{name:'report.pdf',format:'pdf',text:'Sentinel PDF ZQX-7731 àè€',entries:[]},
 'notes.txt':{name:'notes.txt',format:'text',text:'riga uno\r\nriga due àè€\n',entries:[]},
 'bundle.zip':{name:'bundle.zip',format:'zip',text:'',entries:[{name:'app.js',text:'console.log("ok");\n'},{name:'index.php',text:'<?php echo "hi"; ?>\n'},{name:'theme.liquid',text:'{{ product.title }}\n'},{name:'readme.txt',text:'ciao àè€\n'}]},
 'page.html':{name:'page.html',format:'text',text:'<script>alert(1)</script>',entries:[]},
};
async function fixture(){const db=await database();await migrate(db.pool);const owner=await bootstrap(db.pool),other=await bootstrap(db.pool);const root=await mkdtemp(join(tmpdir(),'nova-rev2-'));const speech=new Speech();let count=0;const queue:string[]=[];
 const app=buildApp(db.pool,{fileRoot:root,agent:{endpoint:'https://fixture.invalid',model:'controlled',voice:{connect:async()=>({sdp:'answer',transport:speech})},provider:{complete:async(messages:any)=>{const last=[...messages].reverse().find((m:any)=>m.role==='user')?.content??'';const want=Object.keys(files).find(n=>String(last).includes(n));if(want&&!messages.some((m:any)=>m.role==='tool'))return {role:'assistant',content:null,tool_calls:[{id:'call-'+(++count),type:'function',function:{name:'create_file',arguments:JSON.stringify(files[want])}}]};return {role:'assistant',content:'Done: '+want}}}}} as any);await app.ready();
 const send=(url:string,payload?:any,token=owner.token,key=randomUUID(),headers:any={})=>app.inject({url,method:payload?'POST':'GET',headers:{authorization:`Bearer ${token}`,'idempotency-key':key,...headers},payload});
 const c=(await send('/conversations',{title:'Review'})).json();return {db,app,owner,other,speech,send,c,root,close:async()=>{await app.close();await db.close();await rm(root,{recursive:true,force:true})}}}
async function wait(fn:()=>Promise<boolean>){for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10))}assert.fail('bounded wait expired')}
async function generate(f:any,name:string,seq:number){const turn=await f.send(`/conversations/${f.c.id}/turns`,{baseSequence:seq,text:'Genera '+name});assert.equal(turn.statusCode,201,turn.body);await wait(async()=>['completed','failed'].includes((await f.send('/runs/'+turn.json().id)).json().status));const run=(await f.send('/runs/'+turn.json().id)).json();assert.equal(run.status,'completed',JSON.stringify(run));const receipt=(await f.db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='create_file'",[turn.json().id])).rows[0];assert.ok(receipt,'receipt');return receipt.result}

test('generated PDF/TXT/ZIP/HTML: real bytes, owner scoped, safe headers, ZIP verified by python zipfile',async()=>{const f=await fixture();try{
 let seq=0;const results:any={};for(const name of Object.keys(files)){results[name]=await generate(f,name,seq);seq+=2}
 for(const name of Object.keys(files)){const r=results[name];assert.equal(r.executed,false);assert.equal(r.origin,'assistant_generated');assert.match(r.download,/^\/artifacts\/[0-9a-f-]{36}\/revisions\/1\/download$/);
  const res=await f.send(r.download);assert.equal(res.statusCode,200,name);assert.equal(res.headers['content-type'],'application/octet-stream');assert.equal(res.headers['content-disposition'],`attachment; filename="${name}"`);assert.equal(res.headers['x-content-type-options'],'nosniff');assert.equal(res.headers['cache-control'],'no-store');assert.match(String(res.headers['content-security-policy']),/sandbox/);
  assert.equal((await f.send(r.download,undefined,f.other.token)).statusCode,404,'foreign owner '+name);
  assert.equal((await f.app.inject({url:r.download})).statusCode,401,'anonymous '+name);}
 assert.equal((await f.send(results['notes.txt'].download)).body,files['notes.txt'].text);
 const pdf=(await f.send(results['report.pdf'].download)).rawPayload;assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>200);
 const html=(await f.send(results['page.html'].download));assert.equal(html.body,'<script>alert(1)</script>');assert.equal(html.headers['content-type'],'application/octet-stream');
 const zip=(await f.send(results['bundle.zip'].download)).rawPayload;assert.equal(zip.readUInt32LE(0),0x04034b50);
 const listing=execFileSync('python3',['-c','import sys,zipfile,io,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;print(json.dumps({i.filename:z.read(i).decode() for i in z.infolist()}))'],{input:zip}).toString();
 assert.deepEqual(JSON.parse(listing),Object.fromEntries(files['bundle.zip'].entries.map((e:any)=>[e.name,e.text])));
 // receipt persisted in same transaction as artifact: counts agree
 const n=(await f.db.pool.query("SELECT (SELECT count(*)::int FROM agent_tool_receipts WHERE tool='create_file') r,(SELECT count(*)::int FROM artifact_revisions) a")).rows[0];assert.deepEqual(n,{r:4,a:4});
 // non-file artifact revision is not downloadable
 const art=(await f.db.pool.query('SELECT id FROM artifacts LIMIT 1')).rows[0];assert.equal((await f.send(`/artifacts/${art.id}/revisions/2/download`)).statusCode,404);
}finally{await f.close()}});

test('create_file validation rejects traversal, absolute, non-source names, disguised formats, duplicates',async()=>{
 const call=(args:any)=>validateTools([{id:'x',type:'function',function:{name:'create_file',arguments:JSON.stringify(args)}}] as any);
 const bad=[{name:'../evil.js',format:'text',text:'x',entries:[]},{name:'/etc/passwd',format:'text',text:'x',entries:[]},{name:'a\\b.js',format:'text',text:'x',entries:[]},{name:'evil.exe',format:'text',text:'x',entries:[]},{name:'x.js',format:'pdf',text:'x',entries:[]},{name:'x.zip',format:'zip',text:'',entries:[{name:'..',text:'x'}]},{name:'x.zip',format:'zip',text:'',entries:[{name:'a/b.js',text:'x'}]},{name:'x.zip',format:'zip',text:'',entries:[{name:'a.js',text:'x'},{name:'A.JS',text:'y'}]},{name:'x.zip',format:'zip',text:'',entries:[]},{name:'x.zip',format:'zip',text:'',entries:[{name:'a.exe',text:'x'}]},{name:'x.js',format:'text',text:'x',entries:[{name:'a.js',text:'x'}]},{name:'x.js',format:'text',text:'x'},{name:'..js',format:'text',text:'x',entries:[]},{name:'x.js\r\nSet-Cookie: a',format:'text',text:'x',entries:[]},{name:'x.js"; filename=y',format:'text',text:'x',entries:[]}];
 for(const b of bad){let threw=false;try{call(b)}catch{threw=true}assert.ok(threw,'should reject '+JSON.stringify(b))}
 assert.equal(call({name:'ok.liquid',format:'text',text:'{{ x }}',entries:[]})[0].name,'create_file');
 for(const shell of ['execute','run_shell','bash','exec_file','python','eval']){let threw=false;try{validateTools([{id:'s',type:'function',function:{name:shell,arguments:'{}'}}] as any)}catch{threw=true}assert.ok(threw,'tool must be denied: '+shell)}
});

test('flexible uploads: recognized JS text, transparent unsupported ZIP/binary, owner isolation, read_file honesty',async()=>{const f=await fixture();try{
 const up=(name:string,mime:string,bytes:Buffer,token=f.owner.token,conv=f.c.id)=>f.send('/files/upload',{conversationId:conv,name,mime,dataBase64:bytes.toString('base64')},token);
 const js=await up('script.js','text/javascript',Buffer.from('console.log(1)\n'));assert.equal(js.statusCode,201,js.body);assert.equal(js.json().extraction.status,'extracted');assert.equal(js.json().extraction.executed,false);
 const zipBytes=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.from('../../etc/passwd'),Buffer.alloc(40)]);const zip=await up('archive.zip','application/zip',zipBytes);assert.equal(zip.statusCode,201,zip.body);assert.equal(zip.json().extraction.status,'unsupported');assert.equal(zip.json().extraction.executed,false);assert.match(zip.json().extraction.reason,/ZIP stored only/);
 const bin=await up('blob.bin','application/octet-stream',Buffer.from([0,1,2,255]));assert.equal(bin.statusCode,201);assert.equal(bin.json().extraction.status,'unsupported');
 const fakeTxt=await up('fake.txt','text/plain',Buffer.from([0xff,0xfe,0,1]));assert.equal(fakeTxt.statusCode,201);assert.equal(fakeTxt.json().extraction.status,'unsupported');
 const content=await f.send(`/files/${zip.json().id}/content`);assert.equal(content.statusCode,200);assert.ok(content.rawPayload.equals(zipBytes));assert.equal(content.headers['content-disposition'],'attachment; filename="archive.zip"');assert.equal(content.headers['x-content-type-options'],'nosniff');
 assert.equal((await f.send(`/files/${zip.json().id}/content`,undefined,f.other.token)).statusCode,404);assert.equal((await f.send(`/files/${zip.json().id}`,undefined,f.other.token)).statusCode,404);
 assert.equal((await up('x.js','text/javascript',Buffer.from('1'),f.other.token)).statusCode,404,'foreign conversation upload denied');
 assert.equal((await up('a..b.js','text/javascript',Buffer.from('1'))).statusCode,400);
 // idempotent replay: same key + same body → same id, one row
 const key=randomUUID();const a=await f.send('/files/upload',{conversationId:f.c.id,name:'dup.txt',mime:'text/plain',dataBase64:Buffer.from('dup').toString('base64')},f.owner.token,key);const b=await f.send('/files/upload',{conversationId:f.c.id,name:'dup.txt',mime:'text/plain',dataBase64:Buffer.from('dup').toString('base64')},f.owner.token,key);assert.equal(a.statusCode,201);assert.equal(b.statusCode,201);assert.equal(a.json().id,b.json().id);assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM files WHERE name='dup.txt'")).rows[0].n,1);
 // ready state visible with extraction in metadata
 const meta=await f.send(`/files/${zip.json().id}`);assert.equal(meta.json().state,'ready');assert.equal(meta.json().extraction.status,'unsupported');
}finally{await f.close()}});

test('voice sessions: owner isolation on create/stop, foreign conversation, reload marks active failed, uncommitted transcript ignored',async()=>{const f=await fixture();try{
 assert.equal((await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'synthetic-offer',language:'auto'},f.other.token)).statusCode,404,'foreign conversation');
 const s=await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'synthetic-offer',language:'it'});assert.equal(s.statusCode,201,s.body);const id=s.json().id;assert.equal(s.json().mode,'native-agent');
 assert.equal((await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'synthetic-offer',language:'it'})).statusCode,409,'second active session');
 assert.equal((await f.send('/voice/sessions/'+id+'/stop',{},f.other.token)).statusCode,404,'foreign stop');
 assert.equal((await f.db.pool.query('SELECT status FROM voice_sessions WHERE id=$1',[id])).rows[0].status,'active');
 // transcript without committed audio never persists
 f.speech.emit('event',{type:'conversation.item.input_audio_transcription.completed',item_id:'nocommit',transcript:'Genera notes.txt'});await new Promise(r=>setTimeout(r,60));assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM voice_inputs')).rows[0].n,0);assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,0);
 // duplicate provider item (replay) → single input/run/message, voice channel persisted in same conversation
 f.speech.input('item-1','Genera notes.txt');f.speech.input('item-1','Genera notes.txt');
 await wait(async()=>(await f.db.pool.query("SELECT count(*)::int n FROM agent_runs WHERE status='completed'")).rows[0].n===1);
 assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM voice_inputs')).rows[0].n,1);assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM agent_runs')).rows[0].n,1);
 const ms=(await f.send(`/conversations/${f.c.id}/messages`)).json().items;assert.deepEqual(ms.map((m:any)=>[m.role,m.channel]),[['user','voice'],['assistant','voice']]);
 const receipt=(await f.db.pool.query("SELECT result FROM agent_tool_receipts WHERE tool='create_file'")).rows[0].result;assert.equal((await f.send(receipt.download)).body,files['notes.txt'].text);assert.equal((await f.send(receipt.download,undefined,f.other.token)).statusCode,404);
 await wait(async()=>f.speech.sent.some(e=>e.type==='response.create'));const spoken=f.speech.sent.find(e=>e.type==='response.create');assert.equal(spoken.response.conversation,'none');assert.ok(JSON.stringify(spoken).includes('Done: notes.txt'));
 // DB-side revocation (expiry) while live map still holds the session: late input must not persist
 await f.db.pool.query("UPDATE voice_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 f.speech.input('item-2','Genera page.html');await wait(async()=>(await f.db.pool.query('SELECT status FROM voice_sessions WHERE id=$1',[id])).rows[0].status!=='active');
 assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM voice_inputs')).rows[0].n,1);assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM messages')).rows[0].n,2);assert.equal(f.speech.closed,true);
 const st=await f.send('/voice/sessions/'+id);assert.equal(st.statusCode,200);assert.equal(st.json().status,'failed');
 // process restart (app close → new app on same DB): stale active/connecting rows are marked failed/runtime_interrupted
 await f.app.close();await f.db.pool.query("INSERT INTO voice_sessions(id,owner_id,conversation_id,session_hash,status,expires_at) VALUES($1,$2,$3,'h','active',clock_timestamp()+interval '2 minutes')",[randomUUID(),f.owner.id??(await f.db.pool.query('SELECT owner_id FROM conversations WHERE id=$1',[f.c.id])).rows[0].owner_id,f.c.id]);
 const app2=buildApp(f.db.pool,{agent:{endpoint:'https://fixture.invalid',model:'controlled',provider:{complete:async()=>({role:'assistant',content:'x'})}}} as any);await app2.ready();
 const rows=(await f.db.pool.query("SELECT status,error_code FROM voice_sessions WHERE status IN ('active','connecting')")).rows;assert.equal(rows.length,0);assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM voice_sessions WHERE error_code='runtime_interrupted'")).rows[0].n,1);await app2.close();
}finally{await f.db.close().catch(()=>{});await rm(f.root,{recursive:true,force:true})}});

test('voice session budget and provider failure paths',async()=>{const f=await fixture();try{
 const s=await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'synthetic-offer',language:'bn'});assert.equal(s.statusCode,201);
 f.speech.emit('event',{type:'error'});await wait(async()=>(await f.db.pool.query('SELECT status FROM voice_sessions WHERE id=$1',[s.json().id])).rows[0].status==='failed');
 assert.equal((await f.db.pool.query('SELECT error_code FROM voice_sessions WHERE id=$1',[s.json().id])).rows[0].error_code,'voice_transport_error');assert.equal(f.speech.closed,true);
 const bad=await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'x',language:'it'});assert.equal(bad.statusCode,400);
 const badLang=await f.send('/voice/sessions',{conversationId:f.c.id,sdp:'synthetic-offer',language:'fr'});assert.equal(badLang.statusCode,400);
}finally{await f.close()}});
