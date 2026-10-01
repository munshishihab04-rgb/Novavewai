import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {buildApp,migrate} from '../src/app.ts';import {buildWeb} from '../src/web.ts';import {database} from './helpers.ts';
// Premium shell: one icon family (stroke SVG from the sprite/icons.js, no emoji/text glyphs), Inter self-hosted (CSP font-src 'self'),
// drawer reorganised: primary nav → recent → preferences → pinned account; voice/web search are composer features, not settings.
test('premium ui: Inter self-hosted, single icon family, no text glyph icons',async()=>{
 const db=await database();await migrate(db.pool);const core=buildApp(db.pool);const web=await buildWeb(core,db.pool,{});const base=await web.listen({port:0,host:'127.0.0.1'});
 try{
  for(const f of ['/fonts/Inter-latin.woff2','/fonts/Inter-latin-ext.woff2']){const r=await fetch(base+f);assert.equal(r.status,200,f);assert.match(r.headers.get('content-type')!,/font\/woff2/);assert.ok((await r.arrayBuffer()).byteLength>10000,f+' is a real font')}
  const css=await (await fetch(base+'/dark.css')).text();
  assert.match(css,/@font-face\{font-family:'Inter';src:url\('\/fonts\/Inter-latin\.woff2'\)/,'Inter declared from own origin');
  assert.doesNotMatch(css,/Segoe UI/,'no platform-default font left in the dark shell');assert.doesNotMatch(await (await fetch(base+'/style.css')).text(),/Segoe UI/);
  assert.doesNotMatch(css,/fonts\.googleapis|fonts\.gstatic/,'no third-party font requests');
  const appJs=await (await fetch(base+'/app.js')).text();assert.doesNotMatch(appJs,/compariranno qui/,'drawer empty state must go through i18n, not hardcoded Italian');
  const html=await (await fetch(base+'/')).text();
  assert.doesNotMatch(html,/[✕✓→←⚙☰]/,'no text glyphs used as icons in the shell');
  const start=html.indexOf('<dialog id="drawer"');const drawer=html.slice(start,html.indexOf('</dialog>',start));
  const buttons=drawer.match(/<button[^>]*data-action="[a-z]+"[^>]*>(.*?)<\/button>/gs)!;assert.ok(buttons.length>=9,'drawer rows: '+buttons.length);
  for(const b of buttons)assert.match(b,/<svg><use href="#i-[a-z-]+"\/><\/svg>/,'drawer row without icon: '+b.slice(0,90));
  assert.doesNotMatch(drawer,/data-action="voice"|data-action="research"/,'voice/web search live in the composer, not in the drawer');
  // every <use href="#x"> resolves to a sprite symbol, and sprite geometry == icons.js geometry (one family, two render paths)
  const symbols=Object.fromEntries([...html.matchAll(/<symbol id="i-([a-z-]+)" viewBox="0 0 24 24">(.*?)<\/symbol>/g)].map(m=>[m[1],m[2]]));
  const used=new Set([...html.matchAll(/href="#i-([a-z-]+)"/g)].map(m=>m[1]));for(const u of used)assert.ok(symbols[u],'sprite symbol missing: '+u);
  // sprite ids are namespaced so they can never collide with element ids the app reads/writes (#download, #input …)
  const ids=[...html.matchAll(/ id="([a-zA-Z-]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'duplicate ids in index.html');
  const icons=await (await fetch(base+'/icons.js')).text();const glyphs=Object.fromEntries([...icons.matchAll(/\n (\w+):'<svg viewBox="0 0 24 24">(.*?)<\/svg>'/g)].map(m=>[m[1],m[2]]));
  for(const [k,v] of Object.entries(symbols))assert.equal(v,glyphs[k],'sprite/icons.js drift for '+k);
  assert.doesNotMatch(icons,/viewBox="0 0 32 32"|stroke-width=/,'icons.js is one 24-grid family; weight comes from CSS');
  for(const k of ['sidebar','timer','search','languages','sparkles','paperclip','mic','send','plus','chat','doc','logout','download','book','sliders','x','user','edit','folder'])assert.ok(glyphs[k],'icon missing: '+k);
 }finally{await web.close();await db.close()}
});
test('premium ui: drawer fits a phone, rows on a 48px grid, icons share one edge/size, account pinned; dashboard hides see-all on single-card rails',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const convs=Array.from({length:12},(_,i)=>({id:'c'+i,title:'Conversazione numero '+(i+1)+' con un titolo abbastanza lungo',updated_at:new Date().toISOString()}));
  await page.route('https://nova.test/**',async route=>{const u=new URL(route.request().url());
   if(u.pathname==='/')return route.fulfill({body:await readFile('public/index.html','utf8'),contentType:'text/html'});
   for(const f of ['app.js','style.css','dark.css','icons.js','features.js','dashboard.js','i18n.js'])if(u.pathname==='/'+f)return route.fulfill({body:await readFile('public/'+f,'utf8'),contentType:f.endsWith('.js')?'text/javascript':'text/css'});
   if(u.pathname.endsWith('.woff2'))return route.fulfill({body:await readFile('public'+u.pathname),contentType:'font/woff2'});
   if(u.pathname.endsWith('.ttf'))return route.fulfill({body:await readFile('public/NotoSansBengali-Regular.ttf'),contentType:'font/ttf'});
   if(!u.pathname.startsWith('/api/'))return route.fulfill({status:404,body:'{}'});
   const p=u.pathname.slice(4);
   if(p==='/me/preferences')return route.fulfill({json:{language:{ui:'it',chat:'auto',voice:'auto'},onboarded:true}});
   if(p==='/workspace')return route.fulfill({json:{conversations:convs,artifacts:[],runs:[]}});
   if(p.startsWith('/providers'))return route.fulfill({json:{selection:{provider:'nova',model:'gpt-5.4-mini'},connections:[],catalog:[]}});
   if(p==='/me')return route.fulfill({json:{username:'amina',kind:'account'}});
   return route.fulfill({json:{}});
  });
  await page.goto('https://nova.test/');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);await page.waitForSelector('#nova-dashboard',{state:'visible'});
  await page.evaluate(()=>document.fonts.ready);
  assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/^Inter\b/);assert.ok(await page.evaluate(()=>document.fonts.check('500 16px Inter')),'Inter loaded');
  const sees=await page.$$eval('.dash-see',n=>n.map(e=>({visible:(e as HTMLElement).offsetParent!==null,cards:e.closest('.dash-section')!.querySelectorAll('.dash-card').length})));
  assert.ok(sees.length>0);for(const s of sees)assert.equal(s.visible,s.cards>=2,'see-all hint visibility must follow card count: '+JSON.stringify(s));
  // at scroll end the last rail clears the sticky composer; a single-card rail fills the content width
  await page.evaluate(()=>{const d=document.querySelector('#nova-dashboard')!;d.scrollTop=d.scrollHeight});await page.waitForTimeout(150);
  const clear=await page.evaluate(()=>{const last=[...document.querySelectorAll('.dash-section')].at(-1)!;const dock=document.querySelector('.dash-composer-dock')!.getBoundingClientRect();const card=last.querySelector('.dash-card')!.getBoundingClientRect();const rail=document.querySelector('.dash-rail')!;return{clear:card.bottom<=dock.top,single:rail.querySelectorAll('.dash-card').length===1,cardW:rail.querySelector('.dash-card')!.getBoundingClientRect().width,railW:rail.getBoundingClientRect().width-34}});
  assert.ok(clear.clear,'last rail hidden under the composer at scroll end');if(clear.single)assert.ok(clear.cardW>=clear.railW-2,'single model card should span the rail: '+clear.cardW+' vs '+clear.railW);
  await page.evaluate(()=>{document.querySelector('#nova-dashboard')!.scrollTop=0});
  // header controls share one shape family (same radius)
  const radii=await page.$$eval('.dash-header button',n=>n.filter(b=>(b as HTMLElement).offsetParent).map(b=>getComputedStyle(b).borderRadius));assert.ok(new Set(radii).size<=1,'header control radii: '+radii);
  await page.locator('.dash-menu').click();await page.waitForSelector('#drawer[open]');await page.waitForTimeout(150);
  const geo=await page.evaluate(()=>{const d=document.querySelector('#drawer')!;const rows=[...d.querySelectorAll('button[data-action]')].map(b=>{const r=b.getBoundingClientRect();const svg=b.querySelector('svg')?.getBoundingClientRect();return{action:(b as HTMLElement).dataset.action,h:Math.round(r.height),icon:svg?Math.round(svg.left):null,size:svg?Math.round(svg.width):null}});const acc=d.querySelector('.draweraccount')!.getBoundingClientRect();return{rows,accountTop:acc.top,accountBottom:acc.bottom,vh:innerHeight,scrollH:d.scrollHeight,clientH:d.clientHeight,recent:d.querySelectorAll('#drawerrecent button').length}});
  const nav=geo.rows.filter(r=>!['closemenu','new'].includes(r.action!));
  assert.ok(new Set(nav.map(r=>r.icon)).size===1,'icons share one left edge: '+JSON.stringify(nav.map(r=>[r.action,r.icon])));
  assert.ok(new Set(nav.map(r=>r.size)).size===1,'icons share one size: '+JSON.stringify(nav.map(r=>[r.action,r.size])));
  for(const r of nav)assert.equal(r.h,48,`row ${r.action} height ${r.h}`);
  assert.equal(geo.recent,12);assert.ok(geo.scrollH<=geo.clientH+1,'drawer must not scroll as a whole (recent list scrolls internally): '+geo.scrollH+' > '+geo.clientH);
  assert.ok(geo.accountBottom<=geo.vh&&geo.accountTop>geo.vh*0.6,'account pinned at the bottom and fully visible');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'evidence/premium-ui/drawer-phone.png'});
 }finally{await browser.close()}
});
