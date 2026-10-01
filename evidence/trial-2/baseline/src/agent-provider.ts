import { SafeError } from './app.ts';
export interface ProviderOptions { endpoint: string; model: string; apiKey?: string; allowLoopback?: boolean; timeoutMs?: number; maxResponseBytes?: number }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ProviderMessage { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
export interface AgentProvider { complete(messages: unknown[], tools: unknown[], signal: AbortSignal): Promise<ProviderMessage> }
export const agentError = (code: string): never => { throw new SafeError(409, code); };
export function parseCompletion(value: any): ProviderMessage {
  if (!value || value.error || !Array.isArray(value.choices) || value.choices.length !== 1) return agentError('provider_malformed');
  const choice = value.choices[0], m = choice?.message;
  if (m?.refusal || choice.finish_reason === 'content_filter') return agentError('provider_refusal');
  if (!['stop','tool_calls'].includes(choice.finish_reason)) return agentError('provider_truncated');
  if (!m || m.role !== 'assistant' || (m.content !== null && m.content !== undefined && typeof m.content !== 'string')) return agentError('provider_malformed');
  if (m.content && Buffer.byteLength(m.content) > 16384) return agentError('provider_malformed');
  if (choice.finish_reason === 'tool_calls') {
    if (!Array.isArray(m.tool_calls) || !m.tool_calls.length || m.tool_calls.length > 16) return agentError('provider_malformed');
    const ids = new Set();
    for (const t of m.tool_calls) {
      if (!t || t.type !== 'function' || typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(t.id) || ids.has(t.id) || typeof t.function?.name !== 'string' || typeof t.function?.arguments !== 'string' || Buffer.byteLength(t.function.arguments) > 32768) return agentError('provider_malformed');
      ids.add(t.id);
    }
    return { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls.map((t: ToolCall) => ({ id: t.id, type: 'function', function: { name: t.function.name, arguments: t.function.arguments } })) };
  }
  if ((m.tool_calls !== undefined && m.tool_calls !== null && (!Array.isArray(m.tool_calls) || m.tool_calls.length !== 0)) || typeof m.content !== 'string' || !m.content.trim()) return agentError('provider_malformed');
  return { role: 'assistant', content: m.content };
}
export class ChatCompletionsProvider implements AgentProvider {
  private url: URL;
  constructor(private options: ProviderOptions) {
    this.url = new URL(options.endpoint);
    if (this.url.username || this.url.password || this.url.hash || this.url.search || (this.url.protocol !== 'https:' && !(options.allowLoopback === true && this.url.protocol === 'http:' && this.url.hostname === '127.0.0.1'))) throw new Error('Invalid agent endpoint');
    if (!options.model || options.model.length > 200 || (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10 || options.timeoutMs > 30000)) || (options.maxResponseBytes !== undefined && (!Number.isInteger(options.maxResponseBytes) || options.maxResponseBytes < 128 || options.maxResponseBytes > 65536))) throw new Error('Invalid agent configuration');
  }
  async complete(messages: unknown[], tools: unknown[], signal: AbortSignal) {
    const timer = AbortSignal.timeout(this.options.timeoutMs ?? 15000);
    const combined = AbortSignal.any([signal, timer]);
    try {
      const res = await fetch(this.url, { method: 'POST', redirect: 'error', signal: combined,
        headers: { 'content-type': 'application/json', ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.options.model, messages, tools, tool_choice: 'auto', stream: false, max_tokens: 2048 }) });
      if (!res.ok || !res.body) { await res.body?.cancel(); return agentError('provider_error'); }
      const reader = res.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > (this.options.maxResponseBytes ?? 65536)) return agentError('provider_too_large'); chunks.push(chunk.value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { return agentError('provider_malformed'); }
      return parseCompletion(value);
    } catch (error) {
      if (signal.aborted) return agentError('run_cancelled');
      if (timer.aborted) return agentError('provider_timeout');
      if (error instanceof SafeError) throw error;
      return agentError('provider_error');
    }
  }
}
