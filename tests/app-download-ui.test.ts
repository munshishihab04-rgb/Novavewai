import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';
import {UI_STRINGS,LANGUAGES} from '../src/language.ts';import {qrSvg} from '../src/qr.ts';
// "Get the Android app" entry: drawer item + dialog fed by /download/app.json. The link/QR appear only when a signed build exists;
// on a desktop pointer the server-rendered QR hands the public URL to the phone; on a phone only the direct download shows.
const RELEASE={available:true,bytes:436287,sha256:'1378eb8e3609356a899e5ee89c895d1fb786bcbed34875d2234db28198103243',version:'0.1.0',versionCode:1,modified:'2026-10-01T11:25:00.000Z',package:'it.licenzpol.nova'};
async function harness(width:number,release:any,ui='it',loggedIn=true,desktopPointer=true){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width,height:844},hasTouch:!desktopPointer,...(desktopPointer?{}:{isMobile:true})});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const hits:string[]=[];
 if(desktopPointer)await page.emulateMedia({media:'screen'});
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());hits.push(u.pathname);
  if(u.pathname==='/nova/')return route.fulfill({body:(await readFile('public/index.html','utf8')).replace(/(href|src)="\/(?!\/)/g,'$1="/nova/'),contentType:'text/html'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js','theme.js'])if(u.pathname==='/nova/'+f){let body=await readFile('public/'+f,'utf8');if(f.endsWith('.js'))body=body.replace(/request\('\/api'\+p/g,"request('/nova/api'+p").replace(/(['"\\`])\/api\//g,'$1/nova/api/').replace(/(['"\\`])\/auth\//g,'$1/nova/auth/');return route.fulfill({body,contentType:f.endsWith('.js')?'text/javascript':'text/css'})}
  if(u.pathname.endsWith('.ttf'))return route.fulfill({body:await readFile('public/NotoSansBengali-Regular.ttf'),contentType:'font/ttf'});
  if(u.pathname==='/nova/download/app.json')return route.fulfill({json:release});
  if(u.pathname==='/nova/download/qr.svg')return release.available?route.fulfill({body:qrSvg('https://nova.test/nova/download/nova.apk'),contentType:'image/svg+xml'}):route.fulfill({status:404,body:'{}'});
  if(u.pathname==='/nova/download/nova.apk')return route.fulfill({body:'PK',contentType:'application/vnd.android.package-archive',headers:{'content-disposition':'attachment; filename="nova.apk"'}});
  if(!u.pathname.startsWith('/nova/api/'))return route.fulfill({status:404,body:'{}'});
  if(!loggedIn)return route.fulfill({status:401,json:{error:'unauthorized'}});
  const p=u.pathname.slice('/nova/api'.length);
  if(p==='/me/preferences')return route.fulfill({json:{language:{ui,chat:'auto',voice:'auto'},onboarded:true,theme:'light'}});
  if(p==='/workspace')return route.fulfill({json:{conversations:[],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
  if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
  return route.fulfill({json:{}});
 });
 await page.goto('https://nova.test/nova/');
 if(loggedIn)await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);else await page.waitForFunction(()=>!(document.querySelector('#login') as HTMLElement).hidden);
 return {browser,page,errors,hits};
}
test('every language has the get_app strings',()=>{for(const l of LANGUAGES)for(const k of ['get_app','get_app_help','get_app_desktop','get_app_download','get_app_install','get_app_version','get_app_checksum','get_app_unavailable','get_app_copy','get_app_copied'])assert.ok(UI_STRINGS[l][k],l+'.'+k)});
test('desktop: drawer shows the entry with the version, dialog shows QR of the public URL, prefixed download link, version/size/sha256; no page errors',async()=>{
 const {browser,page,errors,hits}=await harness(1280,RELEASE,'it');try{
  // desktop: the dashboard's settings (gear) button opens the same drawer as the phone menu
  await page.locator('.dash-header').getByRole('button',{name:UI_STRINGS.it.settings}).click();await page.waitForSelector('#drawer[open]');
  const entry=page.locator('#drawer button[data-action="getapp"]');assert.ok(await entry.isVisible());assert.equal((await entry.innerText()).replace(/\s+/g,' ').trim(),UI_STRINGS.it.get_app+' v0.1.0');
  await entry.click();await page.waitForSelector('#appdialog[open]');
  assert.equal(await page.locator('#apptitle').innerText(),UI_STRINGS.it.get_app);
  assert.equal(await page.locator('#appunavailable').isVisible(),false);assert.equal(await page.locator('#appavailable').isVisible(),true);
  assert.equal(await page.locator('#appdownload').getAttribute('href'),'/nova/download/nova.apk');assert.equal(await page.locator('#appdownload').getAttribute('download'),'nova.apk');
  assert.equal(await page.locator('#applink').innerText(),'https://nova.test/nova/download/nova.apk');
  assert.equal(await page.locator('#appversion').innerText(),'0.1.0 (1)');assert.equal(await page.locator('#appsize').innerText(),'0.4 MB');assert.equal(await page.locator('#appsha').innerText(),RELEASE.sha256);
  const qr=page.locator('#appqr');assert.equal(await qr.isVisible(),true,'QR visible on desktop');assert.ok(await qr.evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0),'QR image loaded');assert.ok(hits.includes('/nova/download/qr.svg'));
  assert.ok((await page.locator('#appdialog .appqr .settings-help').innerText()).includes(UI_STRINGS.it.get_app_desktop.slice(0,20)));
  await page.locator('#appback').click();await page.waitForFunction(()=>!(document.querySelector('#appdialog') as HTMLDialogElement).open);
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
test('phone: no QR block, direct download link only; Bengali interface strings',async()=>{
 const {browser,page,errors}=await harness(390,RELEASE,'bn',true,false);try{
  await page.locator('.dash-header').getByRole('button',{name:UI_STRINGS.bn.open_menu}).click();await page.waitForSelector('#drawer[open]');
  await page.locator('#drawer button[data-action="getapp"]').click();await page.waitForSelector('#appdialog[open]');
  assert.equal(await page.locator('#apptitle').innerText(),UI_STRINGS.bn.get_app);
  assert.equal(await page.locator('#appdialog .appqr').isVisible(),false,'QR block hidden on touch/phone');
  assert.equal(await page.locator('#appdownload').isVisible(),true);assert.equal(await page.locator('#appdownload span').innerText(),UI_STRINGS.bn.get_app_download);
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
test('no release: drawer entry has no version, dialog says unavailable and shows neither link nor QR; login page hides the APK link',async()=>{
 const {browser,page,errors}=await harness(1280,{available:false},'en');try{
  await page.locator('.dash-header').getByRole('button',{name:UI_STRINGS.en.settings}).click();await page.waitForSelector('#drawer[open]');
  const entry=page.locator('#drawer button[data-action="getapp"]');assert.equal((await entry.innerText()).trim(),UI_STRINGS.en.get_app,'no version label without a release');
  await entry.click();await page.waitForSelector('#appdialog[open]');
  assert.equal(await page.locator('#appunavailable').isVisible(),true);assert.equal(await page.locator('#appavailable').isVisible(),false);assert.equal(await page.locator('#appdownload').isVisible(),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 const n=await harness(1280,{available:false},'it',false);try{assert.equal(await n.page.locator('#loginapp').isVisible(),false)}finally{await n.browser.close()}
});
test('logged-out login page shows the APK link only when a release exists',async()=>{
 const {browser,page}=await harness(390,RELEASE,'it',false);try{
  await page.waitForFunction(()=>!(document.querySelector('#loginapp') as HTMLElement).hidden);
  assert.equal(await page.locator('#loginapplink').getAttribute('href'),'/nova/download/nova.apk');
 }finally{await browser.close()}
});
