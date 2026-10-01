// Live adapter replay WITHOUT search (budget 4/4 used): real registry pages only.
import {writeFile} from 'node:fs/promises';
import {verifiedJobPages} from '../../../src/jobs-live.ts';
const q={occupation:'cameriere',city:'Bologna',noAgencies:false};
const leads=[
 {title:'Cameriere/a di sala - LavoroTurismo',url:'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-smy-hotels'},
 {title:'Cameriere di sala | Bologna | HNH',url:'https://job.hnh.it/jobs/Cameriere-di-sala-full-time-o-part-time-Sala-Italia-Bologna-558045909.htm'},
 {title:'Aiuto cuoco Bologna CRASHIT',url:'https://www.restworld.it/posizione/offerta-di-lavoro-aiuto-cuoco-bologna-krf'},
 {title:'Lavapiatti Monte San Pietro',url:'https://www.restworld.it/posizione/offerta-di-lavoro-lavapiatti-monte_san_pietro-ldu'},
];
const verified=await verifiedJobPages(leads,q,AbortSignal.timeout(60000));
console.log(JSON.stringify({opportunities:verified.opportunities,unavailable:verified.unavailable,skipped:verified.skipped},null,1));
await writeFile(process.argv[2],JSON.stringify({startedAt:new Date().toISOString(),leads,verified,note:'no searchWeb call; budget already 4/4'},null,1));
