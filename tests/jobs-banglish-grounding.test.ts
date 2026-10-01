import test from 'node:test';import assert from 'node:assert/strict';
import {resolveCurrentJobRequest} from '../src/jobs-live.ts';import {jobIntent} from '../src/jobs.ts';
// Real transcripts from the public trial (2026-10-01): Bengali/Banglish users got zero Subito cards because the
// lexical grounder replaced the model's occupation with the raw Banglish sentence ("amr kaj lagbe") or with a
// follow-up ("Sii", "Part time", "Aro offer dekhaw"), and Subito was then searched for that string.
const ground=(turns:string[],model:{query:string,city:string})=>{const g=resolveCurrentJobRequest(turns,model);return {...g,occupation:jobIntent({query:g.query,city:g.city}).occupation}};
test('Banglish request + bare city: the model-proposed occupation is kept when the user turns carry no Italian occupation word',()=>{
 const g=ground(['Amr kaj lagbe','Bologna'],{query:'lavoro',city:'Bologna'});
 assert.equal(g.city,'Bologna');assert.notEqual(g.occupation,'amr kaj lagbe','a Banglish sentence is not an occupation');
 const g2=ground(['Amake kaj khuje deo bologna ta aiuto cuoco hisebe'],{query:'aiuto cuoco',city:'Bologna'});
 assert.equal(g2.city,'Bologna');assert.equal(g2.occupation,'aiuto cuoco','Italian occupation embedded in a Banglish sentence wins');
 const g3=ground(['Amake kaj khuje deo bologna ta aiuto cuoco hisebe','Aro offer dekhaw'],{query:'aiuto cuoco',city:'Bologna'});
 assert.equal(g3.occupation,'aiuto cuoco','"show more offers" keeps the pending occupation');
});
test('follow-up turns (preference answers, confirmations, city corrections) never become the occupation',()=>{
 assert.equal(ground(['Barista','Bologna','Milano te'],{query:'barista',city:'Milano'}).occupation,'barista');
 assert.equal(ground(['Barista','Bologna','Milano te'],{query:'barista',city:'Milano'}).city,'Milano');
 assert.equal(ground(['Pulizie','Bologna','Sii'],{query:'pulizie',city:'Bologna'}).occupation,'pulizie');
 const pt=ground(['Ami magazine e kaj korte chai','Bologna','Part time'],{query:'magazzino',city:'Bologna'});
 assert.equal(pt.occupation,'magazzino');assert.equal(pt.city,'Bologna');
});
test('safety: the model cannot invent a city or smuggle a URL/qualification through the proposed occupation',()=>{
 assert.equal(ground(['Amr kaj lagbe'],{query:'cameriere',city:'Bologna'}).city,'','city must come from the user');
 assert.equal(ground(['Amr kaj lagbe','Bologna'],{query:'https://evil.example/x',city:'Bologna'}).occupation,undefined);
 assert.equal(ground(['Amr kaj lagbe','Bologna'],{query:'cameriere con esperienza certificata HACCP e patente',city:'Bologna'}).occupation,undefined,'long qualification strings are rejected');
 // Italian turns keep today's behaviour: user's own words win over the proposal
 assert.equal(ground(['cerco lavoro come saldatore a Jesi'],{query:'cameriere',city:'Jesi'}).occupation,'saldatore');
});
