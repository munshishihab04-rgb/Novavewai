import {resolve} from 'node:path';
import {JobsService} from '../src/jobs.ts';
import {searchSubito} from '../src/jobs-subito.ts';
import {warmJobs} from '../src/jobs-warm.ts';
const cacheDir=process.env.NOVA_JOBS_CACHE_DIR??resolve('.cache/jobs');
const service=new JobsService({cacheDir,source:searchSubito});
const result=await warmJobs({cacheDir,search:(input,signal)=>service.search(input,signal)});
console.log(JSON.stringify(result));
if(result.results.some(r=>r.status==='unavailable'))process.exitCode=1;
