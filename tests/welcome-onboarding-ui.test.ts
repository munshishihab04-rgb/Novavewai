import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
import {UI_STRINGS} from '../src/language.ts';
async function harness(width:number,onboarded:boolean){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));const sent:any[]=[];let state:any={language:{ui:'it',chat:'auto',voice:'auto'},onboarded};
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js','theme.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
  if(u.pathname.endsWith('.ttf'))return route.fulfill({body:await readFile('public/NotoSansBengali-Regular.ttf'),contentType:'font/ttf'});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
  const p=u.pathname.slice(4);const body=route.request().postDataJSON();sent.push({path:p,method:route.request().method(),body});
  if(p==='/me/preferences'&&route.request().method()==='PUT'){state={...state,language:{...state.language,...(body.language||{})},onboarded:body.onboarded===true?true:state.onboarded};return route.fulfill({json:state})}
  if(p==='/me/preferences')return route.fulfill({json:state});
  if(p==='/workspace')return route.fulfill({json:{conversations:[],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
  if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
  return route.fulfill({json:{}});
 });
 await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
 return {browser,page,sent,state:()=>state};
}
test('first visit: welcome asks the language first (each option in its own language), then shows info cards in the chosen language, saves ui+chat+voice and onboarded once; never shown again',async()=>{
 const {browser,page,sent,state}=await harness(390,false);try{
  await page.waitForSelector('#welcome[open]');
  const w=page.locator('#welcome');
  // step 1: language — four options, each labelled in its own language, nothing else translated yet
  const opts=w.locator('[data-welcome-lang]');assert.equal(await opts.count(),4);
  const labels=await opts.allInnerTexts();assert.ok(labels.some(l=>l.includes('Italiano')));assert.ok(labels.some(l=>l.includes('বাংলা')));assert.ok(labels.some(l=>l.includes('Banglish')));assert.ok(labels.some(l=>l.includes('English')));
  assert.equal(await w.locator('.welcome-card').count(),0,'info cards come after the language choice');
  await w.locator('[data-welcome-lang="bn"]').click();
  // step 2: info cards already in Bengali, interface already in Bengali behind the dialog
  await page.waitForFunction(()=>document.documentElement.lang==='bn');
  const cards=w.locator('.welcome-card');assert.equal(await cards.count(),3);
  const txt=await w.innerText();for(const k of ['welcome_card1_title','welcome_card2_title','welcome_card3_title','welcome_note'] as const)assert.ok(txt.includes(UI_STRINGS.bn[k]),k);
  assert.ok(!txt.includes(UI_STRINGS.it.welcome_card1_title),'no Italian leftovers');
  assert.equal(await page.locator('#nova-dashboard h2').first().innerText(),UI_STRINGS.bn.how_help);
  // user can change their mind: back to the language step
  await w.getByRole('button',{name:UI_STRINGS.bn.welcome_change_language}).click();assert.equal(await opts.count(),4);
  await w.locator('[data-welcome-lang="en"]').click();await page.waitForFunction(()=>document.documentElement.lang==='en');
  await w.getByRole('button',{name:UI_STRINGS.en.welcome_start}).click();
  await page.waitForFunction(()=>!document.querySelector('#welcome[open]'));
  const puts=sent.filter(s=>s.path==='/me/preferences'&&s.method==='PUT');
  assert.deepEqual(puts.at(-1)!.body,{language:{ui:'en',chat:'en',voice:'en'},onboarded:true},'one save with all three languages aligned + onboarded');
  assert.equal(state().onboarded,true);
  assert.ok(!(await page.locator('#welcome').innerHTML()).includes('<script'),'textContent only');
  // reload: not shown again
  await page.reload();await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);await page.waitForTimeout(300);
  assert.equal(await page.locator('#welcome[open]').count(),0);
  assert.equal(await page.locator('#nova-dashboard h2').first().innerText(),UI_STRINGS.en.how_help);
 }finally{await browser.close()}
});
test('returning user never sees the welcome; it can be reopened from the menu',async()=>{
 const {browser,page}=await harness(1366,true);try{
  await page.waitForTimeout(300);assert.equal(await page.locator('#welcome[open]').count(),0);
  await page.locator('.dash-header .dash-settings').click();await page.waitForSelector('#drawer[open]');await page.locator('#drawer [data-action="welcome"]').click();await page.waitForSelector('#welcome[open]');assert.equal(await page.locator('#welcome .welcome-card').count(),3,'reopened guide starts at the cards, in the current language');
 }finally{await browser.close()}
});
