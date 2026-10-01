import test from 'node:test';import assert from 'node:assert/strict';
import {extractPdf} from '../src/documents.ts';
import {renderCvPdf} from '../src/cv-render.ts';
import {emptyCv} from '../src/cv-schema.ts';
const cv=()=>({...emptyCv(),identity:{full_name:'Amina Rahman',headline:'Magazziniera',email:'amina@example.org',phone:'+39 333 0000000',city:'Bologna'},summary:'Tre anni di esperienza in logistica.',
 experiences:[{role:'Magazziniera',employer:'Logistica Srl',city:'Bologna',start:'2022-03',end:null,bullets:['Gestione inventario con <b>tag</b> & simboli','Controllo merci in ingresso']},{role:'Operaia',employer:'Tessile SpA',city:'Prato',start:'2019-01',end:'2021-12',bullets:['Linea di confezionamento']}],
 education:[{title:'Diploma di maturità',institution:'Istituto Aldini',city:'Bologna',start:'',end:'2018-07'}],skills:[{name:'Excel',level:'intermedio'},{name:'Muletto',level:''}],languages:[{name:'Italiano',level:'B2'},{name:'Bengalese',level:'madrelingua'}],certifications:[{name:'Patentino muletto',issuer:'Ente formazione',year:'2022'}],consent_line:'Autorizzo il trattamento dei miei dati personali ai sensi del D.Lgs. 196/2003 e del GDPR (Reg. UE 2016/679).'});
test('render-cv: all three templates produce a real PDF containing the name, employer and consent line; markup is escaped',async()=>{
 for(const template of ['modern','classic','professional'] as const){
  const pdf=await renderCvPdf(cv(),template,'it');assert.equal(pdf.subarray(0,5).toString(),'%PDF-',template);
  const text=await extractPdf(pdf);for(const s of ['Amina Rahman','Logistica Srl','Istituto Aldini','Bengalese','GDPR'])assert.ok(text.text.includes(s),`${template}: ${s}`);
  assert.ok(text.text.includes('<b>tag</b>'),template+' markup must be escaped, i.e. shown literally, not interpreted');
 }
});
test('render-cv: unknown template and invalid cv are rejected before the worker runs; English labels follow document language',async()=>{
 await assert.rejects(renderCvPdf(cv(),'fancy' as any,'it'),/invalid_template/);
 await assert.rejects(renderCvPdf({...cv(),photo:'x'} as any,'modern','it'),/invalid_cv/);
 const text=await extractPdf(await renderCvPdf(cv(),'classic','en'));assert.ok(text.text.includes('Experience')||text.text.includes('EXPERIENCE'));assert.ok(/present/i.test(text.text));
});
test('render-cv: Bengali content and bn labels use the bundled Noto Sans Bengali font and survive text extraction',async()=>{
 const bn={...cv(),identity:{full_name:'আমিনা রহমান',headline:'গুদাম কর্মী',email:'',phone:'',city:'বোলোনিয়া'},presentation:{template_id:'modern' as const,language:'bn' as const,section_order:[]}};
 for(const template of ['modern','classic','professional'] as const){const pdf=await renderCvPdf(bn,template,'bn');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.toString('latin1').includes('NotoSansBengali'),template+' embeds Noto Sans Bengali');const text=await extractPdf(pdf);assert.ok(text.text.includes('Logistica Srl'),template);}
 const latin=await renderCvPdf(cv(),'modern','it');assert.ok(!latin.toString('latin1').includes('NotoSansBengali'),'latin-only CV keeps DejaVu');
});
