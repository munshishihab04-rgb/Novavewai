// CV v1 structured content (mappa-tecnica-cv-v1 §B/§G). ONE canonical structured CV per artifact revision:
// artifact_revisions.content = {kind:'cv',schema_version:1,cv:<Cv>}. Preview/PDF are projections of that revision.
// Closed schema: unknown keys are rejected; photo is never accepted. Verification marks who confirmed a value,
// never whether it is true ('confermato_utente' = the user confirmed it in chat, not that it was checked).
// No import from app.ts: this module is imported by agent-tools/artifacts and app.ts imports those; a cycle would TDZ.
const canonical=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
export const CV_SCHEMA_VERSION=1;
export const CV_TEMPLATES=['modern','classic','professional'] as const;
export const CV_LANGUAGES=['it','en','bn'] as const;
export const CV_SECTIONS=['identity','summary','experiences','education','skills','languages','certifications','consent_line'] as const;
export const VERIFICATION=['raccolto','proposto','confermato_utente'] as const;
export type CvTemplate=typeof CV_TEMPLATES[number];export type CvLanguage=typeof CV_LANGUAGES[number];export type Verification=typeof VERIFICATION[number];
export interface CvExperience{role:string;employer:string;city:string;start:string;end:string|null;bullets:string[]}
export interface CvEducation{title:string;institution:string;city:string;start:string;end:string}
export interface Cv{
 identity:{full_name:string;headline:string;email:string;phone:string;city:string};
 summary:string;experiences:CvExperience[];education:CvEducation[];skills:{name:string;level:string}[];languages:{name:string;level:string}[];certifications:{name:string;issuer:string;year:string}[];
 consent_line:string;presentation:{template_id:CvTemplate;language:CvLanguage;section_order:string[]};
 verification?:Record<string,Verification>;
}
export const CV_LIMITS={short:120,medium:300,summary:1200,bullet:300,bullets:8,experiences:20,education:12,skills:30,languages:8,certifications:12,consent:400,totalBytes:24000} as const;
const MONTH=/^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const CEFR=['','A1','A2','B1','B2','C1','C2','madrelingua'];
const str=(max:number)=>({t:'string',max});
// Minimal closed-schema description reused by both validation and the tool JSON schema.
const EXPERIENCE={role:str(CV_LIMITS.short),employer:str(CV_LIMITS.short),city:str(CV_LIMITS.short),start:{t:'month'},end:{t:'month_or_null'},bullets:{t:'array',max:CV_LIMITS.bullets,items:str(CV_LIMITS.bullet)}};
const EDUCATION={title:str(CV_LIMITS.short),institution:str(CV_LIMITS.short),city:str(CV_LIMITS.short),start:{t:'month_or_empty'},end:{t:'month_or_empty'}};
const SHAPE:any={
 identity:{t:'object',props:{full_name:str(CV_LIMITS.short),headline:str(CV_LIMITS.short),email:str(CV_LIMITS.short),phone:str(40),city:str(CV_LIMITS.short)}},
 summary:str(CV_LIMITS.summary),
 experiences:{t:'array',max:CV_LIMITS.experiences,items:{t:'object',props:EXPERIENCE}},
 education:{t:'array',max:CV_LIMITS.education,items:{t:'object',props:EDUCATION}},
 skills:{t:'array',max:CV_LIMITS.skills,items:{t:'object',props:{name:str(CV_LIMITS.short),level:str(40)}}},
 languages:{t:'array',max:CV_LIMITS.languages,items:{t:'object',props:{name:str(CV_LIMITS.short),level:{t:'enum',values:CEFR}}}},
 certifications:{t:'array',max:CV_LIMITS.certifications,items:{t:'object',props:{name:str(CV_LIMITS.medium),issuer:str(CV_LIMITS.short),year:{t:'year_or_empty'}}}},
 consent_line:str(CV_LIMITS.consent),
 presentation:{t:'object',props:{template_id:{t:'enum',values:[...CV_TEMPLATES]},language:{t:'enum',values:[...CV_LANGUAGES]},section_order:{t:'array',max:CV_SECTIONS.length,items:{t:'enum',values:[...CV_SECTIONS]}}}},
 verification:{t:'map',values:[...VERIFICATION],optional:true},
};
function check(shape:any,value:any,path:string,errors:string[]){
 const bad=(why:string)=>{errors.push(`${path}:${why}`)};
 switch(shape.t){
  case 'string':return typeof value==='string'?(value.length>shape.max?bad('too_long'):undefined):bad('not_string');
  case 'month':return typeof value==='string'&&MONTH.test(value)?undefined:bad('expected_YYYY-MM');
  case 'month_or_null':return value===null||(typeof value==='string'&&MONTH.test(value))?undefined:bad('expected_YYYY-MM_or_null');
  case 'month_or_empty':return typeof value==='string'&&(value===''||MONTH.test(value))?undefined:bad('expected_YYYY-MM_or_empty');
  case 'year_or_empty':return typeof value==='string'&&(value===''||/^(19|20)\d{2}$/.test(value))?undefined:bad('expected_YYYY_or_empty');
  case 'enum':return shape.values.includes(value)?undefined:bad('not_allowed');
  case 'array':if(!Array.isArray(value))return bad('not_array');if(value.length>shape.max)return bad('too_many');value.forEach((v,i)=>check(shape.items,v,`${path}[${i}]`,errors));return;
  case 'map':if(value===null||typeof value!=='object'||Array.isArray(value))return bad('not_object');for(const [k,v] of Object.entries(value)){if(k.length>80)bad('key_too_long');if(!shape.values.includes(v))errors.push(`${path}.${k}:not_allowed`)}return;
  case 'object':{
   if(value===null||typeof value!=='object'||Array.isArray(value))return bad('not_object');
   for(const k of Object.keys(value))if(!Object.hasOwn(shape.props,k))errors.push(`${path}.${k}:unknown_key`);
   for(const [k,s] of Object.entries<any>(shape.props)){if(!Object.hasOwn(value,k)){if(!s.optional)errors.push(`${path}.${k}:missing`);continue}check(s,value[k],`${path}.${k}`,errors)}
   return;
  }
 }
}
/** Returns [] when valid; otherwise a list of 'path:reason' strings. Never throws on shape. */
export function validateCv(cv:unknown):string[]{
 const errors:string[]=[];check({t:'object',props:SHAPE},cv,'cv',errors);
 if(!errors.length&&Buffer.byteLength(canonical(cv))>CV_LIMITS.totalBytes)errors.push('cv:too_large');
 return errors;
}
export function emptyCv():Cv{return {identity:{full_name:'',headline:'',email:'',phone:'',city:''},summary:'',experiences:[],education:[],skills:[],languages:[],certifications:[],consent_line:'',presentation:{template_id:'modern',language:'it',section_order:[]},verification:{}}}
// Next useful question. ORDER IS FIXED: name → headline → city → experiences → education → skills → languages.
// A section the user explicitly declared empty is not re-asked: the agent records it with a single empty-marker entry
// via "nessuna" answers (e.g. experiences:[]), which v1 keeps as "still missing" but the agent is told not to insist.
const QUESTIONS:[string,(cv:Cv)=>boolean,string,string][]=[
 ['identity.full_name',cv=>!cv.identity.full_name.trim(),'Come ti chiami? (nome e cognome come vuoi che compaiano sul CV)','What is your full name, as it should appear on the CV?'],
 ['identity.headline',cv=>!cv.identity.headline.trim(),'Qual è il ruolo o titolo professionale che vuoi mettere in alto nel CV?','Which role or professional title should appear at the top of your CV?'],
 ['identity.city',cv=>!cv.identity.city.trim(),'In quale città vivi?','Which city do you live in?'],
 ['experiences',cv=>!cv.experiences.length,'Parliamo delle esperienze di lavoro: qual è l’ultima (ruolo, datore di lavoro, città, da quando a quando)?','Let’s cover work experience: what is your most recent job (role, employer, city, from when to when)?'],
 ['education',cv=>!cv.education.length,'Che studi hai fatto? (titolo, scuola o università, anno)','What is your education? (qualification, school or university, year)'],
 ['skills',cv=>!cv.skills.length,'Quali competenze vuoi indicare? (es. strumenti, macchinari, software)','Which skills would you like to list? (tools, machinery, software)'],
 ['languages',cv=>!cv.languages.length,'Quali lingue parli e a che livello?','Which languages do you speak and at what level?'],
];
export function missingFields(cv:Cv){return QUESTIONS.filter(([,missing])=>missing(cv)).map(([field,,question,question_en])=>({field,question,question_en}))}
const filled=(cv:Cv,section:string)=>{switch(section){case 'identity':return !!(cv.identity.full_name.trim()&&cv.identity.headline.trim()&&cv.identity.city.trim());case 'summary':return !!cv.summary.trim();case 'consent_line':return !!cv.consent_line.trim();default:return Array.isArray((cv as any)[section])&&(cv as any)[section].length>0}};
export function completeness(cv:Cv){const done=CV_SECTIONS.filter(s=>filled(cv,s));return {done:done.length,total:CV_SECTIONS.length,sections:Object.fromEntries(CV_SECTIONS.map(s=>[s,filled(cv,s)]))}}
export function cvCard(cv:Cv){const c=completeness(cv);return {full_name:cv.identity.full_name,headline:cv.identity.headline,template_id:cv.presentation.template_id,language:cv.presentation.language,sections_done:c.done,sections_total:c.total}}
const month=(m:string|null|undefined,current:string)=>!m?current:m.slice(5)+'/'+m.slice(0,4);
// Plain-text projection used as the legacy `content.text` mirror so existing readers/editor still show something readable.
export function cvPlainText(cv:Cv){
 const L=cv.presentation.language,t=(it:string,en:string,bn:string)=>L==='en'?en:L==='bn'?bn:it;
 const now=t('oggi','present','বর্তমান');const out:string[]=[];
 out.push('# '+(cv.identity.full_name||t('Senza nome','Unnamed','নামহীন')));if(cv.identity.headline)out.push(cv.identity.headline);
 const contact=[cv.identity.city,cv.identity.email,cv.identity.phone].filter(Boolean).join(' · ');if(contact)out.push(contact);
 if(cv.summary){out.push('','## '+t('PROFILO','PROFILE','প্রোফাইল'),cv.summary)}
 if(cv.experiences.length){out.push('','## '+t('ESPERIENZA','EXPERIENCE','অভিজ্ঞতা'));for(const e of cv.experiences){out.push(`${e.role} — ${e.employer}${e.city?', '+e.city:''} (${month(e.start,now)} – ${month(e.end,now)})`);for(const b of e.bullets)out.push('- '+b)}}
 if(cv.education.length){out.push('','## '+t('ISTRUZIONE','EDUCATION','শিক্ষা'));for(const e of cv.education)out.push(`${e.title} — ${e.institution}${e.city?', '+e.city:''}${e.end||e.start?' ('+[e.start,e.end].filter(Boolean).map(m=>month(m,now)).join(' – ')+')':''}`)}
 if(cv.skills.length)out.push('','## '+t('COMPETENZE','SKILLS','দক্ষতা'),cv.skills.map(s=>s.level?`${s.name} (${s.level})`:s.name).join(' · '));
 if(cv.languages.length)out.push('','## '+t('LINGUE','LANGUAGES','ভাষা'),cv.languages.map(s=>s.level?`${s.name} (${s.level})`:s.name).join(' · '));
 if(cv.certifications.length)out.push('','## '+t('CERTIFICAZIONI','CERTIFICATIONS','সার্টিফিকেট'),...cv.certifications.map(c=>[c.name,c.issuer,c.year].filter(Boolean).join(' — ')));
 if(cv.consent_line)out.push('',cv.consent_line);
 return out.join('\n');
}
// JSON schema for cv_upsert.facts (model-facing): same closed shape, every key optional so the agent can send one
// section at a time. Kept compact on purpose (it rides in every prompt); the merged CV is strictly re-validated by validateCv.
const S={type:'string'};// tool-side default cap is 100 chars (agent-tools valid()); longer fields declare maxLength explicitly
const jmonth={type:'string',pattern:'^\\d{4}-\\d{2}$'};
const jmonthOrEmpty={type:'string',pattern:'^(\\d{4}-\\d{2})?$'};
const opt=(properties:Record<string,any>)=>({type:'object',additionalProperties:false,properties});// all optional: validator treats missing `required` as []
const list=(max:number,items:any)=>({type:'array',maxItems:max,items});
export const cvFactsSchema=opt({
 identity:opt({full_name:S,headline:S,email:S,phone:S,city:S}),
 summary:{type:'string',maxLength:CV_LIMITS.summary},
 experiences:list(CV_LIMITS.experiences,opt({role:S,employer:S,city:S,start:jmonth,end:{type:['string','null'],pattern:'^\\d{4}-\\d{2}$'},bullets:list(CV_LIMITS.bullets,{type:'string',maxLength:CV_LIMITS.bullet})})),
 education:list(CV_LIMITS.education,opt({title:S,institution:S,city:S,start:jmonthOrEmpty,end:jmonthOrEmpty})),
 skills:list(CV_LIMITS.skills,opt({name:S,level:S})),
 languages:list(CV_LIMITS.languages,opt({name:S,level:{type:'string',enum:CEFR}})),
 certifications:list(CV_LIMITS.certifications,opt({name:S,issuer:S,year:{type:'string',pattern:'^(\\d{4})?$'}})),
 consent_line:{type:'string',maxLength:CV_LIMITS.consent},
 presentation:opt({template_id:{type:'string',enum:[...CV_TEMPLATES]},language:{type:'string',enum:[...CV_LANGUAGES]},section_order:list(CV_SECTIONS.length,{type:'string',enum:[...CV_SECTIONS]})}),
});
export const isCvContent=(content:any)=>!!content&&content.kind==='cv'&&content.schema_version===CV_SCHEMA_VERSION&&!!content.cv;
