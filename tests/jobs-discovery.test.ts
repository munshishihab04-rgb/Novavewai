import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {JobsService} from '../src/jobs.ts';

test('portal vacancy carries evidence, UNKNOWN publisher and no-agencies excludes unknown even on cache hit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-jobs-'));
 try{const service=new JobsService({cacheDir:dir,source:async()=>[{title:'Lavapiatti',city:'Milano',source:'Subito',url:'https://www.subito.it/offerte-lavoro/lavapiatti-123.htm'}]});
 const result=await service.search({query:'lavapiatti',city:'Milano'},new AbortController().signal);
 assert.equal(result.opportunities?.[0].opportunity_kind,'VACANCY');assert.equal(result.opportunities?.[0].source_type,'JOB_BOARD');assert.equal(result.opportunities?.[0].publisher_type,'UNKNOWN');assert.equal(result.opportunities?.[0].verification_status,'UNVERIFIED');assert.equal(result.opportunities?.[0].evidence[0].observed_at,result.fetchedAt);
 const strict=await service.search({query:'lavapiatti senza agenzie',city:'Milano'},new AbortController().signal);assert.equal(strict.cache,'hit');assert.deepEqual(strict.jobs,[]);assert.deepEqual(strict.opportunities,[]);assert.equal(strict.excludedUnknown,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
