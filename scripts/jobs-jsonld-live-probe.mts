// Bounded live probe: robots + 2 helplavoro + 1 lavoroperte through the real reader; sanitized output only.
import {writeFile} from 'node:fs/promises';
import {JobPostingReader} from '../src/jobs-posting.ts';
import {OriginPermissionGate} from '../src/jobs-permission.ts';
import {jsonLdOpportunities} from '../src/jobs-generic.ts';
const urls=[
 'https://www.helplavoro.it/offerta-di-lavoro-in-provincia-di-modena-cercasi-operaio-a-con-esperienza-in-produzione-metalmeccanica-per-ruolo-di-saldatore/6903100.html',
 process.argv[2]??'',
 'https://lavoroperte.regione.emilia-romagna.it/offerte-lavoro/modena/saldatore-vignola/521226',
 'https://www.gigroup.it/offerte-lavoro-dettaglio/modena-saldatore-a-filo/1247685/',
].filter(Boolean);
const gate=new OriginPermissionGate();const reader=new JobPostingReader({gate});
const t0=Date.now();
const r=await jsonLdOpportunities(urls.map(url=>({url})),{occupation:'saldatore',city:'Modena',noAgencies:false},reader,AbortSignal.timeout(60000));
const out={probedAt:new Date().toISOString(),elapsedMs:Date.now()-t0,note:'Sanitized: only structured JobPosting fields; no description/phone/email. gigroup included to record honest access outcome.',reads:r.reads,opportunities:r.opportunities.map(o=>({title:o.title,company:o.company,observedLocality:o.observedLocality,observedRegion:o.observedRegion,locationMatch:o.locationMatch,datePosted:o.datePosted,validThrough:o.validThrough,validity:o.validity,status:o.status,publisher_type:o.publisher_type,employmentType:o.employmentType,directApply:o.directApply,verification_status:o.verification_status,source_url:o.source_url,observed_at:o.observed_at}))};
await writeFile('evidence/jobs-jsonld-1/live-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
