import {chromium} from 'playwright';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const out:any[]=[];
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false});
 const ORIGIN='https://review-fixture.test',url=ORIGIN+'/jobs';let requests=0,denied=false;
 await ctx.route('**/*',async route=>{const req=route.request();const address=new URL(req.url());if(++requests>3){denied=true;return route.abort();}if(req.method()!=='GET'||req.resourceType()!=='document'||address.origin!==ORIGIN||![url,ORIGIN+'/robots.txt'].includes(req.url()))return route.abort();return route.fulfill({status:200,contentType:'text/html',body:req.url().endsWith('robots.txt')?'User-agent: *\nDisallow:':Array.from({length:4},(_,i)=>`<img src="/asset-${i}.jpg">`).join('')+'<h2>fixture listing</h2>'});});
 const page=await ctx.newPage();await page.goto(ORIGIN+'/robots.txt');await page.goto(url,{waitUntil:'load'});assert.equal(denied,true);out.push({id:'S1',case:'blocked image requests consume document budget',requests,denied,wouldThrow:'jobs_request_budget'});await ctx.close();
 let forbiddenHits=0;const routes:string[]=[];
 const server=createServer((req,res)=>{if(req.url==='/start'){res.writeHead(302,{location:'/not-allowlisted'});res.end();}else {forbiddenHits++;res.end('review fixture redirect target');}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const origin='http://127.0.0.1:'+(server.address() as any).port;const c=await browser.newContext();await c.route('**/*',r=>{routes.push(r.request().url());return r.request().url()===origin+'/start'?r.continue():r.abort()});const p=await c.newPage();await p.goto(origin+'/start');assert.equal(forbiddenHits,1);out.push({id:'S2',case:'Playwright route is invoked only on original URL of redirect chain',routed:routes,forbiddenTargetHits:forbiddenHits,finalURL:p.url(),note:'Local controlled redirect only; no claim Subito exposes open redirect.'});await c.close();}finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))}
}finally{await browser.close()}
await writeFile(new URL('./browser-reproductions.json',import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
