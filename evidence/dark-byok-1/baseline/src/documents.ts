import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let active=0;
async function worker(mode:string,input:Buffer):Promise<Buffer>{
 if(active>=2)throw Error('document_busy');active++;
 try{return await new Promise((resolve,reject)=>{
 const root=fileURLToPath(new URL('../',import.meta.url));const child=spawn(root+'.venv-docs/bin/python',['-I',root+'scripts/document-worker.py',mode],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
 let size=0;const chunks:Buffer[]=[];const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>5*1024*1024)child.kill('SIGKILL');else chunks.push(b)});child.stderr.resume();child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('document_processing_failed'));else resolve(Buffer.concat(chunks))});child.stdin.on('error',()=>{});child.stdin.end(input);
 })}finally{active--}
}
export async function extractPdf(bytes:Buffer):Promise<{text:string,pages:number,method:string,coverage:string}>{if(bytes.length>4*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('invalid_pdf');return JSON.parse((await worker('extract',bytes)).toString())}
export async function renderPdf(title:string,text:string,template:string){if(!['classic','modern'].includes(template)||text.length>20000||title.length>300)throw Error('invalid_document');return worker('render',Buffer.from(JSON.stringify({title,text,template})))}
