// Live replay of the production adapter path with the exact production discovery query.
// One searchWeb call (4/4) + verifiedJobPages against real registry pages. No token printed.
import {writeFile} from 'node:fs/promises';
import {searchWeb} from '../../../src/azure-services.ts';
import {discoveryQuery,verifiedJobPages} from '../../../src/jobs-live.ts';
const q={occupation:'cameriere',city:'Bologna',noAgencies:false};
const query=discoveryQuery(q.occupation,q.city);
const startedAt=new Date().toISOString();
let web:any;try{web=await searchWeb(query,AbortSignal.timeout(90000));}catch(e){web={error:String(e),sources:[]}}
console.log('search sources',web.sources.length);for(const s of web.sources)console.log('-',s.title.slice(0,90),'|',s.url);
// Also replay the two specific leads already discovered this session so the adapter's verdict on them is recorded.
const known=[{title:'Cameriere/a di sala - LavoroTurismo',url:'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-smy-hotels'},{title:'Cameriere di sala | Bologna | HNH',url:'https://job.hnh.it/jobs/Cameriere-di-sala-full-time-o-part-time-Sala-Italia-Bologna-558045909.htm'}];
const leads=[...web.sources,...known.filter(k=>!web.sources.some((s:any)=>s.url===k.url))];
const verified=await verifiedJobPages(leads,q,AbortSignal.timeout(60000));
console.log(JSON.stringify({opportunities:verified.opportunities,unavailable:verified.unavailable,skipped:verified.skipped,scope:verified.testedScope},null,1));
await writeFile(process.argv[2],JSON.stringify({query,startedAt,search:{text:web.text,sources:web.sources,checkedAt:web.checkedAt,error:web.error},leads,verified},null,1));
