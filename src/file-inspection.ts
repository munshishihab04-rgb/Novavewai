import {extractPdf} from './documents.ts';
import {extractOffice} from './office.ts';
// Archive transport is allowed; archives are NEVER decompressed or executed.
// This makes ZIP traversal, nesting and decompression bombs inert, not understood.
export async function inspectUpload(name:string,bytes:Buffer):Promise<any>{
 const base={executed:false};
 if(bytes.subarray(0,5).toString()==='%PDF-'){
  try{const pdf=await extractPdf(bytes);return {...base,status:'extracted',detectedType:'application/pdf',method:pdf.method,text:pdf.text,coverage:pdf.coverage,pages:pdf.pages}}catch{return {...base,status:'unsupported',detectedType:'application/pdf',reason:'Text-layer PDF extraction failed or exceeded 30 pages / 15.5 KB text; no OCR, encrypted PDF or universal understanding.'}}
 }
 if(/\.(docx|xlsx)$/i.test(name)&&bytes.subarray(0,2).toString()==='PK')return extractOffice(name,bytes);
 if(/\.(txt|md|csv|json|js|mjs|cjs|ts|tsx|jsx|php|liquid|html|css|py|sql|xml|yaml|yml|sh|rb|java|c|cpp|h|go|rs|svg)$/i.test(name)){
  if(bytes.length>16384)return {...base,status:'unsupported',reason:'Text extraction limited to 16 KiB; original bytes retained.'};
  try{const text=new TextDecoder('utf8',{fatal:true}).decode(bytes);if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error();return {...base,status:'extracted',method:'utf8',detectedType:'text/plain',text,coverage:'all-bytes'}}catch{return {...base,status:'unsupported',reason:'Not supported UTF-8 text; original bytes retained.'}}
 }
 return {...base,status:'unsupported',reason:/\.zip$/i.test(name)?'ZIP stored only. No archive extraction, execution or member inspection.':'Binary stored only; extraction is not supported for this format.'};
}
export function extractionText(file:any,bytes:Buffer){if(file.extraction?.status!=='extracted')return undefined;return file.extraction.text??bytes.toString('utf8')}
