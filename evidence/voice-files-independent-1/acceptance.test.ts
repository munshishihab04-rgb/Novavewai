import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { database } from '../../tests/helpers.ts';
import { bootstrap, buildApp, migrate } from '../../src/app.ts';
import { validateTools } from '../../src/agent-tools.ts';
import * as generated from '../../src/generated-files.ts';
import { extractPdf } from '../../src/documents.ts';

// Only application logic/persistence is real; provider output is controlled.
// No endpoint, credential discovery, browser, deploy or uploaded-code execution.
globalThis.fetch = (async () => { throw Error('INDEPENDENT_HARNESS_NETWORK_DENIED'); }) as typeof fetch;
const root = fileURLToPath(new URL('./', import.meta.url));
const tmp = join(root, '.tmp');
await mkdir(tmp, { recursive: true, mode: 0o700 });
process.env.TMPDIR = tmp;
process.env.NOVA_JOBS_CACHE_DIR = join(tmp, 'unused-jobs');
const fileArgs = (name: string, text: string, format = 'text', entries: any[] = []) => ({ name, text, format, entries });
const toolCall = (name: string, args: any, id = randomUUID()) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });
const proposal = (args: any, content: string | null = null) => ({ role: 'assistant' as const, content, tool_calls: [toolCall('create_file', args)] });
const complete = (content: string) => ({ role: 'assistant' as const, content });

async function fixture(provider: any, register?: (app: ReturnType<typeof buildApp>, pool: any) => void) {
  const db = await database();
  let app: ReturnType<typeof buildApp> | undefined;
  let fileRoot: string | undefined;
  try {
    await migrate(db.pool);
    const owner = await bootstrap(db.pool), other = await bootstrap(db.pool);
    fileRoot = await mkdtemp(join(tmp, 'files-'));
    await chmod(fileRoot, 0o700);
    app = buildApp(db.pool, { fileRoot, agent: {
      endpoint: 'https://independent-fixture.invalid', model: 'controlled-independent', provider,
      timeoutMs: 1000, maxModelCalls: 4,
      search: async () => { throw Error('INDEPENDENT_SEARCH_DENIED'); },
      jobsSearch: async () => { throw Error('INDEPENDENT_JOBS_DENIED'); },
    } });
    register?.(app, db.pool);
    await app.ready();
    const send = (url: string, payload?: any, token = owner.token, key = randomUUID()) => app!.inject({
      url, method: payload === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, payload,
    });
    const created = await send('/conversations', { title: 'Independent synthetic acceptance' });
    assert.equal(created.statusCode, 201, created.body);
    const conversation = created.json().id;
    return { db, app, owner, other, send, conversation,
      async close() { await app!.close(); await db.close(); await rm(fileRoot!, { recursive: true, force: true }); } };
  } catch (error) {
    if (app) await app.close().catch(() => {});
    await db.close();
    if (fileRoot) await rm(fileRoot, { recursive: true, force: true });
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function settled(f: Fixture, id: string) {
  for (let i = 0; i < 400; i++) {
    const response = await f.send('/runs/' + id);
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json();
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Run did not reach terminal state within bounded polling (400 x 10ms plus local I/O)');
}
async function count(f: Fixture, table: string) {
  assert.ok(['artifacts', 'artifact_revisions', 'agent_tool_receipts', 'agent_runs', 'files'].includes(table));
  return (await f.db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
}
async function create(f: Fixture, text: string, baseSequence = 0, key = randomUUID()) {
  const response = await f.send(`/conversations/${f.conversation}/turns`, { text, baseSequence }, undefined, key);
  assert.equal(response.statusCode, 201, response.body);
  return { response, run: await settled(f, response.json().id) };
}

for (const [name, text] of [
  ['notes.txt', 'EXACT ASCII\r\nবাংলা Italiano\n'],
  ['index.js', 'throw new Error("DO_NOT_EXECUTE");\n// বাংলা\n'],
  ['index.php', '<?php\nthrow new Exception("DO_NOT_EXECUTE");\n'],
  ['theme.liquid', '{{ product.title | escape }}\n{% comment %}exact{% endcomment %}\n'],
]) test(`stable: ${name} exact downloaded bytes, immutable revision, provenance and owner isolation`, { timeout: 30000 }, async () => {
  let calls = 0;
  const f = await fixture({ complete: async () => ++calls === 1 ? proposal(fileArgs(name, text)) : complete('File saved from its committed receipt.') });
  try {
    const { run } = await create(f, `Create ${name} as a download; never execute it.`);
    assert.equal(run.status, 'completed', JSON.stringify(run));
    const rows = (await f.db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='create_file'", [run.id])).rows;
    assert.equal(rows.length, 1);
    const receipt = rows[0].result;
    assert.equal(receipt.executed, false);
    assert.equal(receipt.origin, 'assistant_generated');
    assert.match(receipt.download, /^\/artifacts\/[0-9a-f-]+\/revisions\/1\/download$/);
    const download = await f.send(receipt.download);
    assert.equal(download.statusCode, 200, download.body);
    assert.deepEqual(download.rawPayload, Buffer.from(text));
    assert.match(String(download.headers['content-disposition']), new RegExp('attachment; filename="' + name.replace('.', '\\.') + '"'));
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    assert.equal(download.headers['cache-control'], 'no-store');
    assert.match(String(download.headers['content-security-policy']), /sandbox/);
    assert.equal((await f.send(receipt.download, undefined, f.other.token)).statusCode, 404);
    assert.equal((await f.send('/runs/' + run.id, undefined, f.other.token)).statusCode, 404);
    assert.equal((await f.send('/runs/' + run.id + '/events', undefined, f.other.token)).statusCode, 404);
    assert.equal((await f.send(`/artifacts/${receipt.id}/revisions/1`, undefined, f.other.token)).statusCode, 404);
    const revision = await f.send(`/artifacts/${receipt.id}/revisions/1`);
    assert.equal(revision.statusCode, 200);
    assert.equal(revision.json().content.text, text);
    const reopened = await f.send(`/conversations/${f.conversation}/messages`);
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.deepEqual(reopened.json().items.map((m: any) => m.role), ['user', 'assistant']);
    assert.equal(await count(f, 'artifacts'), 1);
    assert.equal(await count(f, 'artifact_revisions'), 1);
    assert.equal(calls, 2);
  } finally { await f.close(); }
});

test('stable: duplicate canonical input same key, distinct keys, lost acknowledgement cannot create twice', { timeout: 30000 }, async () => {
  let calls = 0;
  const f = await fixture({ complete: async () => ++calls === 1 ? proposal(fileArgs('once.txt', 'ONE')) : complete('Committed once.') });
  try {
    const url = `/conversations/${f.conversation}/turns`, body = { text: 'Create once.txt', baseSequence: 0 }, key = randomUUID();
    const responses = await Promise.all([f.send(url, body, undefined, key), f.send(url, body, undefined, key)]);
    for (const response of responses) assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(responses[0].json(), responses[1].json());
    assert.equal((await settled(f, responses[0].json().id)).status, 'completed');
    const replay = await f.send(url, body, undefined, key);
    assert.deepEqual(replay.json(), responses[0].json());
    const distinct = await f.send(url, body);
    assert.equal(distinct.statusCode, 409, distinct.body);
    assert.equal(distinct.json().error, 'sequence_conflict');
    const stolen = await f.send(url, body, f.other.token, key);
    assert.equal(stolen.statusCode, 404, stolen.body);
    for (const table of ['agent_runs', 'artifacts', 'artifact_revisions', 'agent_tool_receipts']) assert.equal(await count(f, table), 1, table);
    assert.equal(calls, 2, 'replay must not redispatch provider');
  } finally { await f.close(); }
});

test('stable: failed receipt commit rolls back file, success event and assistant saved claim', { timeout: 30000 }, async () => {
  let calls = 0;
  const f = await fixture({ complete: async () => { calls++; return proposal(fileArgs('never.txt', 'MUST_ROLL_BACK'), 'I saved never.txt.'); } });
  try {
    await f.db.pool.query("CREATE FUNCTION independent_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INDEPENDENT_SYNTHETIC_COMMIT_FAILURE'; END $$; CREATE TRIGGER independent_reject_receipt BEFORE INSERT ON agent_tool_receipts FOR EACH ROW EXECUTE FUNCTION independent_reject_receipt()");
    const { run } = await create(f, 'Create never.txt');
    assert.ok(['failed', 'outcome_unknown'].includes(run.status), JSON.stringify(run));
    for (const table of ['artifacts', 'artifact_revisions', 'agent_tool_receipts']) assert.equal(await count(f, table), 0, table);
    const messages = (await f.send(`/conversations/${f.conversation}/messages`)).json().items;
    assert.equal(messages.filter((m: any) => m.role === 'assistant').length, 0, 'uncommitted provider success prose must not become an assistant message');
    const successes = await f.db.pool.query("SELECT kind FROM agent_events WHERE run_id=$1 AND kind IN ('tool.succeeded','assistant.persisted','run.completed')", [run.id]);
    assert.equal(successes.rowCount, 0);
    assert.equal((await f.db.pool.query("SELECT kind FROM outbox WHERE kind LIKE 'artifact.%'")).rowCount, 0);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('stable: upload owner isolation and exact bytes, rejected opaque input cannot become understood content', { timeout: 30000 }, async () => {
  let calls = 0;
  const f = await fixture({ complete: async () => { calls++; return complete('unused'); } });
  try {
    const payload = { conversationId: f.conversation, name: 'uploaded.txt', mime: 'text/plain', dataBase64: Buffer.from('UNTRUSTED_UPLOAD\r\n').toString('base64') };
    const foreign = await f.send('/files', payload, f.other.token);
    assert.equal(foreign.statusCode, 404, foreign.body);
    const uploaded = await f.send('/files', payload);
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const id = uploaded.json().id;
    for (const suffix of ['', '/content']) assert.equal((await f.send('/files/' + id + suffix, undefined, f.other.token)).statusCode, 404);
    assert.deepEqual((await f.send('/files/' + id + '/content')).rawPayload, Buffer.from('UNTRUSTED_UPLOAD\r\n'));
    const unknown = await f.send('/files', { ...payload, name: 'opaque.unknown', mime: 'application/octet-stream', dataBase64: Buffer.from([0, 255, 254, 1, 2]).toString('base64') });
    // Baseline rejects unknown formats. Acceptance of opaque uploads must replace
    // this baseline assertion with the explicit unread metadata contract, not silently pass.
    assert.ok([400, 415, 422].includes(unknown.statusCode), 'baseline opaque rejection changed; review unread metadata contract before updating this test: ' + unknown.body);
    assert.equal(typeof unknown.json().error, 'string');
    assert.equal(await count(f, 'files'), 1);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('stable: generated source is data; shell and unsupported execution tools are denied', () => {
  for (const name of ['exec', 'shell', 'terminal', 'run_code', 'execute_file', 'constructor', '__proto__']) {
    assert.throws(() => validateTools([toolCall(name, { command: 'DO_NOT_EXECUTE' })]));
  }
  for (const name of ['../outside.txt', '/absolute.txt', 'C:\\outside.txt', 'line\nbreak.txt']) {
    assert.throws(() => validateTools([toolCall('create_file', fileArgs(name, 'x'))]));
  }
});

// Explicit opt-in means changing source during implementation is not exercised
// accidentally. Once enabled, missing implementations are FAILURES, never skips.
const formatsPending = process.env.INDEPENDENT_FORMATS_READY === '1' ? false : 'PENDING: PDF/ZIP implementation changed during review; not executed against moving source. Enable INDEPENDENT_FORMATS_READY=1 after implementation stabilizes.';
for (const format of ['pdf', 'zip']) test(`pending-format: ${format} generated download signature and independent content verification`, { skip: formatsPending, timeout: 30000 }, async () => {
  const entries = [{ name: 'index.js', text: 'throw new Error("NOT_EXECUTED");\n' }, { name: 'index.php', text: '<?php echo "exact";\n' }, { name: 'theme.liquid', text: '{{ product.title | escape }}\n' }, { name: 'readme.txt', text: 'বাংলা\r\n' }];
  const args = fileArgs('independent.' + format, format === 'pdf' ? 'INDEPENDENT_PDF_BODY_7854' : '', format, format === 'zip' ? entries : []);
  let calls = 0;
  const f = await fixture({ complete: async () => ++calls === 1 ? proposal(args) : complete('Committed file.') });
  try {
    const { run } = await create(f, `Create independent.${format}`);
    assert.equal(run.status, 'completed', JSON.stringify(run));
    const receipt = (await f.db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='create_file'", [run.id])).rows[0]?.result;
    assert.ok(receipt?.download);
    const response = await f.send(receipt.download);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((await f.send(receipt.download, undefined, f.other.token)).statusCode, 404);
    if (format === 'pdf') {
      assert.equal(response.rawPayload.subarray(0, 5).toString(), '%PDF-');
      assert.match((await extractPdf(response.rawPayload)).text, /INDEPENDENT_PDF_BODY_7854/);
    } else {
      assert.equal(response.rawPayload.readUInt32LE(0), 0x04034b50);
      const output = execFileSync('python3', ['-I', '-c', 'import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps([{"name":n,"text":z.read(n).decode("utf-8")} for n in z.namelist()]))'], { input: response.rawPayload, timeout: 5000, maxBuffer: 100000 });
      assert.deepEqual(JSON.parse(output.toString()), entries);
    }
    assert.equal(receipt.executed, false);
  } finally { await f.close(); }
});

test('pending-format: ZIP traversal, backslashes, absolute paths, duplicates, spoofed format and UTF-8 byte budgets', { skip: formatsPending }, async () => {
  // Positive control prevents a reject-all ZIP implementation passing adversarial checks.
  const safe = fileArgs('safe.zip', '', 'zip', [{ name: 'a.txt', text: 'A' }]);
  assert.equal(validateTools([toolCall('create_file', safe)]).length, 1);
  const render = (generated as any).renderGeneratedFile;
  assert.equal(typeof render, 'function', 'actual rendering boundary must be available');
  for (const name of ['../escape.txt', 'a/../../escape.txt', '/absolute.txt', 'C:\\escape.txt', '..\\escape.txt', 'a\\..\\escape.txt', 'evil\u0000.txt']) {
    const bad = fileArgs('unsafe.zip', '', 'zip', [{ name, text: 'ATTACK_AS_DATA' }]);
    assert.throws(() => validateTools([toolCall('create_file', bad)]), name);
    await assert.rejects(async () => render(bad), 'render must also reject ' + JSON.stringify(name));
  }
  for (const bad of [fileArgs('x.zip', '', 'zip', [{ name: 'a.txt', text: 'A' }, { name: 'a.txt', text: 'B' }]), fileArgs('pretend.pdf', 'not a PDF'), fileArgs('x.zip', '', 'zip', [{ name: 'a.txt', text: 'é'.repeat(20000) }])]) {
    assert.throws(() => validateTools([toolCall('create_file', bad)]));
  }
});

// The final voice route/input identity contract is not present yet. An adapter
// may map only real HTTP route/response shapes, never simulate implementation.
const voicePending = process.env.INDEPENDENT_VOICE_ADAPTER ? false : 'PENDING: no canonical voice turn route/input identity contract at inspection. Set INDEPENDENT_VOICE_ADAPTER to an evidence-scoped route adapter after implementation stabilizes.';
async function voiceAdapter() {
  const path = process.env.INDEPENDENT_VOICE_ADAPTER!;
  assert.ok(path.startsWith(root), 'adapter must live in this owned evidence directory');
  const adapter = await import(pathToFileURL(path).href);
  assert.equal(typeof adapter.submit, 'function');
  return adapter;
}

test('pending-voice: duplicate speech input across callback IDs commits once, persists into text continuation and reopen', { skip: voicePending, timeout: 30000 }, async () => {
  const adapter = await voiceAdapter();
  let calls = 0;
  const f = await fixture({ complete: async () => ++calls === 1 ? proposal(fileArgs('spoken.txt', 'SPOKEN_EXACT')) : complete('Committed result.') }, adapter.register);
  try {
    const input = { text: 'Create spoken.txt', baseSequence: 0, inputId: 'speech_item_7854', callId: 'callback_a' };
    const first = await adapter.submit(f, input, f.owner.token);
    assert.equal(first.status, 201, JSON.stringify(first));
    assert.equal((await settled(f, first.runId)).status, 'completed');
    const replay = await adapter.submit(f, input, f.owner.token);
    assert.equal(replay.runId, first.runId, 'same callback must recover same run');
    const distinctCallback = await adapter.submit(f, { ...input, callId: 'callback_b' }, f.owner.token);
    assert.ok(distinctCallback.runId === first.runId || distinctCallback.status === 409, 'same speech input must not create a second operation');
    assert.equal(await count(f, 'agent_runs'), 1);
    assert.equal(await count(f, 'artifacts'), 1);
    assert.equal(await count(f, 'agent_tool_receipts'), 1);
    assert.equal(calls, 2);
    const receipt = (await f.db.pool.query("SELECT result FROM agent_tool_receipts WHERE run_id=$1 AND tool='create_file'", [first.runId])).rows[0].result;
    assert.deepEqual((await f.send(receipt.download)).rawPayload, Buffer.from('SPOKEN_EXACT'));
    const history = (await f.send(`/conversations/${f.conversation}/messages`)).json().items;
    assert.deepEqual(history.map((m: any) => m.role), ['user', 'assistant']);
    assert.equal(history[0].text, input.text);
    const text = await create(f, 'Continue this spoken task in text.', history.at(-1).sequence);
    assert.equal(text.run.status, 'completed');
    const reopened = (await f.send(`/conversations/${f.conversation}/messages`)).json().items;
    assert.deepEqual(reopened.map((m: any) => m.role), ['user', 'assistant', 'user', 'assistant']);
    assert.equal((await f.send(receipt.download)).statusCode, 200);
  } finally { await f.close(); }
});

test('pending-voice: owner isolation before dispatch and before replay receipt disclosure', { skip: voicePending, timeout: 30000 }, async () => {
  const adapter = await voiceAdapter();
  let calls = 0;
  const f = await fixture({ complete: async () => { calls++; return complete('PRIVATE_VOICE_RESULT'); } }, adapter.register);
  try {
    const input = { text: 'Private spoken request', baseSequence: 0, inputId: 'private_input', callId: 'private_callback' };
    const foreign = await adapter.submit(f, input, f.other.token);
    assert.ok([401, 403, 404].includes(foreign.status), JSON.stringify(foreign));
    assert.equal(calls, 0);
    assert.equal(await count(f, 'agent_runs'), 0);
    const own = await adapter.submit(f, input, f.owner.token);
    assert.equal(own.status, 201, JSON.stringify(own));
    await settled(f, own.runId);
    const stolen = await adapter.submit(f, input, f.other.token);
    assert.ok([401, 403, 404].includes(stolen.status), JSON.stringify(stolen));
    assert.ok(!JSON.stringify(stolen).includes('PRIVATE_VOICE_RESULT'));
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('pending-voice: failed file operation cannot emit a confirmed saved result', { skip: voicePending, timeout: 30000 }, async () => {
  const adapter = await voiceAdapter();
  const f = await fixture({ complete: async () => proposal(fileArgs('failure.txt', 'ROLL_BACK'), 'I saved failure.txt.') }, adapter.register);
  try {
    await f.db.pool.query("CREATE FUNCTION independent_voice_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CONTROLLED_VOICE_FAILURE'; END $$; CREATE TRIGGER independent_voice_reject BEFORE INSERT ON agent_tool_receipts FOR EACH ROW EXECUTE FUNCTION independent_voice_reject()");
    const response = await adapter.submit(f, { text: 'Create failure.txt', baseSequence: 0, inputId: 'failed_speech', callId: 'failed_callback' }, f.owner.token);
    assert.equal(response.status, 201, JSON.stringify(response));
    const run = await settled(f, response.runId);
    assert.ok(['failed', 'outcome_unknown'].includes(run.status));
    assert.equal(await count(f, 'artifacts'), 0);
    assert.equal(await count(f, 'agent_tool_receipts'), 0);
    const assistant = (await f.send(`/conversations/${f.conversation}/messages`)).json().items.filter((m: any) => m.role === 'assistant');
    assert.equal(assistant.length, 0, 'provider pre-commit success claim must never persist');
    assert.equal(typeof adapter.outcome, 'function', 'adapter must inspect actual voice result/reconciliation boundary');
    const outcome = await adapter.outcome(f, response, f.owner.token);
    assert.equal(outcome.confirmedSaved, false);
    assert.ok(['failed', 'outcome_unknown'].includes(outcome.status));
  } finally { await f.close(); }
});
