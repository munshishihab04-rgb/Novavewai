import test from 'node:test';import assert from 'node:assert/strict';import {validateTools} from '../src/agent-tools.ts';import * as files from '../src/generated-files.ts';import {extractPdf} from '../src/documents.ts';import {execFileSync} from 'node:child_process';
const args=(format:string,name:string,text='',entries:any[]=[])=>({format,name,text,entries});
test('generated PDF signature/extraction and ZIP independent unzip retain exact source bytes',async()=>{
 const pdf=args('pdf','readme.pdf','Verifiable PDF body');assert.match((files as any).generatedFileSchema.properties.entries.description,/empty.*text.*pdf/i);validateTools([{id:'pdf',type:'function',function:{name:'create_file',arguments:JSON.stringify(pdf)}}]);
 const render=(files as any).renderGeneratedFile;assert.equal(typeof render,'function');const b=await render(pdf);assert.equal(b.subarray(0,5).toString(),'%PDF-');assert.match((await extractPdf(b)).text,/Verifiable PDF body/);
 const entries=[{name:'index.js',text:'console.log("বাংলা");\n'},{name:'theme.liquid',text:'{{ product.title | escape }}\n'},{name:'readme.txt',text:'Exact\r\ntext\n'}];const z=await render(args('zip','project.zip','',entries));assert.equal(z.readUInt32LE(0),0x04034b50);
 const read=execFileSync('python3',['-c','import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps([{ "name":n,"text":z.read(n).decode()} for n in z.namelist()]))'],{input:z});assert.deepEqual(JSON.parse(read.toString()),entries);
});
test('generated archives reject traversal, duplicate names, wrong format and byte overflow before tool execution',()=>{
 for(const a of [args('zip','x.zip','',[{name:'../x',text:'bad'}]),args('zip','x.zip','',[{name:'a.txt',text:'a'},{name:'a.txt',text:'b'}]),args('text','x.pdf','not PDF'),args('zip','x.zip','',[{name:'a.txt',text:'é'.repeat(20000)}])])assert.throws(()=>validateTools([{id:'bad',type:'function',function:{name:'create_file',arguments:JSON.stringify(a)}}]));
});
