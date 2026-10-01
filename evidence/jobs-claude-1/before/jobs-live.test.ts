import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedJobPages,resolveCurrentJobRequest} from '../src/jobs-live.ts';

test('allowlisted live adapter returns only current listing body evidence',async()=>{
 const fetched:string[]=[];const pages:any={
  'https://www.adecco.com/it-it/cerca-lavoro/camerierea-bologna-bologna/id':`<html><title>Cameriere/a | Bologna</title><body><h1>Cameriere/a</h1><p>Bologna, Bologna</p><p>Job offer expired</p></body></html>`,
  'https://www.lavoropiu.it/offerta/cameriere-a-colazioni-hotel-107229':`<html><title>Cameriere/a Colazioni - Hotel | Lavoropiù</title><body><h1>Cameriere/a Colazioni - Hotel</h1><p>Bologna</p><p>Lavoropiù S.p.a. Agenzia per il lavoro</p></body></html>`};
 const fetcher=async(input:any)=>{const u=String(input);fetched.push(u);return new Response(pages[u],{status:200,headers:{'content-type':'text/html'}})};
 const r=await verifiedJobPages([{title:'lead',url:Object.keys(pages)[0]},{title:'lead',url:Object.keys(pages)[1]},{title:'evil',url:'https://example.org/job'}],{occupation:'cameriere',city:'Bologna',noAgencies:false},AbortSignal.timeout(1000),fetcher as any);
 assert.equal(fetched.length,2);assert.equal(r.opportunities.length,1);assert.equal(r.opportunities[0].publisher_type,'STAFFING_AGENCY');assert.equal(r.unavailable[0].status,'EXPIRED');assert.match(r.opportunities[0].evidence[0].claim,/Cameriere\/a Colazioni.*Bologna/);
});
test('current explicit city wins and unsupported correction never falls back',()=>{
 assert.deepEqual(resolveCurrentJobRequest(['cameriere Bologna','Ora a Milano invece di Bologna'],{query:'cameriere',city:'Bologna'}),{query:'cameriere',city:'Milano',noAgencies:false});
 assert.equal(resolveCurrentJobRequest(['cameriere Bologna','Ora a Parma'],{query:'cameriere',city:'Bologna'}).city,'Parma');
 assert.equal(resolveCurrentJobRequest(['cameriere Bologna senza agenzie','ora anche agenzie'],{query:'cameriere',city:'Bologna'}).noAgencies,false);
});
