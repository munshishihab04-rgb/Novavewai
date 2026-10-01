import test from 'node:test';import assert from 'node:assert/strict';
import {validateCv,missingFields,completeness,emptyCv,CV_SECTIONS,cvPlainText,cvCard} from '../src/cv-schema.ts';
const sample=()=>({...emptyCv(),identity:{full_name:'Amina Rahman',headline:'Magazziniera',email:'amina@example.org',phone:'',city:'Bologna'},summary:'',
 experiences:[{role:'Magazziniera',employer:'Logistica Srl',city:'Bologna',start:'2022-03',end:null,bullets:['Gestione inventario','Controllo merci']}],
 education:[{title:'Diploma',institution:'Istituto Aldini',city:'Bologna',start:'',end:'2019-07'}],skills:[{name:'Excel',level:'intermedio'}],languages:[{name:'Italiano',level:'B2'},{name:'Bengalese',level:'madrelingua'}],certifications:[],consent_line:'',
 presentation:{template_id:'modern' as const,language:'it' as const,section_order:[] as string[]}});
test('cv schema: valid sample passes, closed object, enums, month format, no photo',()=>{
 assert.deepEqual(validateCv(sample()),[]);
 assert.ok(validateCv({...sample(),photo:'x'}).some(e=>e.includes('photo')||e.includes('unknown')),'closed schema rejects photo/unknown keys');
 assert.ok(validateCv({...sample(),presentation:{template_id:'fancy',language:'it',section_order:[]}}).length,'unknown template rejected');
 assert.ok(validateCv({...sample(),presentation:{template_id:'modern',language:'de',section_order:[]}}).length,'unknown language rejected');
 const bad=sample();bad.experiences[0].start='03/2022';assert.ok(validateCv(bad).some(e=>e.includes('start')),'start must be YYYY-MM');
 const lang=sample();lang.languages[0].level='fluente' as any;assert.ok(validateCv(lang).length,'language level must be CEFR or madrelingua');
});
test('cv schema: size caps reject oversized content',()=>{
 const big=sample();big.summary='x'.repeat(1201);assert.ok(validateCv(big).some(e=>e.includes('summary')));
 const many=sample();many.experiences=Array.from({length:21},()=>many.experiences[0]);assert.ok(validateCv(many).some(e=>e.includes('experiences')));
 const bullets=sample();bullets.experiences[0].bullets=Array.from({length:9},()=>'b');assert.ok(validateCv(bullets).some(e=>e.includes('bullets')));
 const total=sample();total.experiences=Array.from({length:20},(_,i)=>({...total.experiences[0],bullets:Array.from({length:8},()=>'y'.repeat(150))}));assert.ok(validateCv(total).some(e=>e.includes('too_large')),'total canonical size cap');
});
test('missingFields asks one question at a time in the fixed order name → headline → city → experiences → education → skills → languages',()=>{
 const cv=emptyCv();const order:string[]=[];
 let next=missingFields(cv);order.push(next[0].field);cv.identity.full_name='Amina Rahman';
 next=missingFields(cv);order.push(next[0].field);cv.identity.headline='Magazziniera';
 next=missingFields(cv);order.push(next[0].field);cv.identity.city='Bologna';
 next=missingFields(cv);order.push(next[0].field);cv.experiences.push({role:'Magazziniera',employer:'Logistica Srl',city:'Bologna',start:'2022-03',end:null,bullets:[]});
 next=missingFields(cv);order.push(next[0].field);cv.education.push({title:'Diploma',institution:'Istituto',city:'',start:'',end:''});
 next=missingFields(cv);order.push(next[0].field);cv.skills.push({name:'Excel',level:''});
 next=missingFields(cv);order.push(next[0].field);cv.languages.push({name:'Italiano',level:'B2'});
 assert.deepEqual(order,['identity.full_name','identity.headline','identity.city','experiences','education','skills','languages']);
 assert.deepEqual(missingFields(cv),[]);
 assert.match(missingFields(emptyCv())[0].question,/nome/i);
 assert.match(missingFields(emptyCv())[0].question_en,/name/i);
});
test('completeness counts 8 sections from real data, never a percentage; card and plain text are projections',()=>{
 assert.equal(CV_SECTIONS.length,8);
 const empty=completeness(emptyCv());assert.equal(empty.done,0);assert.equal(empty.total,8);
 const c=completeness(sample());assert.equal(c.total,8);assert.equal(c.done,5,JSON.stringify(c));
 const card=cvCard(sample());assert.equal(card.full_name,'Amina Rahman');assert.equal(card.template_id,'modern');assert.equal(card.sections_done,5);assert.equal(card.sections_total,8);
 const text=cvPlainText(sample());assert.ok(text.includes('Amina Rahman'));assert.ok(text.includes('Logistica Srl'));assert.ok(text.includes('03/2022'));assert.ok(/oggi/i.test(text));
});
