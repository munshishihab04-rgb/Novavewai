import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp,bootstrap,migrate} from '../src/app.ts';import {database,request} from './helpers.ts';import {webDataRoutes} from '../src/web.ts';
import {LANGUAGES,defaultPreferences,replyLanguageRule,languageName} from '../src/language.ts';import {voiceInstructions} from '../src/voice-policy.ts';
test('language preferences: defaults, validation, persistence per owner, independent ui/chat/voice',async()=>{
 const db=await database();await migrate(db.pool);const a=await bootstrap(db.pool),b=await bootstrap(db.pool);const app=buildApp(db.pool);webDataRoutes(app,db.pool);
 try{const base=await app.listen({port:0,host:'127.0.0.1'});
  const d=await request(base,'/me/preferences',a.token);assert.equal(d.status,200);assert.deepEqual(d.body.language,defaultPreferences().language);assert.deepEqual(d.body.language,{ui:'it',chat:'auto',voice:'auto'});
  const put=await request(base,'/me/preferences',a.token,{language:{ui:'bn',chat:'bn-latn',voice:'bn'}},'PUT',randomUUID());assert.equal(put.status,200,JSON.stringify(put.body));assert.deepEqual(put.body.language,{ui:'bn',chat:'bn-latn',voice:'bn'});
  assert.deepEqual((await request(base,'/me/preferences',a.token)).body.language,{ui:'bn',chat:'bn-latn',voice:'bn'},'persisted');
  assert.deepEqual((await request(base,'/me/preferences',b.token)).body.language,{ui:'it',chat:'auto',voice:'auto'},'owner isolated');
  assert.equal((await request(base,'/me/preferences',a.token,{language:{ui:'de'}},'PUT',randomUUID())).status,400);
  assert.equal((await request(base,'/me/preferences',a.token,{language:{ui:'auto'}},'PUT',randomUUID())).status,400,'ui cannot be auto');
  // onboarding flag: false by default, flips to true once, never back, owner isolated, rejects other values
  assert.equal(d.body.onboarded,false);assert.equal((await request(base,'/me/preferences',a.token,{onboarded:false},'PUT',randomUUID())).status,400,'only true is accepted');
  const ob=await request(base,'/me/preferences',a.token,{language:{chat:'en'},onboarded:true},'PUT',randomUUID());assert.equal(ob.status,200);assert.equal(ob.body.onboarded,true);assert.equal(ob.body.language.chat,'en');
  assert.equal((await request(base,'/me/preferences',a.token,{language:{chat:'it'}},'PUT',randomUUID())).body.onboarded,true,'stays true on later saves');
  assert.equal((await request(base,'/me/preferences',b.token)).body.onboarded,false,'owner isolated');
  const partial=await request(base,'/me/preferences',a.token,{language:{chat:'it'}},'PUT',randomUUID());assert.deepEqual(partial.body.language,{ui:'bn',chat:'it',voice:'bn'},'partial update keeps others');
 }finally{await app.close();await db.close()}
});
test('reply-language rule: auto follows the user; a fixed preference wins over mixed input; explicit in-conversation request overrides',()=>{
 assert.deepEqual([...LANGUAGES],['it','bn','bn-latn','en']);
 assert.equal(languageName('bn-latn'),'Bengali written in Latin script (Banglish)');
 const auto=replyLanguageRule('auto');assert.match(auto,/same language as the user/i);assert.match(auto,/mixed/i);
 const bn=replyLanguageRule('bn');assert.match(bn,/ALWAYS reply in Bengali/i);assert.match(bn,/Bengali script/);assert.match(bn,/even if the user writes in Italian, English or a mix/i);assert.match(bn,/explicitly asks/i);
 const latn=replyLanguageRule('bn-latn');assert.match(latn,/Latin script/);assert.match(latn,/do not use Bengali script/i);
 assert.match(replyLanguageRule('it'),/ALWAYS reply in Italian/);
 for(const p of ['auto','it','bn','bn-latn','en'] as const){const v=voiceInstructions(p);assert.match(v,/latest user speech/i);if(p==='auto')assert.match(v,/not a language lock/i);else{assert.match(v,/ALWAYS/);assert.match(v,new RegExp(languageName(p as any).split(' ')[0]))}}
 assert.match(voiceInstructions('bn-latn'),/speak Bengali/i);
});
