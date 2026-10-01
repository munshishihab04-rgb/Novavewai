import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';import {buildApp,bootstrap,migrate} from '../src/app.ts';import {webDataRoutes} from '../src/web.ts';import {database,request} from './helpers.ts';
// Appearance: the shell follows the phone (prefers-color-scheme) by default and the user can pin light/dark from settings.
// The preference is stored server-side (user_preferences.theme) so it travels across devices like the language.
test('theme preference: default system, PUT validates light|dark|system, persisted and returned',async()=>{
 const db=await database();await migrate(db.pool);const a=await bootstrap(db.pool);const app=buildApp(db.pool);webDataRoutes(app,db.pool);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});const tok=a.token;const put=(body:any)=>request(base,'/me/preferences',tok,body,'PUT',randomUUID());
  const me=await request(base,'/me/preferences',tok);assert.equal(me.status,200);assert.equal(me.body.theme,'system');
  assert.equal((await put({theme:'neon'})).status,400);assert.equal((await put({theme:1})).status,400);
  const p1=await put({theme:'light'});assert.equal(p1.status,200,JSON.stringify(p1.body));assert.equal(p1.body.theme,'light');assert.equal(p1.body.language.ui,'it','language untouched');
  assert.equal((await request(base,'/me/preferences',tok)).body.theme,'light','persisted');
  const back=await put({theme:'system',language:{ui:'en'}});assert.equal(back.body.theme,'system');assert.equal(back.body.language.ui,'en');
 }finally{await app.close();await db.close()}
});
test('dark.css is tokenised: colours live only in the theme blocks, light block covers every dark token',async()=>{
 const css=await readFile('public/dark.css','utf8');
 const blocks=[...css.matchAll(/(html\[data-theme=(?:dark|light)\](?:,\s*:root)?)\s*\{([^}]*)\}/g)];
 const dark=blocks.find(b=>b[1].startsWith('html[data-theme=dark]'));const light=blocks.find(b=>b[1].startsWith('html[data-theme=light]'));assert.ok(dark&&light,'both theme blocks present');
 const tokens=(b:string)=>new Set([...b.matchAll(/--c-[a-z0-9]+(?=:)/g)].map(m=>m[0]));
 const dt=tokens(dark![2]),lt=tokens(light![2]);assert.ok(dt.size>=80,'dark tokens: '+dt.size);for(const t of dt)assert.ok(lt.has(t),'light block misses '+t);
 const body=css.replace(dark![0],'').replace(light![0],'');
 const raw=[...body.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map(m=>m[0]);assert.deepEqual(raw,[],'raw colours outside theme blocks: '+raw.slice(0,8).join(' '));
 assert.match(css,/color-scheme:\s*dark/);assert.match(css,/color-scheme:\s*light/);
});
test('shell follows the OS scheme, pins from settings, keeps contrast, updates theme-color',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const scheme of ['light','dark'] as const){
   const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:scheme});const sent:any[]=[];let theme:'system'|'light'|'dark'='system';const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
    if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
    for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js','theme.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
    if(/\.(woff2|ttf)$/.test(u.pathname))return route.fulfill({body:await readFile('public'+u.pathname),contentType:'font/woff2'});
    if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});const p=u.pathname.slice(4);const body=route.request().postDataJSON();
    if(p==='/me/preferences'&&route.request().method()==='PUT'){sent.push(body);if(body.theme)theme=body.theme;return route.fulfill({json:{language:{ui:'it',chat:'auto',voice:'auto'},onboarded:true,theme}})}
    if(p==='/me/preferences')return route.fulfill({json:{language:{ui:'it',chat:'auto',voice:'auto'},onboarded:true,theme}});
    if(p==='/workspace')return route.fulfill({json:{conversations:[],artifacts:[],runs:[]}});
    if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt'},connections:[],catalog:[]}});
    if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
    return route.fulfill({json:{}});});
   await page.goto('https://nova.test/');await page.waitForSelector('#nova-dashboard',{state:'visible'});await page.waitForTimeout(150);
   const lum=(c:string)=>{const m=c.match(/\d+(\.\d+)?/g)!.map(Number);const f=(v:number)=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
   const state=async()=>page.evaluate(()=>({theme:document.documentElement.dataset.theme,bg:getComputedStyle(document.body).backgroundColor,fg:getComputedStyle(document.querySelector('.dash-welcome h2')!).color,meta:document.querySelector('meta[name=theme-color]')?.getAttribute('content'),scheme:getComputedStyle(document.documentElement).colorScheme}));
   let s=await state();assert.equal(s.theme,scheme,'system preference follows the OS scheme');assert.equal(s.scheme,scheme);
   const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   if(scheme==='light'){assert.ok(lum(s.bg)>.8,'light bg: '+s.bg);assert.ok(lum(s.fg)<.2,'light fg: '+s.fg)}else{assert.ok(lum(s.bg)<.05,'dark bg: '+s.bg);assert.ok(lum(s.fg)>.7,'dark fg: '+s.fg)}
   assert.ok(contrast(lum(s.bg),lum(s.fg))>=7,'headline contrast '+contrast(lum(s.bg),lum(s.fg)));
   assert.ok(s.meta&&Math.abs(lum(s.meta.length===7?`rgb(${parseInt(s.meta.slice(1,3),16)},${parseInt(s.meta.slice(3,5),16)},${parseInt(s.meta.slice(5,7),16)})`:s.bg)-lum(s.bg))<.1,'theme-color tracks the page background: '+s.meta);
   // pin the opposite theme from settings
   await page.locator('.dash-menu').click();await page.waitForSelector('#drawer[open]');await page.locator('#drawer [data-action="languagesettings"]').click();await page.waitForSelector('#languagedialog[open]');
   const other=scheme==='light'?'dark':'light';await page.selectOption('#themeselect',other);await page.click('#savelanguage');await page.waitForFunction(o=>document.documentElement.dataset.theme===o,other);
   assert.deepEqual(sent.at(-1),{theme:other});s=await state();assert.equal(s.theme,other);assert.equal(s.scheme,other);
   if(other==='light')assert.ok(lum(s.bg)>.8,'pinned light bg: '+s.bg);else assert.ok(lum(s.bg)<.05,'pinned dark bg: '+s.bg);
   // pinned choice survives a reload before the API answers (pre-paint bootstrap)
   await page.reload();const early=await page.evaluate(()=>document.documentElement.dataset.theme);assert.equal(early,other,'bootstrap applies the cached theme before app.js');
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close()}
});
