// Public readback: logged-out login page on licenzpol.it/nova shows the APK link (no credentials involved).
import {chromium} from 'playwright';import {mkdir} from 'node:fs/promises';
await mkdir('evidence/app-download',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const [name,vp,mobile] of [['public-login-desktop',{width:1280,height:800},false],['public-login-phone',{width:390,height:844},true]] as const){
 const ctx=await browser.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile});const page=await ctx.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://licenzpol.it/nova/?v='+Date.now(),{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!(document.querySelector('#login') as HTMLElement).hidden);
 await page.waitForFunction(()=>!(document.querySelector('#loginapp') as HTMLElement).hidden,{timeout:10000});
 const href=await page.locator('#loginapplink').getAttribute('href');const vis=await page.locator('#loginapplink').isVisible();
 await page.screenshot({path:`evidence/app-download/${name}.png`});
 console.log(name,{href,visible:vis,errors});await ctx.close();
}
await browser.close();
