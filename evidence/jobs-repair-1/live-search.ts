import {searchWeb} from '../../src/azure-services.ts';import {webJobCandidates} from '../../src/jobs.ts';import {writeFile} from 'node:fs/promises';
const raw=await searchWeb('cameriere Bologna offerte lavoro',AbortSignal.timeout(60000));
const result=webJobCandidates(raw,'cameriere','Bologna');
await writeFile(new URL('./bounded-live-candidates.json',import.meta.url),JSON.stringify({queriedAt:raw.checkedAt,queryCount:1,maxCitationsRead:6,result},null,2));
console.log(JSON.stringify({status:result.status,candidates:result.opportunities?.length??0,queriedAt:raw.checkedAt}));
