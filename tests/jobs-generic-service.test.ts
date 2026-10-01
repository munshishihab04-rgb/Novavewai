import test from 'node:test';import assert from 'node:assert/strict';
import {GenericJobsService} from '../src/jobs-generic.ts';
import {webJobCandidates} from '../src/jobs.ts';
import {safeJobUrl} from '../src/jobs-generic.ts';
import {JobsService} from '../src/jobs.ts';
test('unsafe source search URLs never reach generic browsing receipts',()=>{for(const url of ['https://[::ffff:127.0.0.1]/x','https://[fc00::1]/x','https://localhost./x','https://machine.internal/x']){assert.equal(safeJobUrl(url),false);assert.equal(webJobCandidates({sources:[{title:'bad',url}]},'saldatore','Jesi').searchLinks?.length,0);}});
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {searchSubito} from '../src/jobs-subito.ts';
test('legacy injected source no longer crashes after nonwhitelist city normalization',async()=>{const cacheDir=await mkdtemp(join(tmpdir(),'jobs-generic-'));try{const r=await new JobsService({cacheDir,source:async()=>[]}).search({query:'saldatore',city:'Jesi'},signal());assert.equal(r.status,'ok');assert.match(r.originalSearchUrl!,/annunci-italia/);}finally{await rm(cacheDir,{recursive:true,force:true})}});
const signal=()=>new AbortController().signal;
test('a legacy policy reference cannot authorize Subito automation',async()=>{
 const previous=process.env.NOVA_JOBS_SUBITO_POLICY_REFERENCE;process.env.NOVA_JOBS_SUBITO_POLICY_REFERENCE='review-is-not-permission';
 try{await assert.rejects(()=>searchSubito('saldatore','Jesi',signal()),/jobs_automated_access_not_authorized/);}finally{if(previous===undefined)delete process.env.NOVA_JOBS_SUBITO_POLICY_REFERENCE;else process.env.NOVA_JOBS_SUBITO_POLICY_REFERENCE=previous;}
});
test('generic default gates automation and returns named original-source searches, not vacancies',async()=>{
 const s=new GenericJobsService();
 for(const [query,city] of [['programmatore','Imola'],['saldatore','Jesi'],['magazziniere','Faenza'],['badante','Cuneo'],['customer care remoto','']]){
  const r=await s.search({query,city},signal());assert.equal(r.status,'search_links_only');assert.equal(r.opportunities,undefined);assert.equal(r.requestedCity,city);assert.equal(r.sourceUnavailable?.code,'jobs_automated_access_not_authorized');assert.ok(r.searchLinks?.every(l=>l.kind==='BROWSING_SUGGESTION'));assert.match(r.searchLinks![0].title,/Subito.*ricerca nazionale/);assert.equal(new URL(r.searchLinks![0].url).searchParams.get('q'),`${r.occupation} ${city||'remoto'}`);
  const first:any=r.searchLinks![0];assert.equal(first.publisher_type,'UNKNOWN');assert.equal(first.pageKind,'SEARCH');assert.equal(first.sourceName,'Subito');assert.equal(first.requestedProvince,null);
 }
 assert.equal((await s.search({query:'saldatore',city:''},signal())).status,'needs_city');
 assert.equal((await s.search({query:'customer care non remoto',city:''},signal())).status,'needs_city');
 for(const query of ['programmatore site:evil.test','saldatore&url=http://localhost','https://evil.test','saldatore\nOR segreti'])assert.equal((await s.search({query,city:'Imola'},signal())).status,'needs_occupation');
 assert.equal((await s.search({query:'saldatore',city:'http://127.0.0.1'},signal())).status,'needs_city');
 await assert.rejects(()=>s.search({query:'saldatore',city:'Jesi'},AbortSignal.abort()));
});
test('permitted imports are dated observations, unknown publisher allowed, never relabelled live or city',async()=>{
 const row={occupation:'saldatore',title:'Saldatore TIG',city:'Jesi',province:'AN',url:'https://example.org/offerta/1',sourceName:'Fonte autorizzata',collectedAt:'2024-01-01T10:00:00Z',permission:'permitted_import' as const};
 const s=new GenericJobsService({records:[row,{...row}, {...row,city:'Ancona',url:'https://example.org/offerta/2'},{...row,url:'http://localhost/x'}]});
 const r=await s.search({query:'saldatore',city:'Jesi'},signal());assert.equal(r.status,'collected_results');assert.equal(r.opportunities?.length,1);const o:any=r.opportunities![0];assert.equal(o.publisher_type,'UNKNOWN');assert.equal(o.province,'AN');assert.equal(o.discovered_at,row.collectedAt);assert.equal(o.last_verified_at,null);assert.equal(o.status,'UNKNOWN');assert.equal(r.cache,undefined);
 const strict=await s.search({query:'saldatore senza agenzie',city:'Jesi'},signal());assert.equal(strict.opportunities?.length??0,0);assert.equal(strict.constraintStatus,'unmet');
});
