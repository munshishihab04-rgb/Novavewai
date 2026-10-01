import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTools } from '../src/agent-tools.ts';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobsService,compactJobs} from '../src/jobs.ts';

test('native jobs_search accepts intent and an empty city, not arbitrary browser options', () => {
  const call = (args:unknown) => [{id:'jobs1',type:'function' as const,function:{name:'jobs_search',arguments:JSON.stringify(args)}}];
  assert.equal(validateTools(call({query:'sono bravo a cucinare',city:''}))[0].name,'jobs_search');
  assert.throws(() => validateTools(call({query:'cuoco',city:'Bologna',url:'http://localhost/'})));
});

test('missing city asks before any source or cache access and cooking infers cuoco', async () => {
  const module = await import('../src/jobs.ts').catch(() => null);
  assert.ok(module, 'jobs service must exist');
  let calls=0;
  const service = new module.JobsService({cacheDir:'/not-used', source:async()=>{calls++;return []}});
  const result = await service.search({query:'sono bravo a cucinare',city:''}, new AbortController().signal);
  assert.equal(result.status,'needs_city');
  assert.equal(result.occupation,'cuoco');
  assert.equal(calls,0);
});

test('natural role/city search shares only canonical metadata with TTL across service instances',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-jobs-'));let calls=0;let now=1_800_000_000_000;
 const source=async(role:string,city:string)=>{calls++;assert.equal(role,'cameriere');assert.equal(city,'Bologna');return [{title:'Cameriere',city:'Bologna',source:'Subito' as const,url:'https://www.subito.it/offerte-lavoro/cameriere-123456789.htm',phone:'3331234567',description:'private full text',image:'photo'}]};
 try{
  const options={cacheDir:dir,source,now:()=>now,minIntervalMs:0,ttlMs:1000};
  const first=await new JobsService(options).search({query:'mi chiamo PRIVATE e cerco cameriere Bologna',city:''},new AbortController().signal);
  assert.equal(first.status,'ok');assert.equal(first.cache,'live');assert.equal(first.jobs?.length,1);
  const second=await new JobsService(options).search({query:'cameriere',city:'bologna'},new AbortController().signal);
  assert.equal(second.cache,'hit');assert.equal(calls,1);assert.equal(second.fetchedAt,first.fetchedAt);
  const raw=await readFile(join(dir,(await readdir(dir)).find(p=>p.endsWith('.json'))!),'utf8');
  for(const secret of ['PRIVATE','3331234567','description','photo'])assert.ok(!raw.includes(secret));
  now+=1001;assert.equal((await new JobsService(options).search({query:'cameriere',city:'Bologna'},new AbortController().signal)).cache,'live');assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('live searches have one shared lock, fail fast on overlap and rate limit across instances',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-jobs-'));let release!:()=>void;const gate=new Promise<void>(r=>release=r);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const source=async()=>{entered();await gate;return []};const options={cacheDir:dir,source,minIntervalMs:60000};
 try{const first=new JobsService(options).search({query:'cuoco',city:'Bologna'},new AbortController().signal);await started;
 const busy=await Promise.race([new JobsService(options).search({query:'cuoco',city:'Milano'},new AbortController().signal),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('overlap did not fail fast')),500))]);assert.equal(busy.code,'jobs_busy');
 release();await first;
 const limited=await new JobsService(options).search({query:'cuoco',city:'Milano'},new AbortController().signal);assert.equal(limited.code,'jobs_rate_limited');
 }finally{release();await rm(dir,{recursive:true,force:true})}
});

test('source failure is explicit, never stale/simulated data; privacy and origin filter are strict',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-jobs-'));
 try{const s=new JobsService({cacheDir:dir,source:async()=>{throw Error('jobs_access_blocked')}});
 const result=await s.search({query:'cuoco',city:'Roma'},new AbortController().signal);
 assert.equal(result.code,'jobs_access_blocked');assert.equal(result.jobs,undefined);
 const rows=compactJobs([{title:'Chiama 333 1234567 user@example.com',url:'https://www.subito.it/offerte-lavoro/cuoco-123.htm',compensation:'1500 €',phone:'x'}, {title:'evil',url:'https://www.subito.it.evil/offerte-lavoro/x-123.htm'}],'Roma');
 assert.equal(rows.length,1);assert.ok(!rows[0].title.includes('333'));assert.equal(rows[0].compensation,'1500 €');assert.equal((rows[0] as any).phone,undefined);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('ambiguous cities do not start a search and invalid budgets fail at construction',async()=>{
 let calls=0;const service=new JobsService({cacheDir:'/not-used',source:async()=>{calls++;return []}});
 const result=await service.search({query:'cuoco Bologna o Milano',city:''},new AbortController().signal);assert.equal(result.status,'needs_city');assert.equal(calls,0);
 assert.throws(()=>new JobsService({cacheDir:'/not-used',source:async()=>[],ttlMs:Infinity}));
});
