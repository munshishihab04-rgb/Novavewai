import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile,mkdir} from 'node:fs/promises';
// Auth card: tabs, validation, API error mapping, invite regression. Backend is routed; the real /auth handlers are covered in accounts.test.ts.
test('auth card UI: tabs, inline Italian errors, show/hide password, register+login calls, invite flow regression, no innerHTML',async()=>{
 const appJs=await readFile('public/app.js','utf8');assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(appJs),'app.js must use textContent only');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const calls:any[]=[];let authed=false;let nextAuth:{status:number,body:any}|null=null;
  await page.route('https://trial.example/**',async route=>{const u=new URL(route.request().url());const path=u.pathname;
   if(path.startsWith('/auth/')){const body=route.request().postDataJSON();calls.push({path,body,headers:route.request().headers()});
    if(path==='/auth/preview')return route.fulfill({json:{welcome:{title:'Benvenuto, Ricky.',message:'Il mio carissimo socio e mentore.'}}});
    if(path==='/auth/logout'){authed=false;return route.fulfill({json:{ok:true}})}
    const r=nextAuth??{status:200,body:{ok:true}};nextAuth=null;if(r.status<300)authed=true;return route.fulfill({status:r.status,json:r.body})}
   if(path.startsWith('/api/'))return authed?route.fulfill({json:{conversations:[],artifacts:[],runs:[]}}):route.fulfill({status:401,json:{error:'unauthorized'}});
   const file=path==='/'?'index.html':path.slice(1);try{const bytes=await readFile('public/'+file);return route.fulfill({body:bytes,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'})}catch{return route.fulfill({status:404})}});
  await page.setViewportSize({width:390,height:844});await page.goto('https://trial.example/');
  await page.waitForSelector('#login:not([hidden])');
  assert.equal(await page.locator('#login .brand').innerText(),'NOVA');
  assert.ok(await page.getByRole('tab',{name:'Accedi'}).isVisible());assert.ok(await page.getByRole('tab',{name:'Crea account'}).isVisible());
  assert.match(await page.locator('#login').innerText(),/Prova pubblica: le conversazioni sono private per account; non inserire dati sensibili\./);
  assert.equal(await page.locator('#enter').isVisible(),false,'invite button hidden without #invite');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow on phone');
  // login tab default
  assert.equal(await page.locator('#authsubmit').innerText(),'Accedi');
  await page.fill('#username','mario');await page.fill('#password','passwordlunga1');
  assert.equal(await page.locator('#password').getAttribute('type'),'password');await page.click('#togglepassword');assert.equal(await page.locator('#password').getAttribute('type'),'text');await page.click('#togglepassword');assert.equal(await page.locator('#password').getAttribute('type'),'password');
  nextAuth={status:401,body:{error:'invalid_credentials'}};await page.click('#authsubmit');await page.waitForFunction(()=>document.querySelector('#autherror')!.textContent!=='');
  assert.equal(await page.locator('#autherror').innerText(),'Credenziali non valide');assert.equal(calls.at(-1).path,'/auth/login');assert.deepEqual(calls.at(-1).body,{username:'mario',password:'passwordlunga1'});assert.equal(calls.at(-1).headers['x-nova-request'],'1');
  nextAuth={status:429,body:{error:'rate_limited',retry_after:300}};await page.click('#authsubmit');await page.waitForFunction(()=>document.querySelector('#autherror')!.textContent!.startsWith('Troppi'));
  assert.equal(await page.locator('#autherror').innerText(),'Troppi tentativi, riprova tra poco');
  // switch to register tab
  await page.getByRole('tab',{name:'Crea account'}).click();assert.equal(await page.locator('#authsubmit').innerText(),'Crea account');assert.equal(await page.locator('#autherror').innerText(),'','switching tabs clears errors');
  assert.equal(await page.getByRole('tab',{name:'Crea account'}).getAttribute('aria-selected'),'true');assert.equal(await page.getByRole('tab',{name:'Accedi'}).getAttribute('aria-selected'),'false');
  // client-side validation, no network
  const before=calls.length;await page.fill('#username','ab');await page.fill('#password','passwordlunga1');await page.click('#authsubmit');assert.equal(await page.locator('#autherror').innerText(),'Nome utente: 3-32 caratteri, solo lettere minuscole, numeri, punto, trattino e underscore');
  await page.fill('#username','mario');await page.fill('#password','corta');await page.click('#authsubmit');assert.equal(await page.locator('#autherror').innerText(),'Password troppo corta: almeno 10 caratteri');assert.equal(calls.length,before,'invalid input must not hit the API');
  await page.fill('#password','passwordlunga1');nextAuth={status:409,body:{error:'username_taken'}};await page.click('#authsubmit');await page.waitForFunction(()=>document.querySelector('#autherror')!.textContent==='Nome già in uso');
  assert.equal(calls.at(-1).path,'/auth/register');assert.deepEqual(calls.at(-1).body,{username:'mario',password:'passwordlunga1'});
  nextAuth={status:403,body:{error:'registration_closed'}};await page.click('#authsubmit');await page.waitForFunction(()=>document.querySelector('#autherror')!.textContent!.includes('chiuse'));
  // XSS-shaped API error must render as text
  nextAuth={status:400,body:{error:'<img src=x onerror=alert(1)>'}};await page.click('#authsubmit');await page.waitForFunction(()=>document.querySelector('#autherror')!.textContent!=='');assert.equal(await page.locator('#autherror img').count(),0);
  // successful register enters the shell
  nextAuth={status:201,body:{ok:true,username:'mario'}};await page.click('#authsubmit');await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);
  assert.equal(await page.locator('#login').isHidden(),true);
  // logout (sidebar button, hidden under the dashboard shell) returns to the card with a clean password field
  await page.evaluate(()=>(document.querySelector('button[data-action="logout"]') as HTMLButtonElement).click());await page.waitForSelector('#login:not([hidden])');assert.equal(calls.at(-1).path,'/auth/logout');assert.equal(await page.locator('#password').inputValue(),'');
  // desktop layout also fits
  await page.setViewportSize({width:1440,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const box=await page.locator('.authcard').boundingBox();assert.ok(box&&box.width<=560&&box.width>=360,'card must be bounded on desktop: '+JSON.stringify(box));
  // invite flow regression: personal welcome for Ricky, no account form
  await page.setViewportSize({width:390,height:844});await page.goto('about:blank');await page.goto('https://trial.example/#invite='+'a'.repeat(43));
  await page.waitForSelector('#login.personal-welcome');
  assert.equal(await page.locator('#login h1').innerText(),'Benvenuto, Ricky.');assert.match(await page.locator('#welcome-message').innerText(),/carissimo socio/);
  assert.equal(await page.getByRole('button',{name:'Scopri NOVA'}).isVisible(),true);assert.equal(await page.locator('#authform').isVisible(),false,'account form hidden in invite mode');
  assert.equal(await page.locator('#login .capabilities').innerText(),'Anteprima privata · Il tuo invito resta valido fino al primo accesso.');
  await page.getByRole('button',{name:'Scopri NOVA'}).click();await page.waitForFunction(()=>!(document.querySelector('#shell') as HTMLElement).hidden);assert.equal(calls.at(-1).path,'/auth/exchange');assert.equal(calls.at(-1).body.invite,'a'.repeat(43));
  if(process.env.AUTH_EVIDENCE){await mkdir(process.env.AUTH_EVIDENCE,{recursive:true});authed=false;for(const [w,h,name] of [[1440,950,'desktop'],[390,844,'mobile']] as const){await page.setViewportSize({width:w,height:h});await page.goto('https://trial.example/');await page.waitForSelector('#login:not([hidden])');await page.screenshot({path:`${process.env.AUTH_EVIDENCE}/auth-card-${name}.png`,fullPage:true});await page.getByRole('tab',{name:'Crea account'}).click();await page.screenshot({path:`${process.env.AUTH_EVIDENCE}/auth-card-${name}-register.png`,fullPage:true})}}
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
