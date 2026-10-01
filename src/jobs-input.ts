// Bounded lexical extraction, not universal semantic understanding. Unknown or
// ambiguous prose asks a question; a model proposal is never city evidence.
export const normalizeJobText=(s:string)=>s.normalize('NFKC').replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
export function validJobTerm(s:string,max=100){return s.length>=2&&s.length<=max&&/[\p{L}]/u.test(s)&&/^[\p{L}\p{M}\d .'+#()\/-]+$/u.test(s)&&!/(?:https?|javascript|data):|www\.|\b(?:site|OR|AND)\b|\.\.|[\r\n]/.test(s)}
export const explicitRemote=(s:string)=> /\b(?:remoto|remote|da remoto|da casa|smart working)\b/i.test(s)&&!/\b(?:non|no|senza)\s+(?:da\s+)?(?:remoto|remote|smart working)/i.test(s);
export function strictEmployerPreference(turns:string[]){let strict=false;for(const t of turns){if(/senza agenzie|niente agenzie|no agenc|only direct|solo aziende|senza intermediari|solo datori diretti|direct employers only/i.test(t))strict=true;if(/anche (?:le )?agenzie|con agenzie|agenzie (?:vanno )?bene|non (?:escludere|escludo) (?:le )?agenzie|agencies (?:are )?ok/i.test(t))strict=false;}return strict;}
const cap=(s:string)=>s.replace(/(^|[ -])\p{L}/gu,x=>x.toUpperCase()).replace(/\b(Di|Del|Della|Dei|In)\b/g,x=>x.toLowerCase());
export function cityFromText(raw:string):string|undefined{
 const t=normalizeJobText(raw);
 if(/\b(?:bravo|brava|so|imparo)\s+a\s+/i.test(t)&&!/(?:città:|citta:|\s(?:a|in)\s+[A-ZÀ-Ý])/.test(t))return undefined;
 // A correction's positive branch wins, never the rejected location.
 const positive=t.split(/\s+(?:invece di|anziché|anziche|non a|non in)\s+/i)[0];
 const matches=[...positive.matchAll(/(?:^|\s)(?:a|in|near|city:|città:|citta:)\s+([\p{L}][\p{L}\p{M}' -]{1,79})/giu)];
 let city=matches.at(-1)?.[1]?.split(/\s+(?:senza|con|per|come|solo|anche|part[ -]time|full[ -]time|da remoto|remoto|remote)\b|[,;.!?]/i)[0]?.trim();
 if(city&&/\s+(?:o|oppure|or|e)\s+/i.test(city))return undefined;
 if(city&&validJobTerm(city,80))return /[A-ZÀ-Ý]/.test(city)?city:cap(city.toLowerCase());
 return undefined;
}
export function occupationFromText(raw:string,city?:string):string|undefined{
 let t=normalizeJobText(raw).toLowerCase();
 if(/[:;<>=@\\\[\]{}|&%!?\r\n]/.test(raw)||/\b(?:https?|javascript|site):|www\./i.test(raw))return undefined;
 if(city){const escaped=city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');t=t.replace(new RegExp(`(?:\\s+(?:a|in|near))?\\s+${escaped}(?:\\s.*)?$`,'i'),'');}
 t=t.replace(/^(?:cerco|cerca|trova|vorrei|voglio|sto cercando|looking for|find)\s+(?:(?:un|un altro|un lavoro|lavoro|offerte di lavoro|offerte|a job|jobs)\s*)?(?:(?:come|da|di|as)\s+)?/i,'').replace(/^lavoro\s+(?:come|da|di)\s+/,'');
 t=t.split(/\s+(?:senza agenzie|niente agenzie|anche agenzie|con agenzie|solo aziende|senza intermediari|no agenc|only direct|part[ -]time|full[ -]time|non |invece di)/i)[0];
 t=t.replace(/\b(?:da remoto|remoto|remote|da casa|smart working)\b/gi,'').trim();
 if(/\b(?:cucinar\w*|cucinare|bravo a cucin\w*)\b/.test(t))return 'cuoco';
 if(/camerier\w*\s+(?:ai|a[i]?|dei)\s+piani/.test(t))return 'cameriere ai piani';
 if(/^(?:cameriere|cameriera|cameriere\/a)(?: (?:di |in )?sala)?$/.test(t))return 'cameriere';
 // Compatibility for old free-form role clues; these are hypotheses, not credentials.
 if(/^mi chiamo .*\bcerco cameriere$/.test(t))return 'cameriere';
 if(!validJobTerm(t)||/\b(?:cerco|cerca|sono|non|ora|invece|lavoro|offerte|agenzie|bene|città|city|oppure)\b/i.test(t)||t.split(' ').length>8)return undefined;
 return t;
}
