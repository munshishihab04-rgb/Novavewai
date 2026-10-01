import {renderPdf} from './documents.ts';
import {renderDocx,renderXlsx} from './office.ts';
import {createHash} from 'node:crypto';
import type {PoolClient,Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import type {Runtime} from './runtime.ts';
import {authenticatedOwner,closed,fail,uuid} from './app.ts';
import {createArtifact} from './artifacts.ts';

export const fileName={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'};
export const GENERATED_FORMATS=['text','pdf','zip','docx','xlsx'] as const;
// docx: text uses the same # / ## / - markup as pdf. xlsx: text is CSV (comma or semicolon; first row = header; no formulas).
export const generatedFileSchema=closed({name:fileName,format:{type:'string',enum:[...GENERATED_FORMATS]},text:{type:'string',maxLength:20000},entries:{type:'array',description:'Must be an empty array [] for text, pdf, docx or xlsx. Only zip uses entries (1-20 flat source filenames, combined UTF-8 at most 20000 bytes); for zip top-level text must be empty.',maxItems:20,items:closed({name:fileName,text:{type:'string',maxLength:20000}})}});
export const MIME:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',zip:'application/zip'};
// Source/code text stays application/octet-stream (inert download); plain data formats and documents get their real MIME.
export const textMime=(name:string)=>/\.csv$/i.test(name)?'text/csv; charset=utf-8':/\.json$/i.test(name)?'application/json; charset=utf-8':/\.(md|txt)$/i.test(name)?'text/plain; charset=utf-8':'application/octet-stream';
export function validateGeneratedFile(args:any){
 const safe=(name:string)=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)&&!name.includes('..');
 const extensions=/\.(txt|md|csv|json|js|mjs|cjs|ts|tsx|jsx|php|liquid|html|css|py|sql|xml|yaml|yml|sh|rb|java|c|cpp|h|go|rs|svg)$/i;
 if(!safe(args.name)||!(GENERATED_FORMATS as readonly string[]).includes(args.format)||Buffer.byteLength(args.text)>20000||!Array.isArray(args.entries)||args.entries.length>20)fail(400,'invalid_generated_file');
 if(args.format==='text'&&!extensions.test(args.name)||args.format!=='text'&&!args.name.endsWith('.'+args.format))fail(400,'invalid_generated_file');
 if(args.format==='zip'){
  if(args.text||!args.entries.length||new Set(args.entries.map((x:any)=>x.name.toLowerCase())).size!==args.entries.length)fail(400,'invalid_generated_file');
  let bytes=0;for(const e of args.entries){if(!safe(e.name)||!extensions.test(e.name)||typeof e.text!=='string')fail(400,'invalid_generated_file');bytes+=Buffer.byteLength(e.text);}if(bytes>20000)fail(413,'generated_file_too_large');
 }else if(args.entries.length)fail(400,'invalid_generated_file');
}
// Stored ZIP: bounded source-only entries, no filesystem extraction or execution.
function crc32(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export async function renderGeneratedFile(file:any):Promise<Buffer>{
 validateGeneratedFile(file);if(file.format==='text')return Buffer.from(file.text);
 if(file.format==='pdf')return renderPdf(file.name,file.text,'classic');
 if(file.format==='docx')return renderDocx(file.name,file.text);
 if(file.format==='xlsx')return renderXlsx(file.name,file.text);
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const entry of file.entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.text),crc=crc32(data),h=Buffer.alloc(30),d=Buffer.alloc(46);
 h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
 d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt32LE(crc,16);d.writeUInt32LE(data.length,20);d.writeUInt32LE(data.length,24);d.writeUInt16LE(name.length,28);d.writeUInt32LE(offset,42);
 local.push(h,name,data);central.push(d,name);offset+=h.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(file.entries.length,8);end.writeUInt16LE(file.entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
function storedPdf(content:any){
 const bytes=Buffer.from(content.pdf_base64,'base64');
 if(bytes.length>5*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==content.sha256)fail(409,'file_integrity_failure');
 return bytes;
}
export async function createGeneratedFile(c:PoolClient,owner:string,taskId:string,args:any){
 validateGeneratedFile(args);
 const result=await createArtifact(c,owner,{taskId,title:args.name,content:{text:args.text,language:'en',file:{name:args.name,format:args.format,entries:args.entries}}});
 return {id:result.id,revision:result.revision,hash:result.hash,name:args.name,download:`/artifacts/${result.id}/revisions/${result.revision}/download`,origin:'assistant_generated',executed:false};
}
export function generatedFileRoutes(app:FastifyInstance,pool:Pool,runtime:Runtime){
 app.get('/artifacts/:id/revisions/:revision/download',{schema:{params:closed({id:uuid,revision:{type:'string',pattern:'^[1-9][0-9]{0,8}$'}})}},async(r,reply)=>{
  const row=await runtime.transaction(async c=>{const owner=await authenticatedOwner(c,r),p=r.params as any;return (await c.query('SELECT content FROM artifact_revisions WHERE owner_id=$1 AND artifact_id=$2 AND revision=$3',[owner,p.id,Number(p.revision)])).rows[0]??fail(404,'not_found')});
  if(!row.content.file)fail(404,'not_found');const file={...row.content.file,text:row.content.text};validateGeneratedFile(file);
  // CV exports are stored bytes bound to an exact CV revision: serve them verbatim after an integrity check, never re-render.
  let bytes:Buffer;try{bytes=file.cv_export&&typeof row.content.pdf_base64==='string'?storedPdf(row.content):await renderGeneratedFile(file);}catch(e:any){if(e instanceof Error&&!(e as any).status)fail(422,/^[a-z_]{1,60}$/.test(e.message)?e.message:'document_processing_failed');throw e}
  await runtime.transaction(c=>authenticatedOwner(c,r));
  // Real MIME for document formats so phones open them in the right app; text stays inert (no HTML rendering).
  return reply.type(MIME[file.format]??textMime(file.name)).header('content-disposition',`attachment; filename="${file.name}"`).header('x-content-type-options','nosniff').header('content-security-policy',"sandbox; default-src 'none'").header('cache-control','no-store').send(bytes);
 });
}
