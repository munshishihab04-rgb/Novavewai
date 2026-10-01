import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('speech wait covers the native run deadline rather than silently abandoning at 60 seconds',async()=>{const source=await readFile(new URL('../src/voice.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/n<600/);assert.match(source,/while\(!s.stopped\)/)});
