import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
declare let workspace:any;declare let current:string;declare function openArtifact(id:string,show?:boolean):Promise<void>;declare function openConversation(id:string):Promise<void>;
const XLSX='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',DOCX='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('table editor for CSV/XLSX artifacts: cells render, edits save as a new revision, download link points at the generated file; DOCX keeps the text editor',async()=>{
 const appJs=await readFile('public/app.js','utf8');assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(appJs),'textContent only');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));const sent:any[]=[];
  const artifacts=[{id:XLSX,title:'ore.xlsx',current_revision:1,conversation_id:'11111111-1111-4111-8111-111111111111',file:{name:'ore.xlsx',format:'xlsx',entries:[]},cv:null},{id:DOCX,title:'lettera.docx',current_revision:1,conversation_id:'11111111-1111-4111-8111-111111111111',file:{name:'lettera.docx',format:'docx',entries:[]},cv:null}];
  await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
   if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
   for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
   if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
   const p=u.pathname.slice(4);sent.push({path:p,method:route.request().method(),body:route.request().postDataJSON()});
   if(p==='/workspace')return route.fulfill({json:{conversations:[{id:'11111111-1111-4111-8111-111111111111',title:'Office'}],artifacts,runs:[]}});
   if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'c'},connections:[],catalog:[]}});
   if(/\/conversations\/.*\/messages/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
   if(p===`/artifacts/${XLSX}/revisions/1`)return route.fulfill({json:{id:XLSX,revision:1,content:{text:'nome,ore\r\nAmina,38\r\n"Li, Wei",40\r\n',language:'en',file:artifacts[0].file},hash:'h'}});
   if(p===`/artifacts/${XLSX}/revisions/2`)return route.fulfill({json:{id:XLSX,revision:2,content:{text:'nome,ore\r\nAmina,41\r\n"Li, Wei",40\r\nNuovo,\r\n',language:'en',file:artifacts[0].file},hash:'h2'}});
   if(p===`/artifacts/${XLSX}/revisions`&&route.request().method()==='POST'){artifacts[0].current_revision=2;return route.fulfill({status:201,json:{id:XLSX,revision:2}})}
   if(p===`/artifacts/${DOCX}/revisions/1`)return route.fulfill({json:{id:DOCX,revision:1,content:{text:'# Lettera\nTesto',language:'it',file:artifacts[1].file},hash:'h'}});
   return route.fulfill({json:{}});
  });
  await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>openConversation('11111111-1111-4111-8111-111111111111'));await page.waitForFunction(()=>document.body.dataset.view==='work');
  await page.evaluate(id=>openArtifact(id,true),XLSX);await page.waitForSelector('#table:not([hidden])');
  const table=page.locator('#table');assert.equal(await table.locator('thead th').count(),2);assert.equal(await table.locator('tbody tr').count(),2);
  assert.equal(await table.locator('tbody tr').nth(1).locator('td').first().innerText(),'Li, Wei','quoted CSV cell parsed');
  assert.ok((await page.locator('#paper').getAttribute('hidden'))!==null,'text preview hidden for tables');
  assert.match(await page.locator('#download').innerText(),/Scarica ore\.xlsx/);assert.equal(await page.locator('#download').getAttribute('data-href'),`/api/artifacts/${XLSX}/revisions/1/download`);
  // Edit a cell + add a row, save → POST revision with CSV text, reopen shows v2.
  await page.getByRole('button',{name:'Modifica',exact:true}).click();
  const cell=table.locator('tbody tr').first().locator('td').nth(1);await cell.click();await cell.fill('41');
  await page.getByRole('button',{name:'Aggiungi riga',exact:true}).click();assert.equal(await table.locator('tbody tr').count(),3);
  await table.locator('tbody tr').nth(2).locator('td').first().fill('Nuovo');
  assert.match(await page.locator('#saved').innerText(),/non salvata/);
  await page.locator('#save').click();await page.waitForFunction(()=>/Versione 2/.test(document.querySelector('#revisionlabel')!.textContent||''));
  const post=sent.find(x=>x.method==='POST'&&x.path===`/artifacts/${XLSX}/revisions`);assert.ok(post,'revision posted');assert.equal(post.body.baseRevision,1);assert.equal(post.body.content.text,'nome,ore\r\nAmina,41\r\n"Li, Wei",40\r\nNuovo,\r\n');
  assert.equal(await page.locator('#download').getAttribute('data-href'),`/api/artifacts/${XLSX}/revisions/2/download`);
  // DOCX: text editor path, download label uses the real name.
  await page.evaluate(id=>openArtifact(id,true),DOCX);await page.waitForFunction(()=>/lettera\.docx/.test(document.querySelector('#download')!.textContent||''));
  assert.ok((await page.locator('#table').getAttribute('hidden'))!==null);assert.ok((await page.locator('#paper').getAttribute('hidden'))===null);
  assert.equal(await page.locator('#artifacttext').innerText(),'# Lettera\nTesto');
 }finally{await browser.close()}
});
