import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {buildWeb} from '../src/web.ts';import {database} from './helpers.ts';
// Production target licenzpol.it/nova (Caddy handle_path strips nothing here: we mount the app under a base path).
// Every public URL the browser touches must carry the prefix; the origin/CSRF check and __Host- cookie stay host-scoped.
async function up(basePath:string){const db=await database();await migrate(db.pool);const user=await bootstrap(db.pool);const core=buildApp(db.pool);const web=await buildWeb(core,db.pool,{basePath,nativeVoice:true});const base=await web.listen({port:0,host:'127.0.0.1'});return {db,core,web,base,user}}
test('basePath=/nova: assets, html references, auth, api and native.js are served under the prefix; root paths 404; no absolute "/x" references leak in HTML/CSS/JS',async()=>{
 const {db,core,web,base}=await up('/nova');try{
  const html=await (await fetch(base+'/nova/')).text();assert.ok(!html.includes('<base '),'no <base>: CSP base-uri none');assert.ok(!/(href|src)="\/(?!nova\/)/.test(html),'no root-absolute asset refs');assert.match(html,/src="\/nova\/native\.js"/);
  for(const f of ['app.js','i18n.js','dark.css','NotoSansBengali-Regular.ttf','native.js'])assert.equal((await fetch(base+'/nova/'+f)).status,200,f);
  const css=await (await fetch(base+'/nova/dark.css')).text();assert.ok(!/url\('\/(?!nova\/)/.test(css),'font urls rewritten');assert.match(css,/url\('\/nova\/NotoSansBengali-Regular\.ttf'\)/);
  const js=await (await fetch(base+'/nova/app.js')).text();assert.ok(!/request\('\/api'\+p/.test(js),'api base must be prefixed');assert.match(js,/\/nova\/api/);
  assert.equal((await fetch(base+'/')).status,404);assert.equal((await fetch(base+'/app.js')).status,404);assert.equal((await fetch(base+'/api/workspace')).status,404);
  assert.equal((await fetch(base+'/nova/api/workspace')).status,401,'api lives under prefix, unauthenticated → 401 not 404');
  const reg=await fetch(base+'/nova/auth/register',{method:'POST',headers:{'content-type':'application/json','x-nova-request':'1',origin:'https://'+new URL(base).host},body:JSON.stringify({username:'u'+randomUUID().slice(0,6),password:'Password-123456'})});
  assert.ok([201,403].includes(reg.status),String(reg.status));
  assert.equal((await fetch(base+'/nova',{redirect:'manual'})).status,308,'bare prefix redirects to prefix/');
  assert.equal((await fetch(base+'/nova',{redirect:'manual'})).headers.get('location'),'/nova/');
 }finally{await web.close();await core.close();await db.close()}
});
test('default basePath "" keeps today\'s root behaviour byte-for-byte',async()=>{
 const {db,core,web,base}=await up('');try{
  const html=await (await fetch(base+'/')).text();assert.ok(!html.includes('<base href'));assert.match(html,/src="\/app\.js"/);assert.equal((await fetch(base+'/app.js')).status,200);assert.equal((await fetch(base+'/api/workspace')).status,401);
 }finally{await web.close();await core.close();await db.close()}
});
