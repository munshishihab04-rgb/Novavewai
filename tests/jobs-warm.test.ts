import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('daily warm cache is bounded to five cities, one role; duplicate daily run does no work',async()=>{
 const m=await import('../src/jobs-warm.ts').catch(()=>null);assert.ok(m,'warm operation exists');
 const dir=await mkdtemp(join(tmpdir(),'nova-jobs-warm-'));let calls=0;
 try{const search=async()=>{calls++;return {status:'ok',jobs:[]}};
 const report=await m.warmJobs({cacheDir:dir,search,pause:async()=>{},now:()=>1_800_000_000_000});assert.equal(report.attempted,5);assert.equal(calls,5);
 const repeat=await m.warmJobs({cacheDir:dir,search,pause:async()=>{},now:()=>1_800_000_000_000});assert.equal(repeat.attempted,0);assert.equal(calls,5);
 }finally{await rm(dir,{recursive:true,force:true})}
});
