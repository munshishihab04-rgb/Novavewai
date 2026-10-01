import {searchWeb} from '../../src/azure-services.ts';
import {writeFile} from 'node:fs/promises';
const query='cameriere Bologna offerte lavoro sito ufficiale ristorante hotel posizioni aperte';
const r=await searchWeb(query,AbortSignal.timeout(90000));
await writeFile(new URL('./search-1.json',import.meta.url),JSON.stringify({query,...r},null,2));console.log(JSON.stringify(r,null,2));
