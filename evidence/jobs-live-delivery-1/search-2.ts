import {searchWeb} from '../../src/azure-services.ts';import {writeFile} from 'node:fs/promises';
const query='site.jobs OR site:careers.marriott.com OR site:jobs.hilton.com OR site:jobintourism.it "Bologna" "cameriere" annuncio posizione';
const r=await searchWeb(query,AbortSignal.timeout(90000));await writeFile(new URL('./search-2.json',import.meta.url),JSON.stringify({query,...r},null,2));console.log(JSON.stringify(r,null,2));
