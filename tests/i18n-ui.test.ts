import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
import {UI_STRINGS,LANGUAGES} from '../src/language.ts';
const CONV='11111111-1111-4111-8111-111111111111';
test('every interface language has the same string keys',()=>{const keys=Object.keys(UI_STRINGS.it).sort();for(const l of LANGUAGES)assert.deepEqual(Object.keys(UI_STRINGS[l]).sort(),keys,l);assert.ok(keys.length>30)});
async function harness(width:number,prefs:any){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));const sent:any[]=[];let state={language:{...prefs}};
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
  if(u.pathname.endsWith('.ttf'))return route.fulfill({body:await readFile('public/NotoSansBengali-Regular.ttf'),contentType:'font/ttf'});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
  const p=u.pathname.slice(4);const body=route.request().postDataJSON();sent.push({path:p,method:route.request().method(),body});
  if(p==='/me/preferences'&&route.request().method()==='PUT'){state={language:{...state.language,...body.language}};return route.fulfill({json:state})}
  if(p==='/me/preferences')return route.fulfill({json:state});
  if(p==='/workspace')return route.fulfill({json:{conversations:[{id:CONV,title:'Turni settimana'}],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
  if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
  if(/\/messages/.test(p))return route.fulfill({json:{items:[],nextAfter:null}});
  return route.fulfill({json:{}});
 });
 await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
 return {browser,page,sent};
}
test('interface language follows the saved ui preference (Bengali script and Banglish), independent from chat/voice; Bengali font is declared',async()=>{
 const {browser,page}=await harness(390,{ui:'bn',chat:'auto',voice:'it'});try{
  await page.waitForFunction(()=>document.documentElement.lang==='bn');
  assert.equal(await page.locator('#nova-dashboard h2').first().innerText(),UI_STRINGS.bn.how_help);
  assert.equal(await page.locator('#dashinput').getAttribute('placeholder'),UI_STRINGS.bn.write_message);
  await page.locator('.dash-header').getByRole('button',{name:UI_STRINGS.bn.open_menu}).click();await page.waitForSelector('#drawer[open]');
  const drawer=await page.locator('#drawer').innerText();for(const k of ['new_conversation','conversations','settings','account','logout','language_settings'] as const)assert.ok(drawer.includes(UI_STRINGS.bn[k]),k);
  const css=await readFile('public/dark.css','utf8');assert.match(css,/@font-face\{font-family:'Noto Sans Bengali'/);assert.match(css,/NotoSansBengali-Regular\.ttf/);
  assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Noto Sans Bengali/);
 }finally{await browser.close()}
});
test('language settings panel: three independent selects, saving PUTs only the changed keys, interface re-renders at once',async()=>{
 const {browser,page,sent}=await harness(390,{ui:'it',chat:'auto',voice:'auto'});try{
  await page.locator('.dash-header').getByRole('button',{name:'Apri menu'}).click();await page.waitForSelector('#drawer[open]');
  await page.locator('#drawer').getByRole('button',{name:/Lingua e voce/}).click();await page.waitForSelector('#languagedialog[open]');
  const d=page.locator('#languagedialog');assert.equal(await d.locator('select').count(),3);
  for(const sel of ['#uilang','#chatlang','#voicelang']){const opts=await page.locator(sel+' option').allInnerTexts();assert.ok(opts.some(o=>/Banglish/.test(o)),sel+' offers Banglish');}
  assert.equal(await page.locator('#uilang option').count(),4,'ui has no auto');assert.equal(await page.locator('#chatlang option').count(),5);
  await page.selectOption('#chatlang','bn');await page.selectOption('#uilang','en');await d.getByRole('button',{name:'Salva'}).click();
  await page.waitForFunction(()=>document.documentElement.lang==='en');
  const put=sent.find(x=>x.path==='/me/preferences'&&x.method==='PUT');assert.ok(put);assert.deepEqual(put.body,{language:{ui:'en',chat:'bn'}});
  assert.equal(await page.locator('#nova-dashboard h2').first().innerText(),UI_STRINGS.en.how_help);
 }finally{await browser.close()}
});
test('dashboard (home) on phone uses the same clean header: menu · logo · temporary chat',async()=>{
 const {browser,page}=await harness(390,{ui:'it',chat:'auto',voice:'auto'});try{
  const h=page.locator('.dash-header');assert.ok(await h.getByRole('button',{name:'Apri menu'}).isVisible());assert.ok(await h.getByRole('button',{name:'Chat temporanea'}).isVisible());
  assert.equal(await h.locator('.dash-private').isVisible(),false,'PROVA PRIVATA moved out of the phone header');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  await h.getByRole('button',{name:'Chat temporanea'}).click();await page.waitForFunction(()=>document.body.dataset.ephemeral==='1');
 }finally{await browser.close()}
});
