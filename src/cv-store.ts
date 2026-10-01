// CV v1 storage over the existing artifacts/revisions tables (no new table).
// content = {kind:'cv',schema_version:1,cv,verification,change_summary,text,language}
//  - `cv` is the ONE canonical structured content; `text` is a read-only plain projection kept so legacy
//    readers (workspace editor, old PDF route) still show something sensible.
//  - every update is a new immutable revision (reviseArtifact); nothing is edited in place.
// Verification stamping (server-side, never from the model):
//  - 'raccolto'          every string leaf of the value appears verbatim (case-insensitive) in the LATEST user turn
//  - 'proposto'          anything else the model supplies (normalised dates, bullets it phrased, inferred items)
//  - 'confermato_utente' the latest user turn contains an explicit confirmation phrase; applies to EVERY field
//                        touched by this upsert. Known limits: lexical only, turn-level (cannot tell "confermo il
//                        nome ma non la data"), and it never certifies that a fact is true (mappa §B).
import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {createArtifact,reviseArtifact} from './artifacts.ts';
import {SafeError,fail} from './app.ts';
import {validateCv,missingFields,completeness,emptyCv,cvPlainText,cvCard,isCvContent,CV_SCHEMA_VERSION,CV_TEMPLATES,type Cv,type Verification} from './cv-schema.ts';
const CONFIRM=/\b(confermo|confermato|conferma(?:to)?\s+tutto|è giusto|e' giusto|esatto|corretto|va bene così|tutto giusto|i confirm|confirmed|that's correct|that is correct|looks good)\b|ঠিক আছে|নিশ্চিত/i;
export const explicitConfirmation=(userTurn:string)=>CONFIRM.test(userTurn);
const leaves=(v:any):string[]=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(leaves):v&&typeof v==='object'?Object.values(v).flatMap(leaves):[];
const norm=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
function verbatim(value:any,userTurn:string){const text=norm(userTurn);const ls=leaves(value).map(norm).filter(s=>s.length>=2);return ls.length>0&&ls.every(s=>text.includes(s))}
export function mergeFacts(previous:Cv,facts:any):Cv{
 const next:Cv={...structuredClone(previous)};
 if(facts.identity)next.identity={...next.identity,...facts.identity};
 for(const k of ['summary','consent_line'] as const)if(typeof facts[k]==='string')next[k]=facts[k];
 for(const k of ['experiences','education','skills','languages','certifications'] as const)if(Array.isArray(facts[k]))(next as any)[k]=facts[k];
 if(facts.presentation)next.presentation={...next.presentation,...facts.presentation};
 return next;
}
export function stampVerification(previous:Record<string,Verification>,facts:any,userTurn:string){
 const v:Record<string,Verification>={...previous};const confirmed=explicitConfirmation(userTurn);
 const mark=(key:string,value:any)=>{v[key]=confirmed?'confermato_utente':verbatim(value,userTurn)?'raccolto':'proposto'};
 if(facts.identity)for(const [k,val] of Object.entries(facts.identity))if(typeof val==='string'&&val.trim())mark('identity.'+k,val);
 for(const k of ['summary','consent_line'])if(typeof facts[k]==='string'&&facts[k].trim())mark(k,facts[k]);
 for(const k of ['experiences','education','skills','languages','certifications'])if(Array.isArray(facts[k])){for(const key of Object.keys(v))if(key.startsWith(k+'['))delete v[key];facts[k].forEach((item:any,i:number)=>mark(`${k}[${i}]`,item))}
 return v;
}
export interface CvUpsertArgs{artifactId?:string;baseRevision?:number;facts:any;change_summary:string}
export async function upsertCv(c:PoolClient,owner:string,taskId:string,args:CvUpsertArgs,userTurn:string,knownArtifacts:readonly string[]){
 let previous:Cv=emptyCv(),previousVerification:Record<string,Verification>={};
 if(args.artifactId){
  if(!knownArtifacts.includes(args.artifactId))fail(404,'tool_not_found');
  const row=(await c.query('SELECT r.content FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id AND a.current_revision=r.revision WHERE a.owner_id=$1 AND a.id=$2',[owner,args.artifactId])).rows[0];
  if(!row||!isCvContent(row.content))fail(409,'not_a_cv');
  previous=row.content.cv;previousVerification=row.content.verification??{};
 }
 const cv=mergeFacts(previous,args.facts);const verification=stampVerification(previousVerification,args.facts,userTurn);
 const {verification:_drop,...bare}=cv as any;
 const errors=validateCv({...bare,verification});if(errors.length)throw Object.assign(new SafeError(400,'invalid_cv'),{detail:errors.slice(0,10).join('; ')});
 const content={kind:'cv',schema_version:CV_SCHEMA_VERSION,cv:bare,verification,change_summary:args.change_summary,text:cvPlainText(bare),language:bare.presentation.language};
 const title=`CV — ${bare.identity.full_name||'in preparazione'}`;
 const saved=args.artifactId?await reviseArtifact(c,owner,args.artifactId,{baseRevision:args.baseRevision,content}):await createArtifact(c,owner,{taskId,title,content});
 if(args.artifactId)await c.query('UPDATE artifacts SET title=$3 WHERE owner_id=$1 AND id=$2',[owner,args.artifactId,title]);
 const missing=missingFields(bare);
 return {artifactId:saved.id,revision:saved.revision,hash:saved.hash,card:cvCard(bare),completeness:completeness(bare),verification,missing,next_question:missing[0]?.question??null,templates:[...CV_TEMPLATES],
  note:'Saved as an immutable revision. Verification marks who supplied each value (raccolto=user words, proposto=model wording, confermato_utente=user confirmed in chat); it never certifies truth. Ask the next_question if present; before cv_export ask the user to confirm the content and choose a template.'};
}
export async function loadCvRevision(c:PoolClient,owner:string,artifactId:string){
 const row=(await c.query('SELECT a.current_revision AS revision,r.content FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id AND a.current_revision=r.revision WHERE a.owner_id=$1 AND a.id=$2',[owner,artifactId])).rows[0];
 if(!row||!isCvContent(row.content))fail(409,'not_a_cv');
 return {revision:row.revision as number,cv:row.content.cv as Cv};
}
// Export receipt: the rendered bytes are stored verbatim in a generated-file artifact (same download route as
// create_file), bound to the exact CV revision/template/language. Old PDFs stay as history; they are never
// re-rendered on download, so what the user downloaded is what was verified at export time.
export async function storeCvExport(c:PoolClient,owner:string,taskId:string,input:{artifactId:string;revision:number;template:string;language:string;pdf:Buffer;fullName:string}){
 const slug=(input.fullName||'cv').normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'cv';
 const name=`cv-${slug}-v${input.revision}-${input.template}-${input.language}.pdf`;
 const sha256=createHash('sha256').update(input.pdf).digest('hex');
 const saved=await createArtifact(c,owner,{taskId,title:name,content:{text:'',language:input.language,file:{name,format:'pdf',entries:[],cv_export:{artifactId:input.artifactId,revision:input.revision,template:input.template,language:input.language,template_version:1}},pdf_base64:input.pdf.toString('base64'),sha256,bytes:input.pdf.length}});
 return {artifactId:input.artifactId,revision:input.revision,template:input.template,language:input.language,format:'pdf',name,bytes:input.pdf.length,sha256,fileArtifactId:saved.id,download:`/artifacts/${saved.id}/revisions/${saved.revision}/download`,origin:'assistant_generated',executed:false,note:'PDF rendered from this exact CV revision; the download is owner-bound. Tell the user the file is ready and which template/language was used; later edits create a new revision and need a new export.'};
}
