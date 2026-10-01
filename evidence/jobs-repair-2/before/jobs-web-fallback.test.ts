import test from 'node:test';import assert from 'node:assert/strict';
import {webJobCandidates} from '../src/jobs.ts';
test('web discovery returns bounded unverified candidate links, never working jobs',()=>{
 const result=webJobCandidates({sources:[{title:'Cameriere Bologna — board','url':'https://it.indeed.com/viewjob?jk=abc#x'},{title:'Local','url':'https://127.0.0.1/jobs'},{title:'Duplicate','url':'https://it.indeed.com/viewjob?jk=abc'}],checkedAt:'2026-09-30T00:00:00Z'},'cameriere','Bologna');
 assert.equal(result.status,'candidates_unverified');assert.equal(result.jobs,undefined);assert.equal(result.opportunities?.length,1);assert.equal(result.opportunities?.[0].verification_status,'UNVERIFIED');assert.equal(result.retryable,false);
});
