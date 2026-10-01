// Render real jobs receipts (from the live trial smoke) with the public renderer + dark.css and screenshot them.
import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
const root=new URL('../',import.meta.url);
const live=JSON.parse(await readFile(new URL('evidence/jobs-jsonld-1/live-trial-cameriere-bologna.json',root),'utf8'));
const results=live.turns.flatMap((t:any)=>t.jobs);
const code=await readFile(new URL('public/app.js',root),'utf8');const renderer=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/)![0];
const css=await readFile(new URL('public/dark.css',root),'utf8')+await readFile(new URL('public/style.css',root),'utf8');
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="app"><main id="messages" style="max-width:760px;margin:0 auto;padding:20px"></main></div></body></html>`;
const browser=await chromium.launch({headless:true});const checks:Record<string,unknown>={};
try{for(const [name,width] of [['desktop',1280],['mobile',390]] as const){
 const page=await browser.newPage({viewport:{width,height:900}});await page.setContent(html);
 await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}"+renderer});
 await page.evaluate((rs:any[])=>(window as any).renderJobReceipts(rs.map(r=>({kind:'tool.succeeded',detail:{tool:'jobs_search',result:r}}))),results);
 checks[name]={cards:await page.locator('.job-card').count(),verified:await page.locator('.job-card-verified').count(),observed:await page.locator('.job-card-observed').count(),search:await page.locator('.job-card-search').count(),ctas:await page.locator('a.job-cta').count(),unsafeLinks:await page.locator('a:not([rel="noopener noreferrer"])').count(),summary:await page.locator('.job-summary').innerText(),firstCard:await page.locator('.job-card').first().innerText()};
 await page.screenshot({path:new URL(`evidence/jobs-jsonld-1/cards-${name}.png`,root).pathname,fullPage:true});
}}finally{await browser.close()}
console.log(JSON.stringify(checks,null,1));
