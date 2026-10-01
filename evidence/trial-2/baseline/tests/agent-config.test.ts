import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatCompletionsProvider } from '../src/agent-provider.ts';

test('NEW project provider env is opt-in, complete, HTTPS-only and ignores unrelated credentials', async () => {
  const config = await import('../scripts/config.ts');
  assert.equal(typeof (config as any).agentFromEnv, 'function');
  const load = (config as any).agentFromEnv;
  assert.equal(load({ OPENAI_API_KEY: 'unrelated-fixture' }), undefined);
  assert.throws(() => load({ NOVA_AGENT_MODEL: 'fixture' }));
  assert.throws(() => load({ NOVA_AGENT_ENDPOINT: 'http://127.0.0.1:1234/v1/chat/completions', NOVA_AGENT_MODEL: 'fixture', NOVA_AGENT_API_KEY: 'fixture-key' }));
  assert.throws(() => load({ NOVA_AGENT_ENDPOINT: 'https://fixture.invalid/v1/chat/completions?secret=x', NOVA_AGENT_MODEL: 'fixture', NOVA_AGENT_API_KEY: 'fixture-key' }));
  const options = load({ NOVA_AGENT_ENDPOINT: 'https://fixture.invalid/v1/chat/completions', NOVA_AGENT_MODEL: 'fixture', NOVA_AGENT_API_KEY: 'fixture-key' });
  assert.equal(options.model, 'fixture'); assert.equal(options.allowLoopback, undefined);
  assert.ok(new ChatCompletionsProvider(options));
});
