import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';
test('job receipt cards expose only original HTTPS listing links and escaped labels',async()=>{
 const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const match=code.match(/function renderJobReceipts\(events\)\{[\s\S]*?\n\}/);assert.ok(match,'receipt renderer exists');
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div id="messages"></div>');
 await page.addScriptTag({content:"const $=s=>document.querySelector(s);function elt(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}"+match[0]});
 await page.evaluate(()=>{(window as any).renderJobReceipts([{kind:'tool.succeeded',detail:{tool:'jobs_search',result:{status:'ok',fetchedAt:'2026-09-26T00:00:00Z',jobs:[{title:'<img onerror=alert(1)>',url:'https://www.subito.it/offerte-lavoro/cuoco-123.htm',city:'Bologna'},{title:'bad',url:'javascript:alert(1)'}]}}}]);});
 const cards=code.match(/function renderCards\(\)\{[^\n]+/);assert.ok(cards);
 await page.addScriptTag({content:"const workspace={artifacts:[]};const current=null;"+cards[0]});await page.evaluate(()=>{(window as any).renderCards()});
 assert.equal(await page.locator('a').count(),1);assert.equal(await page.locator('img').count(),0);assert.match(await page.locator('a').innerText(),/Apri annuncio originale/);assert.equal(await page.locator('a').getAttribute('rel'),'noopener noreferrer');
 }finally{await browser.close()}
});
