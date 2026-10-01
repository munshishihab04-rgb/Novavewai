import pg from 'pg';
import { ChatCompletionsProvider, type ProviderOptions } from '../src/agent-provider.ts';
export function agentFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderOptions | undefined {
  const endpoint = env.NOVA_AGENT_ENDPOINT, model = env.NOVA_AGENT_MODEL, apiKey = env.NOVA_AGENT_API_KEY;
  if (endpoint === undefined && model === undefined && apiKey === undefined) return undefined;
  if (!endpoint || !model || !apiKey) throw new Error('Complete NEW project agent configuration required');
  const options = { endpoint, model, apiKey };
  new ChatCompletionsProvider(options); // Validate before opening the listener. Never log options.
  return options;
}
export function localPool() {
  if (process.env.PGHOST !== '127.0.0.1' || !process.env.PGPASSWORD || !process.env.PGUSER || !process.env.PGDATABASE) throw new Error('Local database configuration required');
  return new pg.Pool({ host: '127.0.0.1', port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
    password: process.env.PGPASSWORD, database: process.env.PGDATABASE, max: 10, connectionTimeoutMillis: 5000 });
}
