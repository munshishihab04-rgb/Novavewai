import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
const CONV='11111111-1111-4111-8111-111111111111';
async function harness(width:number){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));const sent:any[]=[];
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
  const p=u.pathname.slice(4);const body=route.request().postDataJSON();sent.push({path:p,method:route.request().method(),body});
  if(p==='/workspace')return route.fulfill({json:{conversations:[{id:CONV,title:'Turni settimana'},{id:'22222222-2222-4222-8222-222222222222',title:'Lettera al Comune'}],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
  if(p==='/me')return route.fulfill({json:{username:'amina',id:'u1'}});
  if(p==='/conversations'&&route.request().method()==='POST')return route.fulfill({status:201,json:{id:'33333333-3333-4333-8333-333333333333',title:body.title,ephemeral:!!body.ephemeral}});
  if(/\/messages/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
  if(/\/turns$/.test(p))return route.fulfill({status:201,json:{id:'r1',conversationId:body?.conversationId||CONV,taskId:'t1',status:'queued'}});
  if(p==='/runs/r1')return route.fulfill({json:{id:'r1',status:'completed',taskId:'t1'}});
  if(/\/runs\/r1\/events/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
  if(route.request().method()==='DELETE')return route.fulfill({json:{deleted:true}});
  return route.fulfill({json:{}});
 });
 await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
 await page.evaluate(()=>(window as any).openConversation('11111111-1111-4111-8111-111111111111'));await page.waitForFunction(()=>document.body.dataset.view==='work');
 return {browser,page,sent};
}
test('mobile header is clean: menu · logo · temporary chat; drawer lists conversations, settings and account; nothing overflows',async()=>{
 const {browser,page}=await harness(390);try{
  const header=page.locator('.top');assert.ok(await header.isVisible());
  const menu=header.getByRole('button',{name:'Apri menu'}),temp=header.getByRole('button',{name:'Chat temporanea'});
  assert.ok(await menu.isVisible());assert.ok(await temp.isVisible());assert.ok(await header.locator('.mobilebrand').isVisible());
  for(const sel of ['.breadcrumb','.topright .demo','.topright .lang','.mobilehome'])assert.equal(await header.locator(sel).isVisible(),false,sel+' hidden on mobile');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'no horizontal overflow');
  const mb=await menu.boundingBox(),tb=await temp.boundingBox();assert.ok(mb!.width>=40&&mb!.height>=40&&tb!.height>=40,'touch targets');
  // Drawer
  await menu.click();const drawer=page.locator('#drawer');await page.waitForSelector('#drawer[open]');
  const text=await drawer.innerText();for(const s of ['Nuova conversazione','Turni settimana','Lettera al Comune','I miei risultati','Provider e modelli','Lingua','Esporta i miei dati','Esci','amina'])assert.ok(text.includes(s),'drawer has '+s);
  await drawer.getByRole('button',{name:'Lettera al Comune'}).click();await page.waitForFunction(()=>!document.querySelector('#drawer[open]'));
  await page.waitForFunction(()=>document.querySelector('#title')!.textContent==='Lettera al Comune');
 }finally{await browser.close()}
});
test('temporary chat: created with ephemeral flag, labelled, not in the recent list, discardable from the header',async()=>{
 const {browser,page,sent}=await harness(390);try{
  await page.locator('.top').getByRole('button',{name:'Chat temporanea'}).click();
  await page.waitForFunction(()=>document.body.dataset.ephemeral==='1');
  assert.match(await page.locator('#title').innerText(),/temporanea/i);assert.ok(await page.locator('.ephemeral-banner').isVisible());
  await page.fill('#chatinput','ciao');await page.locator('[data-action="sendchat"]').click();await page.waitForFunction((n)=>(window as any).__sentCount===undefined||true,0);
  await page.waitForTimeout(300);
  const created=sent.find(x=>x.path==='/conversations'&&x.method==='POST');assert.ok(created,'conversation created on first send');assert.equal(created.body.ephemeral,true);
  assert.equal(await page.locator('#recent button',{hasText:'Chat temporanea'}).count(),0,'ephemeral never listed as recent');
  const end=page.locator('.top').getByRole('button',{name:'Chiudi chat temporanea'});assert.ok(await end.isVisible());
  page.once('dialog',d=>d.accept());await end.click();await page.waitForFunction(()=>document.body.dataset.ephemeral!=='1');
  const del=sent.find(x=>x.method==='DELETE');assert.ok(del);assert.equal(del.path,'/conversations/33333333-3333-4333-8333-333333333333');
 }finally{await browser.close()}
});
test('desktop keeps sidebar and breadcrumb; the mobile menu button is hidden',async()=>{
 const {browser,page}=await harness(1280);try{
  assert.ok(await page.locator('.sidebar').isVisible());assert.ok(await page.locator('.breadcrumb').isVisible());
  assert.equal(await page.locator('.top').getByRole('button',{name:'Apri menu'}).isVisible(),false);
  assert.ok(await page.locator('.top').getByRole('button',{name:'Chat temporanea'}).isVisible(),'temporary chat is available on desktop too');
 }finally{await browser.close()}
});
