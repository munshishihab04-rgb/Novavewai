import test from 'node:test';import assert from 'node:assert/strict';
import type {Opportunity} from '../src/jobs-discovery.ts';
const fixture=(kind:Opportunity['opportunity_kind'],url:string):Opportunity=>({opportunity_kind:kind,title:'TEST FIXTURE restaurant',city:'Milano',source_url:url,source_type:'UNKNOWN',publisher_type:'UNKNOWN',verification_status:'UNVERIFIED',discovered_at:'2026-09-26T00:00:00Z',last_verified_at:null,status:'UNKNOWN',evidence:[{url,observed_at:'2026-09-26T00:00:00Z',claim:'fixture candidate, not hiring evidence'}]});
test('progressive discovery runs search before companies and browser, preserves kinds and exact-URL dedupe',async()=>{
 const m=await import('../src/jobs-discovery.ts');assert.equal(typeof m.discoverProgressively,'function');let stages:string[]=[];
 const result=await m.discoverProgressively({occupation:'lavapiatti',city:'Milano',noAgencies:false},{search:async()=>{stages.push('search');return []},companies:async()=>{stages.push('companies');return [fixture('COMPATIBLE_COMPANY','https://example.org/')]},verify:async(rows)=>{stages.push('verify');return rows},browser:async()=>{stages.push('browser');return [fixture('VACANCY','https://example.org/jobs/1'),fixture('VACANCY','https://example.org/jobs/1')]}},new AbortController().signal);
 assert.deepEqual(stages,['search','companies','verify','browser']);assert.equal(result.opportunities.length,2);assert.equal(result.opportunities[0].opportunity_kind,'COMPATIBLE_COMPANY');assert.equal(result.opportunities[0].verification_status,'UNVERIFIED');
});
test('sufficient search avoids expensive stages; missing city starts nothing; strict mode excludes unknown',async()=>{
 const m=await import('../src/jobs-discovery.ts');assert.equal(typeof m.discoverProgressively,'function');let searches=0,browsers=0;
 const providers={search:async()=>{searches++;return Array.from({length:3},(_,i)=>fixture('VACANCY',`https://example.org/jobs/${i}`))},browser:async()=>{browsers++;return []}};
 const result=await m.discoverProgressively({occupation:'cuoco',city:'Milano',noAgencies:false},providers,new AbortController().signal);assert.equal(result.opportunities.length,3);assert.equal(browsers,0);
 await assert.rejects(()=>m.discoverProgressively({occupation:'cuoco',city:'',noAgencies:false},providers,new AbortController().signal),/jobs_city_required/);assert.equal(searches,1);
 const strict=await m.discoverProgressively({occupation:'cuoco',city:'Milano',noAgencies:true},providers,new AbortController().signal);assert.equal(strict.opportunities.length,0);assert.equal(strict.excludedUnknown,3);
});
