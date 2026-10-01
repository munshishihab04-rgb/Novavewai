import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedJobPages,discoveryQuery} from '../src/jobs-live.ts';
const url='https://job.hnh.it/jobs/saldatore-Jesi-123.htm';
test('generic page path requires explicit authorized origin and never expires by age alone',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('<h1>Saldatore</h1><p>Luogo di lavoro Jesi, Italia</p><p>Pubblicato il 01/01/2024</p>')};
 const query={occupation:'saldatore',city:'Jesi',noAgencies:false,generic:true};
 let r=await verifiedJobPages([{title:'lead',url}],query,AbortSignal.timeout(1000),fetcher as any,{authorizedOrigins:[]});assert.equal(calls,0);assert.equal(r.opportunities.length,0);assert.match(r.unavailable[0].reason,/authoriz/i);
 r=await verifiedJobPages([{title:'lead',url},{title:'duplicate',url}],query,AbortSignal.timeout(1000),fetcher as any,{authorizedOrigins:['https://job.hnh.it']});assert.equal(calls,1);assert.equal(r.opportunities.length,1);assert.equal(r.opportunities[0].verification_status,'PARTIALLY_VERIFIED');assert.equal(r.opportunities[0].publishedAt,'2024-01-01');
});
test('generic role evidence is in listing title, sala is not ai piani, footer is not city evidence',async()=>{
 const query={occupation:'cameriere',city:'Jesi',noAgencies:false,generic:true};const policy={authorizedOrigins:['https://job.hnh.it']};
 for(const html of ['<h1>Cameriere ai piani</h1>Luogo di lavoro Jesi, Italia Cameriere di sala','<h1>Cameriere di sala</h1><footer>Jesi</footer>']){
  const r=await verifiedJobPages([{title:'lead',url}],query,AbortSignal.timeout(1000),async()=>new Response(html),policy);assert.equal(r.opportunities.length,0);
 }
 assert.doesNotMatch(discoveryQuery('saldatore','Jesi'),/lavoroturismo|restworld|jobintourism/);
});
