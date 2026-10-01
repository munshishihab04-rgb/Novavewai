// Bounded live probe with the owner flag: 'cameriere Bologna' on Subito via the on-demand adapter. Sanitized output only.
import {writeFile} from 'node:fs/promises';
import {createSubitoSearch,subitoOpportunities,subitoAutomatedAccessAccepted,SUBITO_FLAG} from '../src/jobs-subito-playwright.ts';
if(!subitoAutomatedAccessAccepted()){console.error(`refusing: ${SUBITO_FLAG} not set to owner-accepted`);process.exit(2)}
const t0=Date.now();const search=createSubitoSearch();
const r=await subitoOpportunities(search,{occupation:'cameriere',city:'Bologna',noAgencies:false},AbortSignal.timeout(30000));
const out={probedAt:new Date().toISOString(),elapsedMs:Date.now()-t0,policyFlag:`${SUBITO_FLAG}=owner-accepted (set only for this probe shell; not in service env)`,provenance:r.provenance,sourceUnavailable:r.sourceUnavailable??null,count:r.opportunities.length,byLocation:Object.fromEntries(['CITY','PROVINCE_OR_REGION','MISMATCH','UNKNOWN'].map(k=>[k,r.opportunities.filter(o=>o.locationMatch===k).length])),results:r.opportunities.map(o=>({title:o.title,comune:o.observedLocality,provincia:o.observedProvince,locationMatch:o.locationMatch,url:o.source_url,publisher_type:o.publisher_type,verification_status:o.verification_status,status:o.status}))};
await writeFile('evidence/jobs-jsonld-1/subito-live.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
