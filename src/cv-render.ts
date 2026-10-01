// CV PDF projection: the structured revision is rendered by the sandboxed python worker (render-cv mode).
// No photo, no model-authored HTML: the worker receives validated JSON only.
import {renderWorker} from './documents.ts';
import {validateCv,CV_TEMPLATES,CV_LANGUAGES,type Cv,type CvTemplate,type CvLanguage} from './cv-schema.ts';
export async function renderCvPdf(cv:Cv,template:CvTemplate,language:CvLanguage):Promise<Buffer>{
 if(!(CV_TEMPLATES as readonly string[]).includes(template))throw Error('invalid_template');
 if(!(CV_LANGUAGES as readonly string[]).includes(language))throw Error('invalid_language');
 if(validateCv(cv).length)throw Error('invalid_cv');
 return renderWorker('render-cv',Buffer.from(JSON.stringify({cv,template,language})));
}
