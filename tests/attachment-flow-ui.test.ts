import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
declare let current:string;
const CONV='11111111-1111-4111-8111-111111111111';
async function harness(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));const sent:any[]=[];
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/'){let html=await readFile('public/index.html','utf8');html=html.replace('</head>','<script src="/native.js" defer></script></head>');return route.fulfill({body:html,contentType:'text/html'})}
  if(u.pathname==='/native.js')return route.fulfill({body:await readFile('staging/voice-files/public/native.js','utf8'),contentType:'text/javascript'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js','theme.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
  const p=u.pathname.slice(4);const body=route.request().postDataJSON();sent.push({path:p,method:route.request().method(),body});
  if(p==='/workspace')return route.fulfill({json:{conversations:[{id:CONV,title:'Prova'}],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'c'},connections:[],catalog:[]}});
  if(p==='/conversations'&&route.request().method()==='POST')return route.fulfill({status:201,json:{id:CONV,title:body.title}});
  if(/\/messages/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
  if(p==='/files/upload')return route.fulfill({status:201,json:{id:'f1',name:body.name,extraction:{status:'extracted',method:'openpyxl',executed:false}}});
  if(/\/turns$/.test(p))return route.fulfill({status:201,json:{id:'r1',conversationId:CONV,taskId:'t1',status:'queued'}});
  if(p==='/runs/r1')return route.fulfill({json:{id:'r1',status:'completed',taskId:'t1'}});
  if(/\/runs\/r1\/events/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
  return route.fulfill({json:{}});
 });
 await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
 return {browser,page,sent};
}
test('attachment stays pending in the composer until the user sends; text + file go together; remove cancels without any upload',async()=>{
 const {browser,page,sent}=await harness();try{
  await page.evaluate(()=>(window as any).openConversation('11111111-1111-4111-8111-111111111111'));await page.waitForFunction(()=>document.body.dataset.view==='work');
  await page.locator('#file').setInputFiles({name:'turni.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('PK\x03\x04fake')});
  await page.waitForSelector('.attachment-chip:visible');
  assert.equal(sent.filter(x=>x.path==='/files/upload').length,0,'NO upload before send');
  assert.match(await page.locator('.attachment-chip:visible').innerText(),/turni\.xlsx/);
  // Remove → nothing sent, chip gone.
  await page.locator('.attachment-chip:visible button[aria-label="Rimuovi allegato"]').click();assert.equal(await page.locator('.attachment-chip').count(),0);
  assert.equal(sent.filter(x=>x.path==='/files/upload'||/turns$/.test(x.path)).length,0);
  // Attach again, type a message, send → upload first, then the turn with the user's text (file named in it).
  await page.locator('#file').setInputFiles({name:'turni.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('PK\x03\x04fake')});await page.waitForSelector('.attachment-chip:visible');
  await page.fill('#chatinput','Controlla le ore di Amina');await page.locator('[data-action="sendchat"]').click();
  await page.waitForFunction(()=>!document.querySelector('.attachment-chip'));
  const upload=sent.find(x=>x.path==='/files/upload');assert.ok(upload,'upload happens on send');assert.equal(upload.body.conversationId,CONV);assert.equal(upload.body.name,'turni.xlsx');
  const turn=sent.find(x=>/turns$/.test(x.path));assert.ok(turn,'turn sent');assert.ok(sent.indexOf(upload)<sent.indexOf(turn),'upload precedes the turn');
  assert.match(turn.body.text,/Controlla le ore di Amina/);assert.match(turn.body.text,/turni\.xlsx/);
 }finally{await browser.close()}
});
test('file-only send: the turn carries a synthetic attachment message so the agent asks what to do',async()=>{
 const {browser,page,sent}=await harness();try{
  await page.evaluate(()=>(window as any).openConversation('11111111-1111-4111-8111-111111111111'));await page.waitForFunction(()=>document.body.dataset.view==='work');
  await page.locator('#file').setInputFiles({name:'bozza.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('PK\x03\x04fake')});await page.waitForSelector('.attachment-chip:visible');
  const send=page.locator('[data-action="sendchat"]');assert.equal(await send.isDisabled(),false,'send enabled with only an attachment');
  await send.click();await page.waitForFunction(()=>!document.querySelector('.attachment-chip'));
  const turn=sent.find(x=>/turns$/.test(x.path));assert.ok(turn);assert.match(turn.body.text,/bozza\.docx/);assert.match(turn.body.text,/allegato/i);
  assert.equal(sent.filter(x=>x.path==='/files/upload').length,1);
 }finally{await browser.close()}
});
test('attachment from the home composer creates the conversation only on send',async()=>{
 const {browser,page,sent}=await harness();try{
  await page.evaluate(()=>(window as any).home(true));await page.evaluate(()=>{document.body.classList.remove('dashboard-open');document.body.dataset.view='home'});
  await page.locator('#file').setInputFiles({name:'nota.txt',mimeType:'text/plain',buffer:Buffer.from('ciao')});await page.waitForSelector('.attachment-chip:visible');
  assert.equal(sent.filter(x=>x.path==='/conversations'&&x.method==='POST').length,0,'no conversation created yet');
  await page.fill('#homeinput','Riassumi');await page.locator('[data-action="sendhome"]').click();await page.waitForFunction(()=>!document.querySelector('.attachment-chip'));
  const conv=sent.find(x=>x.path==='/conversations'&&x.method==='POST'),up=sent.find(x=>x.path==='/files/upload'),turn=sent.find(x=>/turns$/.test(x.path));
  assert.ok(conv&&up&&turn);assert.ok(sent.indexOf(conv)<sent.indexOf(up)&&sent.indexOf(up)<sent.indexOf(turn));assert.equal(up.body.conversationId,CONV);
 }finally{await browser.close()}
});
