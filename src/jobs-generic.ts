import {jobIntent,requiresDirectEmployer,webJobCandidates,type JobsInput,type JobsResult} from './jobs.ts';
import {validJobTerm,normalizeJobText} from './jobs-input.ts';
import type {Opportunity} from './jobs-discovery.ts';
import {isIP} from 'node:net';
export function safeJobUrl(raw:string){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!isIP(u.hostname.replace(/^\[|\]$/g,''))&&!/^(?:localhost)$/i.test(u.hostname)&&!/(?:\.local|\.internal|\.)$/i.test(u.hostname)&&u.hostname.includes('.')}catch{return false}}
export type CollectedJob={occupation:string;title:string;city:string;province?:string;remote?:boolean;url:string;sourceName:string;collectedAt:string;permission:'permitted_import';publisherType?:Opportunity['publisher_type'];publisherEvidence?:string;publishedAt?:string};
// Only application-owned adapters may supply records; no model-provided records,
// URLs, permission flag or fixture dataset are registered as a collection source.
export class GenericJobsService {
 constructor(private options:{records?:readonly CollectedJob[];now?:()=>number}={}){}
 async search(input:JobsInput,signal:AbortSignal):Promise<JobsResult>{
  signal.throwIfAborted();const intent=jobIntent(input);const {occupation,city,remote}=intent;
  if(!city&&!remote)return {status:'needs_city',occupation,question:'In quale città vuoi cercare lavoro? Indica un solo comune.'};
  if(!occupation)return {status:'needs_occupation',city,question:'Che tipo di lavoro cerchi? Indica un ruolo o settore, senza URL.'};
  const noAgencies=requiresDirectEmployer(input.query),at=new Date(this.options.now?.()??Date.now()).toISOString();
  const q=`${occupation} ${city||'remoto'}`;const url=new URL('https://www.subito.it/annunci-italia/vendita/offerte-lavoro/');url.searchParams.set('q',q);
  const base=webJobCandidates({checkedAt:at,sources:[{title:`Subito — ricerca nazionale per parole chiave: ${q}`,url:url.href}]},occupation,city??'',noAgencies);
  Object.assign(base.searchLinks![0],{pageKind:'SEARCH',sourceName:'Subito',publisher_type:'UNKNOWN',requestedRole:occupation,requestedCity:city??null,requestedProvince:null,status:'NOT_FETCHED',evidence:'Constructed national keyword search URL; not an observed listing or geographic filter.'});
  Object.assign(base,{remote,sourceUnavailable:{code:'jobs_automated_access_not_authorized',originalSearchUrl:url.href},notice:(noAgencies?'Vincolo solo datori diretti non verificato. ':'')+'Link di ricerca nazionale per parole chiave, non annunci trovati né filtro geografico verificato. Accesso automatico Subito non autorizzato; nessuna pagina raccolta. Inserzionista sconosciuto.'});
  const seen=new Set<string>();const opportunities:Opportunity[]=[];
  for(const r of (this.options.records??[]).slice(0,1000)){
   if(r.permission!=='permitted_import'||!safeJobUrl(r.url)||seen.has(r.url)||!validJobTerm(r.title,160)||!validJobTerm(r.city,80)&&!r.remote||normalizeJobText(r.occupation).toLowerCase()!==occupation.toLowerCase()||city&&normalizeJobText(r.city).toLowerCase()!==city.toLowerCase()||!city&&(!remote||!r.remote)||!Number.isFinite(Date.parse(r.collectedAt))||Date.parse(r.collectedAt)>Date.parse(at))continue;
   const publisher=r.publisherEvidence&&r.publisherType?r.publisherType:'UNKNOWN';
   if(noAgencies&&publisher!=='DIRECT_EMPLOYER')continue;
   seen.add(r.url);opportunities.push({opportunity_kind:'VACANCY',title:r.title,city:r.city,source_url:r.url,source_type:'JOB_BOARD',publisher_type:publisher,verification_status:'UNVERIFIED',discovered_at:r.collectedAt,last_verified_at:null,status:'UNKNOWN',evidence:[{url:r.url,observed_at:r.collectedAt,claim:'Permitted imported observation; not a live availability check.'}],...{province:r.province??null,sourceName:r.sourceName,occupation:r.occupation,collectionMode:'permitted_import',publishedAt:r.publishedAt??null}});
   if(opportunities.length===12)break;
  }
  if(opportunities.length)return {...base,status:'collected_results',opportunities,constraintStatus:noAgencies?'met':'not_requested',notice:'Osservazioni importate con permesso, datate per annuncio. Disponibilità attuale non verificata; non è una ricerca live.'};
  return base;
 }
}
import {JobPostingReader,looksLikeDetailPage,publicHttpsUrl,classifyLocation,type PostingRead} from './jobs-posting.ts';
import {OriginPermissionGate} from './jobs-permission.ts';
export type VerifiedOpportunity=Opportunity&{sourceName:string;company:string|null;observedLocality:string|null;observedRegion:string|null;locationMatch:ReturnType<typeof classifyLocation>;datePosted:string|null;validThrough:string|null;validity:'CURRENT'|'EXPIRED'|'UNKNOWN';employmentType:string|null;directApply:boolean|null;observed_at:string;collectionMode:'jsonld_detail_page';publisherEvidence:string|null};
export type PostingReadSummary={url:string;outcome:PostingRead['outcome'];reason:string;observedAt:string;permitted:boolean};
// After web discovery: read detail-shaped links from robots-permitted origins and turn JobPosting
// JSON-LD into opportunities. Links without JSON-LD or without permission stay browsing suggestions.
export async function jsonLdOpportunities(links:readonly {url:string;title?:string}[],query:{occupation:string;city:string;noAgencies:boolean},reader:JobPostingReader,signal:AbortSignal,beforeIO?:()=>Promise<void>):Promise<{opportunities:VerifiedOpportunity[];reads:PostingReadSummary[];excludedNonDirect:number;verifiedUrls:Set<string>}>{
 const candidates=links.map(l=>l.url).filter(u=>{const p=publicHttpsUrl(u);return !!p&&looksLikeDetailPage(p)});
 const reads=await reader.read(candidates,signal,beforeIO);
 const opportunities:VerifiedOpportunity[]=[];let excludedNonDirect=0;const verifiedUrls=new Set<string>();const seen=new Set<string>();
 const agencyRe=/agenzia per il lavoro|aut\.? min\.?|adecco|lavoropi[uù]|randstad|manpower|gi group|synergie|openjob|umana|etjca|staff\b|e-work|orienta|during|tempor|ali spa|maw\b|humangest|generazione vincente|articolo ?1|oggi lavoro|axl spa|\bin ?job\b/i;
 for(const r of reads){
  if(r.outcome!=='JSONLD_VERIFIED'||!r.posting||seen.has(r.url))continue;seen.add(r.url);
  const p=r.posting;const org=p.hiringOrganization;
  // Publisher stays UNKNOWN unless the structured organization name itself evidences an agency.
  const agency=!!org&&agencyRe.test(org);
  const publisher:Opportunity['publisher_type']=agency?'STAFFING_AGENCY':'UNKNOWN';
  // No structured evidence ever proves a direct employer here, so strict requests exclude every read.
  if(query.noAgencies){excludedNonDirect++;continue}
  const locationMatch=classifyLocation(query.city,p);
  const host=new URL(r.url).hostname.replace(/^www\./,'');
  verifiedUrls.add(r.url);
  opportunities.push({opportunity_kind:'VACANCY',title:p.title,city:p.locality??query.city,source_url:r.url,source_type:'JOB_BOARD',publisher_type:publisher,verification_status:'JSONLD_VERIFIED',discovered_at:r.observedAt,last_verified_at:r.observedAt,status:p.validity==='EXPIRED'?'EXPIRED':'OBSERVED',evidence:[{url:r.url,observed_at:r.observedAt,claim:`schema.org JobPosting JSON-LD on listing page: title, ${org?'hiringOrganization':'no hiringOrganization'}, locality ${p.locality??'n/a'}, datePosted ${p.datePosted??'n/a'}, validThrough ${p.validThrough??'n/a'}; ${r.permission.reason}`.slice(0,500)}],sourceName:host,company:org,observedLocality:p.locality,observedRegion:p.region,locationMatch,datePosted:p.datePosted,validThrough:p.validThrough,validity:p.validity,employmentType:p.employmentType,directApply:p.directApply,observed_at:r.observedAt,collectionMode:'jsonld_detail_page',publisherEvidence:agency?`hiringOrganization "${org}" names a staffing agency`:null});
  if(opportunities.length>=12)break;
 }
 return {opportunities,reads:reads.map(r=>({url:r.url,outcome:r.outcome,reason:r.reason,observedAt:r.observedAt,permitted:r.permission.permitted})),excludedNonDirect,verifiedUrls};
}
export function defaultPostingReader(fetcher?:typeof fetch){return new JobPostingReader({gate:new OriginPermissionGate({fetcher}),fetcher})}
