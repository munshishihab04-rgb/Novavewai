import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

test('Subito adapter is deny-by-default until explicit source-policy review',async()=>{
 const m=await import('../src/jobs-subito.ts').catch(()=>null);assert.ok(m,'adapter exists');
 await assert.rejects(()=>m.searchSubito('cuoco','Bologna',new AbortController().signal),/jobs_policy_unreviewed/);
});

test('Playwright parser reads only compact listing cards, distinguishes blocks from no matches',async()=>{
 const m=await import('../src/jobs-subito.ts');assert.equal(typeof m.extractSubitoJobs,'function');
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();
 await page.setContent('<main><article><a href="https://www.subito.it/offerte-lavoro/cuoco-123.htm"><h2>Cuoco</h2></a><p>private description 3331234567</p><img src="data:,"/><span>1500 €</span></article></main>');
 const rows=await m.extractSubitoJobs(page,'Bologna');assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['city','source','title','url']);
 await page.setContent('<h1>Access Denied</h1>');await assert.rejects(()=>m.extractSubitoJobs(page,'Bologna'),/jobs_access_blocked/);
 await page.setContent('<h1>Layout changed</h1>');await assert.rejects(()=>m.extractSubitoJobs(page,'Bologna'),/jobs_parse_failed/);
 await page.setContent('<h1>Nessun annuncio trovato</h1>');assert.deepEqual(await m.extractSubitoJobs(page,'Bologna'),[]);
 }finally{await browser.close()}
});

test('fixed search URLs and robots policy do not allow login, third parties or forbidden paths',async()=>{
 const m=await import('../src/jobs-subito.ts');assert.equal(typeof m.subitoURL,'function');
 assert.equal(m.subitoURL('cuoco','Bologna'),'https://www.subito.it/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/bologna/?q=cuoco');
 assert.throws(()=>m.subitoURL('http://evil','Bologna'));assert.throws(()=>m.subitoURL('cuoco','../'));
 assert.equal(m.robotsAllow('User-agent: *\nDisallow: /annunci-',m.subitoURL('cuoco','Bologna')),false);
 assert.equal(m.robotsAllow('User-agent: *\nDisallow: /login',m.subitoURL('cuoco','Bologna')),true);
 assert.equal(m.robotsAllow('<html>blocked</html>',m.subitoURL('cuoco','Bologna')),false);
});
