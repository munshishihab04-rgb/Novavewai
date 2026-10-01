// Read-only code review reproductions. Writes only fixtures beneath this directory.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {JobsService,jobIntent} from '../../src/jobs.ts';
import {discoverProgressively,type Opportunity} from '../../src/jobs-discovery.ts';
const signal=new AbortController().signal;
const at='2026-09-26T00:00:00Z';
const fixture=(i:number,extra:Partial<Opportunity>={}):Opportunity=>({opportunity_kind:'VACANCY',title:'REVIEW FIXTURE '+i,city:'Milano',source_url:'https://example.org/jobs/'+i,source_type:'UNKNOWN',publisher_type:'UNKNOWN',verification_status:'UNVERIFIED',discovered_at:at,last_verified_at:null,status:'UNKNOWN',evidence:[],...extra});
const out:any[]=[];
const query={occupation:'lavapiatti',city:'Milano',noAgencies:false};
let verifies=0;
const skipped=await discoverProgressively(query,{search:async()=>[fixture(1),fixture(2),fixture(3)],verify:async rows=>{verifies++;return rows}},signal);
assert.equal(verifies,0);out.push({id:'P1',case:'3 unverified vacancies bypass available verifier',verifier_calls:verifies,stages:skipped.stages});
const loss=await discoverProgressively(query,{search:async()=>[],companies:async()=>Array.from({length:8},(_,i)=>fixture(i,{opportunity_kind:'COMPATIBLE_COMPANY'})),verify:async rows=>rows},signal);
assert.equal(loss.opportunities.length,6);out.push({id:'P2',case:'identity verifier drops unselected candidates',input:8,output:loss.opportunities.length});
const strict=await discoverProgressively({...query,noAgencies:true},{search:async()=>[...Array.from({length:12},(_,i)=>fixture(i)),fixture(99,{publisher_type:'DIRECT_EMPLOYER'})]},signal);
assert.equal(strict.opportunities.length,0);out.push({id:'P3',case:'output cap applied before strict filtering loses direct employer at index 12',returned:strict.opportunities.length,excluded:strict.excludedUnknown});
const hostile=await discoverProgressively(query,{search:async()=>[fixture(1,{source_url:'javascript:alert(1)',verification_status:'VERIFIED',publisher_type:'DIRECT_EMPLOYER'})]},signal);
assert.equal(hostile.opportunities[0].source_url,'javascript:alert(1)');out.push({id:'P4',case:'typed provider output has no runtime URL/evidence verification',returned:hostile.opportunities[0]});
const dir=new URL('./repro-cache/',import.meta.url).pathname;await mkdir(dir,{recursive:true});
try{
 const service=new JobsService({cacheDir:dir,minIntervalMs:0,source:async()=>[{title:'REVIEW FIXTURE',city:'Milano',source:'Subito',url:'https://www.subito.it/offerte-lavoro/lavapiatti-123.htm'}]});
 for(const text of ['lavapiatti senza agenzie','lavapiatti senza intermediari','lavapiatti solo datori diretti','dishwasher direct employers only']){
  const result=await service.search({query:text,city:'Milano'},signal);out.push({id:'I2',case:text,unknown_jobs:result.jobs?.length,excludedUnknown:result.excludedUnknown??0});
 }
}finally{await rm(dir,{recursive:true,force:true})}
// Mirrors exact native city grounding without executing a provider or DB here.
for(const text of ['Ora cerco cameriere a Milano Prima cercavo cameriere Bologna','Cerco cameriere a Parma Ho visitato Bologna','Cerco cameriere, non a Milano'])out.push({id:'I1',case:text,grounded:jobIntent({query:text,city:''})});
await writeFile(new URL('./reproductions.json',import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
