import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobsService} from '../src/jobs.ts';
test('failed source cause survives immediate retry without spending another request',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobs-repair-'));let calls=0;const now=1800000000000;
 try{const service=new JobsService({cacheDir:dir,now:()=>now,source:async()=>{calls++;throw Error('jobs_policy_unreviewed')}});
 const first=await service.search({query:'cameriere Bologna',city:''},AbortSignal.timeout(2000));
 const second=await service.search({query:'cameriere Bologna',city:''},AbortSignal.timeout(2000));
 console.log(JSON.stringify({first,second,calls}));
 assert.equal(first.code,'jobs_policy_unreviewed');assert.equal(second.code,first.code);
 assert.equal(second.retryable,false);assert.equal(second.limitReason,'jobs_rate_limited');assert.equal(second.retryAfterSeconds,15);
 assert.equal(calls,1);assert.equal(JSON.parse(await readFile(join(dir,'budget.json'),'utf8')).count,1);
 assert.match(second.originalSearchUrl!,/^https:\/\/www\.subito\.it\//);
 }finally{await rm(dir,{recursive:true,force:true})}
});
