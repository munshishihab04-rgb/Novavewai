// Visual evidence for the Android app download entry (mocked API, real public/ files). Writes evidence/app-download/*.png
import {chromium} from 'playwright';import {readFile,mkdir} from 'node:fs/promises';import {qrSvg} from '../src/qr.ts';
const RELEASE={available:true,bytes:436287,sha256:'1378eb8e3609356a899e5ee89c895d1fb786bcbed34875d2234db28198103243',version:'0.1.0',versionCode:1,package:'it.licenzpol.nova'};
await mkdir('evidence/app-download',{recursive:true});
async function shot(width:number,ui:string,theme:string,name:string,mobile=false){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width,height:mobile?844:800},hasTouch:mobile,isMobile:mobile,colorScheme:theme as any});const page=await ctx.newPage();
 await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
  for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js','theme.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
  if(u.pathname.endsWith('.ttf'))return route.fulfill({body:await readFile('public/NotoSansBengali-Regular.ttf'),contentType:'font/ttf'});
  if(u.pathname.endsWith('.woff2'))return route.fulfill({body:await readFile('public'+u.pathname),contentType:'font/woff2'});
  if(u.pathname==='/download/app.json')return route.fulfill({json:RELEASE});
  if(u.pathname==='/download/qr.svg')return route.fulfill({body:qrSvg('https://licenzpol.it/nova/download/nova.apk'),contentType:'image/svg+xml'});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
  const p=u.pathname.slice(4);
  if(p==='/me/preferences')return route.fulfill({json:{language:{ui,chat:'auto',voice:'auto'},onboarded:true,theme}});
  if(p==='/workspace')return route.fulfill({json:{conversations:[],artifacts:[],runs:[]}});
  if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
  if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
  return route.fulfill({json:{}})});
 await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);await page.waitForTimeout(300);
 await page.locator('.dash-header button[data-action="menu"]:visible').first().click();await page.waitForSelector('#drawer[open]');await page.waitForTimeout(350);
 await page.screenshot({path:`evidence/app-download/${name}-drawer.png`});
 await page.locator('#drawer button[data-action="getapp"]').click();await page.waitForSelector('#appdialog[open]');await page.waitForTimeout(400);
 await page.screenshot({path:`evidence/app-download/${name}-dialog.png`});
 await browser.close();console.log('wrote',name);
}
await shot(1280,'it','light','desktop-it-light');
await shot(1280,'bn','dark','desktop-bn-dark');
await shot(390,'bn','light','phone-bn-light',true);
await shot(390,'en','dark','phone-en-dark',true);
