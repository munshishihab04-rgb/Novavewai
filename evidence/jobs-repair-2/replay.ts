// Offline replay of historical citations only; no search or page requests.
import {readFile,writeFile} from 'node:fs/promises';
import {webJobCandidates} from '../../src/jobs.ts';
const historical=JSON.parse(await readFile(new URL('../jobs-repair-1/bounded-live-candidates.json',import.meta.url),'utf8'));
const sources=historical.result.opportunities.map((row:any)=>({title:row.title,url:row.source_url}));
const result=webJobCandidates({sources,checkedAt:historical.queriedAt},'cameriere','Bologna',true);
const replay={mode:'offline_historical_citations',source:'evidence/jobs-repair-1/bounded-live-candidates.json',liveRequests:0,inputCitations:sources.length,result};
await writeFile(new URL('historical-replay.json',import.meta.url),JSON.stringify(replay,null,2)+'\n');
console.log(JSON.stringify({inputCitations:sources.length,searchLinks:result.searchLinks?.length,opportunities:result.opportunities?.length??0,jobs:result.jobs?.length??0}));
