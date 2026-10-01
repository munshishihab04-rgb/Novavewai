import {verifiedJobPages} from '../../src/jobs-live.ts';import {readFile,writeFile} from 'node:fs/promises';
const search=JSON.parse(await readFile(new URL('./search-2.json',import.meta.url),'utf8'));
const result=await verifiedJobPages(search.sources,{occupation:'cameriere',city:'Bologna',noAgencies:false},AbortSignal.timeout(30000));
await writeFile(new URL('./live-adapter-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
