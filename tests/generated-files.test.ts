import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from './helpers.ts';
import {bootstrap,buildApp,migrate} from '../src/app.ts';

const tool=(name:string,args:any)=>({role:'assistant' as const,content:null,tool_calls:[{id:randomUUID(),type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]});
test('native generated file tool commits revision and owner-scoped exact code download',async()=>{
 const db=await database();await migrate(db.pool);const owner=await bootstrap(db.pool),other=await bootstrap(db.pool);let calls=0;
 const code='<?php\n// বাংলা\necho "<script>alert(1)</script>";\n';
 const app=buildApp(db.pool,{agent:{endpoint:'https://fixture.invalid',model:'controlled',provider:{complete:async()=>++calls===1?tool('create_file',{name:'index.php',format:'text',text:code,entries:[]}):{role:'assistant',content:'File saved.'}}}});
 await app.ready();const send=(url:string,payload?:any,token=owner.token,key=randomUUID())=>app.inject({url,method:payload?'POST':'GET',headers:{authorization:`Bearer ${token}`,'idempotency-key':key},payload});
 try{const c=(await send('/conversations',{title:'Files'})).json();const t=await send(`/conversations/${c.id}/turns`,{text:'Create PHP source, do not execute it.',baseSequence:0});assert.equal(t.statusCode,201,t.body);
 let run:any;for(let i=0;i<200;i++){run=(await send('/runs/'+t.json().id)).json();if(!['queued','running'].includes(run.status))break;await new Promise(r=>setTimeout(r,10));}assert.equal(run.status,'completed',JSON.stringify(run));
 const receipt=(await db.pool.query("SELECT result FROM agent_tool_receipts WHERE tool='create_file'")).rows[0].result;assert.ok(receipt.download);assert.equal(receipt.executed,false);
 const downloaded=await send(receipt.download);assert.equal(downloaded.statusCode,200,downloaded.body);assert.equal(downloaded.rawPayload.toString(),code);assert.match(String(downloaded.headers['content-disposition']),/attachment; filename="index.php"/);assert.equal(downloaded.headers['x-content-type-options'],'nosniff');assert.equal(downloaded.headers['content-type'],'application/octet-stream');assert.equal((await send(receipt.download,undefined,other.token)).statusCode,404);
 const update=await send(`/artifacts/${receipt.id}/revisions`,{baseRevision:1,content:{text:'<?php echo "corrected";\n',language:'en'}});assert.equal(update.statusCode,201);assert.equal((await send(`/artifacts/${receipt.id}/revisions/2/download`)).body,'<?php echo "corrected";\n');
 const tooLarge=await send(`/artifacts/${receipt.id}/revisions`,{baseRevision:2,content:{text:'é'.repeat(15000),language:'en'}});assert.equal(tooLarge.statusCode,400);assert.equal((await send(`/artifacts/${receipt.id}/revisions/3/download`)).statusCode,404);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM artifacts')).rows[0].n,1);
 }finally{await app.close();await db.close()}
});
