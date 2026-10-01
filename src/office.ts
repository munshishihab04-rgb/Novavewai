// DOCX / XLSX / CSV support. Rendering and extraction run in the sandboxed python worker (python-docx, openpyxl);
// the CSV codec lives here so the UI table editor and the server share one definition (RFC 4180, CRLF out).
import {renderWorker} from './documents.ts';
export const OFFICE_LIMITS={rows:2000,cols:64,cell:1000,text:20000} as const;
export function parseCsv(text:string):string[][]{
 const sample=text.slice(0,4096);const delim=(sample.split(';').length-1)>(sample.split(',').length-1)?';':',';
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,i=0;
 while(i<text.length){const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i+=2;continue}quoted=false;i++;continue}field+=ch;i++;continue}
  if(ch==='"'){quoted=true;i++;continue}
  if(ch===delim){row.push(field);field='';i++;continue}
  if(ch==='\r'){i++;continue}
  if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';i++;continue}
  field+=ch;i++;
 }
 if(field.length||row.length)row.push(field),rows.push(row);
 return rows;
}
const cell=(v:string)=>/[",\r\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
export const toCsv=(rows:string[][])=>rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
function checkText(text:string){if(Buffer.byteLength(text)>OFFICE_LIMITS.text)throw Error('text_too_large')}
export async function renderXlsx(name:string,text:string):Promise<Buffer>{checkText(text);if(!/\.xlsx$/i.test(name))throw Error('invalid_name');return renderWorker('render-xlsx',Buffer.from(JSON.stringify({text,sheet:name.replace(/\.xlsx$/i,'').slice(0,31)})))}
export async function renderDocx(name:string,text:string):Promise<Buffer>{checkText(text);if(!/\.docx$/i.test(name))throw Error('invalid_name');return renderWorker('render-docx',Buffer.from(JSON.stringify({text})))}
export interface OfficeExtraction{status:'extracted'|'unsupported';executed:false;method?:string;text?:string;detectedType?:string;coverage?:string;sheets?:string[];reason?:string}
export async function extractOffice(name:string,bytes:Buffer):Promise<OfficeExtraction>{
 const base={executed:false as const};
 if(bytes.length>4*1024*1024||bytes.subarray(0,2).toString()!=='PK')return {...base,status:'unsupported',reason:'Not an Office (OOXML) file or over 4 MB; original bytes retained.'};
 try{const out=JSON.parse((await renderWorker('extract-office',bytes,[name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,100)])).toString());return {...base,status:'extracted',...out}}
 catch(e:any){return {...base,status:'unsupported',detectedType:/\.xlsx$/i.test(name)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':/\.docx$/i.test(name)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':undefined,reason:`Office extraction failed (${e?.message??'error'}); original bytes retained. No macros, no formulas evaluated.`}}
}
