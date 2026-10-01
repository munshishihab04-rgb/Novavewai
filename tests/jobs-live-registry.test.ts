import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedJobPages,discoveryQuery,JOB_SOURCE_REGISTRY} from '../src/jobs-live.ts';
const q={occupation:'cameriere',city:'Bologna',noAgencies:false};
const html=(t:string,body:string)=>`<html><head><title>${t}</title></head><body>${body}</body></html>`;
const mk=(pages:Record<string,{status?:number;body:string;headers?:Record<string,string>}>,log:string[]=[])=>async(input:any,init?:any)=>{const u=String(input);log.push(u);const p=pages[u];if(!p)return new Response('not found',{status:404});assert.equal(init?.redirect,'manual');return new Response(p.body,{status:p.status??200,headers:{'content-type':'text/html',...(p.headers??{})}})};

test('registry is provider-neutral, fixed and reviewed: only https detail-shaped paths on listed origins are fetched',async()=>{
 const log:string[]=[];
 const r=await verifiedJobPages([
  {title:'idx',url:'https://www.lavoroturismo.it/offerte-lavoro'},// index, not detail
  {title:'q',url:'https://www.lavoroturismo.it/offerte-lavoro/offerta-x?utm=1'},// query string disallowed by robots
  {title:'http',url:'http://www.lavoroturismo.it/offerte-lavoro/offerta-x'},
  {title:'creds',url:'https://user:pw@www.lavoroturismo.it/offerte-lavoro/offerta-x'},
  {title:'port',url:'https://www.lavoroturismo.it:8443/offerte-lavoro/offerta-x'},
  {title:'other',url:'https://evil.example/offerte-lavoro/offerta-x'},
  {title:'sub',url:'https://www.lavoroturismo.it.evil.example/offerte-lavoro/offerta-x'},
 ],q,AbortSignal.timeout(1000),mk({},log) as any);
 assert.deepEqual(log,[]);assert.equal(r.opportunities.length,0);assert.equal(r.skipped,7);
 for(const s of JOB_SOURCE_REGISTRY){assert.match(s.origin,/^https:\/\/[a-z0-9.-]+$/);assert.ok(s.reviewedAt&&s.robots);assert.ok(['JOB_BOARD','DIRECT_EMPLOYER'].includes(s.sourceType));}
});

test('expired, redirected, epoch-dated and off-city pages never become vacancies; reasons are kept',async()=>{
 const pages={
  'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-smy-hotels':{body:html('Cameriere/a di sala - LavoroTurismo','<h1>Cameriere/a di sala</h1> SMY HOTELS Pubblicato il 01/01/1970 Questa offerta è scaduta Luogo di lavoro Bologna, Italia')},
  'https://job.hnh.it/jobs/Cameriere-di-sala-Bologna-1.htm':{status:404,body:'Altamira error notification The vacancy you requested is not longer published on this site.'},
  'https://www.restworld.it/posizione/offerta-di-lavoro-cameriere-monte_san_pietro-abc':{body:html('Cameriere/a | Restworld','<h1>Cameriere/a</h1> Ristorante X Monte San Pietro Full time Pubblicata il 28/09/2026 Candidati')},
  'https://www.jobintourism.it/offerta/cameriere-bologna/':{status:301,body:'',headers:{location:'https://www.jobintourism.it/'}},
  'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-epoch':{body:html('Cameriere/a di sala','<h1>Cameriere/a di sala</h1> Hotel Y Pubblicato il 01/01/1970 Luogo di lavoro Bologna, Italia Candidati')},
 };
 const r=await verifiedJobPages(Object.keys(pages).map(url=>({title:'lead',url})),q,AbortSignal.timeout(1000),mk(pages) as any);
 assert.equal(r.opportunities.length,0);
 const by=Object.fromEntries(r.unavailable.map(u=>[u.url,u]));
 assert.equal(by[Object.keys(pages)[0]].status,'EXPIRED');
 assert.equal(by[Object.keys(pages)[1]].status,'EXPIRED');
 assert.equal(by[Object.keys(pages)[2]].status,'MISMATCH');assert.match(by[Object.keys(pages)[2]].reason,/city/);assert.equal(by[Object.keys(pages)[2]].observedLocation,'Monte San Pietro');
 assert.equal(by[Object.keys(pages)[3]].status,'REDIRECTED');
 assert.equal(by[Object.keys(pages)[4]].status,'STALE_DATE');
});

test('a current listing with role, exact city and plausible date becomes a vacancy with provenance; publisher is classified not assumed',async()=>{
 const pages={
  'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-hotel-z':{body:html('Cameriere/a di sala - LavoroTurismo','<h1>Cameriere/a di sala</h1> HOTEL Z Pubblicato il 28/09/2026 Luogo di lavoro Bologna, Italia Tipologia di contratto Full-time Candidati Soluzione Lavoro Turismo sas è iscritta all\'Albo delle Agenzie per il lavoro')},
  'https://job.hnh.it/jobs/Cameriere-di-sala-Bologna-2.htm':{body:html('Cameriere di sala | Bologna | HNH Hospitality','<h1>Cameriere di sala</h1> Sede Italia/Bologna Data pubblicazione 29/09/2026 HNH Hospitality Spa Candidati')},
  'https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-agency':{body:html('Cameriere/a di sala','<h1>Cameriere/a di sala</h1> ADECCO ITALIA SPA Agenzia per il lavoro Pubblicato il 27/09/2026 Luogo di lavoro Bologna, Italia Candidati')},
 };
 const r=await verifiedJobPages(Object.keys(pages).map(url=>({title:'lead',url})),q,AbortSignal.timeout(1000),mk(pages) as any);
 assert.equal(r.opportunities.length,3);
 const [board,employer,agency]=r.opportunities;
 assert.equal(board.publisher_type,'UNKNOWN');assert.equal(board.source_type,'JOB_BOARD');// site footer agency notice is the host's, not proof about HOTEL Z
 assert.equal(employer.publisher_type,'DIRECT_EMPLOYER');assert.equal(employer.source_type,'DIRECT_EMPLOYER');
 assert.equal(agency.publisher_type,'STAFFING_AGENCY');
 for(const o of r.opportunities){assert.equal(o.opportunity_kind,'VACANCY');assert.equal(o.city,'Bologna');assert.equal(o.verification_status,'VERIFIED');assert.ok(o.last_verified_at);assert.match(o.evidence[0].claim,/camerier/i);assert.match(o.evidence[0].claim,/Bologna/);assert.ok((o as any).publishedAt);}
 // strict no-agencies: only the confirmed direct employer survives; exclusions counted
 const strict=await verifiedJobPages(Object.keys(pages).map(url=>({title:'lead',url})),{...q,noAgencies:true},AbortSignal.timeout(1000),mk(pages) as any);
 assert.equal(strict.opportunities.length,1);assert.equal(strict.opportunities[0].publisher_type,'DIRECT_EMPLOYER');assert.equal(strict.excludedNonDirect,2);
});

test('bounded: at most six leads, 2.5MB body, one request per lead, fetch failure is UNAVAILABLE not silent',async()=>{
 const log:string[]=[];const pages:any={};for(let i=0;i<8;i++)pages[`https://www.lavoroturismo.it/offerte-lavoro/offerta-c-${i}`]={body:'x'};
 pages['https://www.lavoroturismo.it/offerte-lavoro/offerta-c-0']={body:'y'.repeat(2_500_001)};
 const r=await verifiedJobPages(Object.keys(pages).map(url=>({title:'l',url})),q,AbortSignal.timeout(1000),mk(pages,log) as any);
 assert.equal(log.length,6);assert.equal(r.testedScope.leads,6);assert.equal(r.unavailable.find(u=>u.url.endsWith('c-0'))?.status,'UNAVAILABLE');
 const failing=async()=>{throw new TypeError('fetch failed')};
 const f=await verifiedJobPages([{title:'l',url:'https://www.lavoroturismo.it/offerte-lavoro/offerta-c-1'}],q,AbortSignal.timeout(1000),failing as any);
 assert.equal(f.unavailable[0].status,'UNAVAILABLE');assert.match(f.unavailable[0].reason,/fetch failed/);
});

test('discovery query targets single listing pages on reviewed sources, not generic indexes, and carries no user text',()=>{
 const s=discoveryQuery('cameriere','Bologna');
 assert.match(s,/cameriere/);assert.match(s,/Bologna/);assert.match(s,/lavoroturismo\.it/);assert.match(s,/restworld\.it/);assert.doesNotMatch(s,/infojobs/);
 assert.ok(s.length<400);
});
