import test from 'node:test';
import assert from 'node:assert/strict';
import {jobIntent} from '../src/jobs.ts';
import {resolveCurrentJobRequest} from '../src/jobs-live.ts';

test('generic occupation and municipality are not limited to a dictionary',()=>{
 for(const [query,city,occupation] of [['cerco lavoro come programmatore a Imola','Imola','programmatore'],['saldatore','Jesi','saldatore'],['magazziniere','Faenza','magazziniere'],['badante','San Lazzaro di Savena','badante'],['customer care remoto','','customer care']]){
  const intent=jobIntent({query,city});assert.equal(intent.occupation,occupation);assert.equal(intent.city,city||undefined);
 }
 assert.equal(jobIntent({query:'cameriere ai piani',city:'Imola'}).occupation,'cameriere ai piani');
 assert.equal(jobIntent({query:'cameriere di sala',city:'Imola'}).occupation,'cameriere');
});

test('current user provenance wins over model cities, negation and old preferences',()=>{
 const model={query:'saldatore',city:'Bologna'};
 assert.equal(resolveCurrentJobRequest(['cerco saldatore a Jesi'],model).city,'Jesi');
 assert.equal(resolveCurrentJobRequest(['saldatore Bologna','Ora a Faenza invece di Bologna'],model).city,'Faenza');
 assert.equal(resolveCurrentJobRequest(['saldatore Bologna','Non a Bologna, cerca a Imola'],model).city,'Imola');
 assert.equal(resolveCurrentJobRequest(['saldatore Bologna','non a Bologna'],model).city,'');
 assert.equal(resolveCurrentJobRequest(['saldatore senza agenzie a Jesi','anche agenzie','ora a Imola'],model).noAgencies,false);
 assert.equal(resolveCurrentJobRequest(['cerco saldatore'],model).city,'');
 assert.equal(resolveCurrentJobRequest(['cerco saldatore','Jesi'],{query:'saldatore',city:'Jesi'}).city,'Jesi');
 assert.equal(resolveCurrentJobRequest(['non cerco saldatore a Jesi'],model).query,'');
 assert.equal(resolveCurrentJobRequest(['cerco programmatore a Imola'],model).query,'programmatore');
 assert.equal(resolveCurrentJobRequest(['saldatore a Jesi','non saldatore, cerco magazziniere a Faenza'],model).query,'magazziniere');
 assert.equal(resolveCurrentJobRequest(['saldatore a Jesi','cerco programmatore site:evil.test'],model).query,'');
 assert.equal(resolveCurrentJobRequest(['saldatore a Jesi','non remoto'],model).query.includes('remoto'),false);
 assert.equal(resolveCurrentJobRequest(['saldatore a Jesi','cerco lavoro come magazziniere'],model).city,'');
 assert.equal(resolveCurrentJobRequest(['sono bravo a cucinare'],model).city,'');
 assert.equal(resolveCurrentJobRequest(['cerco saldatore a Jesi o Faenza'],model).city,'');
 assert.equal(resolveCurrentJobRequest(['programmatore Imola'],{query:'programmatore',city:'Imola'}).city,'Imola');
 assert.equal(resolveCurrentJobRequest(['programmatore Imola'],{query:'programmatore',city:'Imola'}).query,'programmatore');
 assert.equal(resolveCurrentJobRequest(['saldatore a Jesi','grazie','Faenza'],{query:'saldatore',city:'Faenza'}).query,'');
 assert.equal(resolveCurrentJobRequest(['cerco lavoro come tecnico di laboratorio a Sant\'Agata de\' Goti'],{query:'tecnico',city:'Roma'}).city,"Sant'Agata de' Goti");
 assert.equal(resolveCurrentJobRequest(['customer care remoto','non remoto'],{query:'customer care',city:''}).query.includes('remoto'),false);
 assert.equal(resolveCurrentJobRequest(['cerco saldatore a Jesi','ora a Faenza o Imola'],model).city,'');
});
