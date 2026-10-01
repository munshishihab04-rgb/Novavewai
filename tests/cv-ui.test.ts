import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
test('CV artifact card: name/headline, N/8 sezioni, template, Anteprima PDF and Scarica PDF buttons; textContent only; plain artifacts unchanged',async()=>{
 const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(code),'app.js must use textContent only');
 const cards=code.match(/function renderCards\(\)\{[^\n]+/);assert.ok(cards);
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.addInitScript(()=>{(window as any).opened=[];window.open=((u:string)=>{(window as any).opened.push(String(u));return null}) as any});
  await page.setContent('<div id="messages"></div>');await page.evaluate(()=>{(window as any).opened=[];window.open=((u:string)=>{(window as any).opened.push(String(u));return null}) as any});
  await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}function notice(){}function errorText(e){return e.message}async function openArtifact(){}const current='c1';const workspace={artifacts:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'CV — Amina Rahman',current_revision:2,conversation_id:'c1',file:null,cv:{full_name:'<b>Amina</b> Rahman',headline:'Magazziniera',template_id:'modern',language:'it',sections_done:5,sections_total:8}},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'cv-Amina-Rahman-v2-modern-it.pdf',current_revision:1,conversation_id:'c1',file:{name:'cv-Amina-Rahman-v2-modern-it.pdf',format:'pdf',entries:[],cv_export:{artifactId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:2,template:'modern',language:'it'}},cv:null},{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',title:'Lettera',current_revision:1,conversation_id:'c1',file:null,cv:null}]};"+cards[0]});
  await page.evaluate(()=>(window as any).renderCards());
  const cv=page.locator('.resultcard.cv-card');assert.equal(await cv.count(),1);
  const text=await cv.innerText();for(const s of ['<b>Amina</b> Rahman','Magazziniera','5/8 sezioni','Versione 2','Modello: moderno'])assert.ok(text.includes(s),s);
  assert.equal(await page.locator('b').count(),0,'no markup interpretation');
  assert.equal(await cv.getByRole('button',{name:'Anteprima PDF'}).count(),1);
  assert.equal(await cv.getByRole('link',{name:'Scarica PDF'}).count(),1,'download link appears when an export receipt exists for this CV');
  assert.equal(await page.locator('.resultcard').count(),2,'export receipts are folded into the CV card, plain artifacts keep their card');
  assert.match(await cv.locator('a').getAttribute('href')||'',/^\/api\/artifacts\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/revisions\/1\/download$/);
  await cv.getByRole('button',{name:'Anteprima PDF'}).click();const opened:string[]=await page.evaluate(()=>(window as any).opened);
  assert.ok(opened.some(u=>/\/api\/artifacts\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/revisions\/2\/pdf\?template=modern&language=it$/.test(u)),JSON.stringify(opened));
  // Re-render is idempotent.
  await page.evaluate(()=>(window as any).renderCards());assert.equal(await page.locator('.resultcard.cv-card').count(),1);
 }finally{await browser.close()}
});
test('dashboard cv topic still seeds a CV conversation prompt',async()=>{
 const dash=await readFile(new URL('../public/dashboard.js',import.meta.url),'utf8');assert.match(dash,/topicKeys=\['cv'/);assert.match(dash,/T2\('prompt_'\+v\)/,'cv card seeds the translated prompt');const {UI_STRINGS}=await import('../src/language.ts');for(const l of ['it','bn','bn-latn','en'] as const)assert.ok(UI_STRINGS[l].prompt_cv.length>20,l);assert.match(UI_STRINGS.it.prompt_cv,/una domanda alla volta/i);
});
