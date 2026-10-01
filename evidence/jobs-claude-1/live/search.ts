// Bounded managed-identity web search via existing src/azure-services searchWeb. Never prints tokens.
// Usage: node --import tsx search.ts <out.json> "<query>"
import {writeFile} from 'node:fs/promises';
import {searchWeb} from '../../../src/azure-services.ts';
const [out,query]=process.argv.slice(2);
const startedAt=new Date().toISOString();
try{
 const r=await searchWeb(query,AbortSignal.timeout(90000));
 await writeFile(out,JSON.stringify({query,startedAt,...r},null,1));
 console.log('OK sources',r.sources.length);for(const s of r.sources)console.log('-',s.title.slice(0,100),'|',s.url);
 console.log('TEXT:',r.text.slice(0,1500));
}catch(e){await writeFile(out,JSON.stringify({query,startedAt,error:String(e)},null,1));console.log('ERR',String(e));}
