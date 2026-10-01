import test from 'node:test';import assert from 'node:assert/strict';
import {novaIdentity,NOVA_FOUNDER,capabilitySummary} from '../src/identity.ts';
import {toolDefinitions} from '../src/agent-tools.ts';
import {voiceInstructions} from '../src/voice-policy.ts';

test('founder facts are fixed, Italian, and contain exactly the approved facts',()=>{
 assert.equal(NOVA_FOUNDER.name,'Shihab Rahman');
 assert.equal(NOVA_FOUNDER.foundedYear,2026);
 assert.equal(NOVA_FOUNDER.city,'Bologna');
 const text=novaIdentity({tools:toolDefinitions});
 for(const s of ['Shihab Rahman','2026','Bologna','bengalese'])assert.ok(text.includes(s),s);
 assert.ok(!/Ricky/.test(text),'no co-founder mention');
});

test('capability summary is derived from the actually offered tools, never from a hand-written list',()=>{
 const full=capabilitySummary(toolDefinitions);
 assert.ok(full.includes('lavoro'),'jobs_search → ricerca lavoro');
 assert.ok(full.includes('file'),'create_file → file scaricabili');
 assert.ok(full.includes('web'),'web_search');
 const noJobs=capabilitySummary(toolDefinitions.filter((t:any)=>(t.function?.name??t.name)!=='jobs_search'));
 assert.ok(!noJobs.includes('offerte di lavoro'),'jobs capability disappears when tool not offered');
 const unsupported=capabilitySummary(toolDefinitions);
 for(const s of ['OCR','terminale','email','candidatur'])assert.ok(unsupported.toLowerCase().includes(s.toLowerCase()),'declares unsupported: '+s);
});

test('identity text is bounded and injection-safe: no tool content, no secrets, short enough for the context budget',()=>{
 const text=novaIdentity({tools:toolDefinitions});
 assert.ok(text.length<3500,String(text.length));
 assert.ok(!/api[_ -]?key|password|token/i.test(text));
});

test('voice and chat share the same identity block',()=>{
 const voice=voiceInstructions('it',{tools:toolDefinitions});
 const chat=novaIdentity({tools:toolDefinitions});
 assert.ok(voice.includes('Shihab Rahman'));
 assert.ok(voice.includes(chat.split('\n')[0]),'first identity line present verbatim in voice prompt');
});
