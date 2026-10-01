// Positive-path live proof on a real current Restworld listing for a DIFFERENT role (aiuto cuoco Bologna).
// This is NOT a cameriere result; it shows the adapter accepts a genuine current listing when role+city match.
import {writeFile} from 'node:fs/promises';
import {verifiedJobPages} from '../../../src/jobs-live.ts';
const v=await verifiedJobPages([{title:'Aiuto cuoco Bologna',url:'https://www.restworld.it/posizione/offerta-di-lavoro-aiuto-cuoco-bologna-krf'}],{occupation:'cuoco',city:'Bologna',noAgencies:false},AbortSignal.timeout(30000));
console.log(JSON.stringify(v,null,1));await writeFile(process.argv[2],JSON.stringify({startedAt:new Date().toISOString(),role:'cuoco (control, not cameriere)',v},null,1));
