import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {buildApp,migrate} from '../src/app.ts';import {buildWeb} from '../src/web.ts';import {database} from './helpers.ts';
// Installable PWA + Trusted Web Activity support: manifest and icons under the mount path, Digital Asset Links at the ORIGIN root
// (Android reads https://host/.well-known/assetlinks.json, never under /nova). Fingerprints come from a file in the data dir.
test('manifest + icons served under basePath with correct scope/start_url; assetlinks at origin root from data-dir file; absent file → 404 (never an empty/fabricated statement)',async()=>{
 const db=await database();await migrate(db.pool);const core=buildApp(db.pool);const dir=await mkdtemp(join(tmpdir(),'nova-al-'));
 const web=await buildWeb(core,db.pool,{basePath:'/nova',assetLinksFile:join(dir,'assetlinks.json')});const base=await web.listen({port:0,host:'127.0.0.1'});
 try{
  const m=await fetch(base+'/nova/manifest.webmanifest');assert.equal(m.status,200);assert.match(m.headers.get('content-type')!,/application\/manifest\+json/);const j=await m.json();
  assert.equal(j.start_url,'/nova/');assert.equal(j.scope,'/nova/');assert.equal(j.id,'/nova/');assert.equal(j.display,'standalone');assert.equal(j.lang,'it');assert.ok(j.icons.some((i:any)=>i.purpose==='maskable'));
  for(const i of j.icons){const r=await fetch(base+i.src);assert.equal(r.status,200,i.src);assert.match(r.headers.get('content-type')!,/image\/png/)}
  const html=await (await fetch(base+'/nova/')).text();assert.match(html,/<link rel="manifest" href="\/nova\/manifest\.webmanifest">/);assert.match(html,/<meta name="theme-color"/);
  assert.equal((await fetch(base+'/.well-known/assetlinks.json')).status,404,'no fingerprint file → 404');
  await writeFile(join(dir,'assetlinks.json'),JSON.stringify([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'it.licenzpol.nova',sha256_cert_fingerprints:['AA:BB']}}]));
  const al=await fetch(base+'/.well-known/assetlinks.json');assert.equal(al.status,200);assert.match(al.headers.get('content-type')!,/application\/json/);assert.equal((await al.json())[0].target.package_name,'it.licenzpol.nova');
  // root-mounted default keeps serving the manifest at /manifest.webmanifest with scope '/'
 }finally{await web.close();await core.close();await db.close()}
 const web2=await buildWeb(core,db.pool,{});const base2=await web2.listen({port:0,host:'127.0.0.1'});try{const j=await (await fetch(base2+'/manifest.webmanifest')).json();assert.equal(j.scope,'/');assert.equal(j.start_url,'/')}finally{await web2.close()}
});
