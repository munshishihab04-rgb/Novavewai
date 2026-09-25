import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile, stat, writeFile, chmod, mkdir, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, request } from './helpers.ts';
import { LocalFiles } from '../src/local-files.ts';
import { hash } from '../src/app.ts';
import { migrate, bootstrap, buildApp } from '../src/app.ts';

export async function fileFixture() {
  const root = await mkdtemp(join(tmpdir(), 'nova-files-'));
  const db = await database(); await migrate(db.pool);
  const a = await bootstrap(db.pool), b = await bootstrap(db.pool);
  let app = (buildApp as any)(db.pool, { fileRoot: root });
  let base = await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (path: string, body: unknown, key = randomUUID(), token = a.token) => request(base, path, token, body, 'POST', key);
  const conv = (await post('/conversations', { title: 'Synthetic upload' })).body;
  return { root, db, a, b, conv, post, get base() { return base; },
    get: (path: string, token = a.token) => request(base, path, token),
    async restart(options = {}) { await app.close(); await db.restart(); app = (buildApp as any)(db.pool, { fileRoot: root, ...options }); base = await app.listen({ host: '127.0.0.1', port: 0 }); },
    async close() { await app.close(); await db.close(); await rm(root, { recursive: true, force: true }); } };
}
export const upload = (conversationId: string, text = 'Private বাংলা résumé') => ({ conversationId, name: 'notes.txt', mime: 'text/plain', dataBase64: Buffer.from(text).toString('base64') });

test('FILE KEY: a previously populated unbound key is never imported', async () => {
  const db = await database(), root = await mkdtemp(join(tmpdir(), 'nova-unbound-key-')); let app: any;
  try {
    await migrate(db.pool); await writeFile(join(root, '.key'), Buffer.alloc(32, 9), { mode: 0o600 });
    app = buildApp(db.pool, { fileRoot: root });
    await assert.rejects(app.listen({ host: '127.0.0.1', port: 0 }));
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM local_storage_binding')).rows[0].n, 0);
  } finally { await app?.close(); await db.close(); await rm(root, { recursive: true, force: true }); }
});

test('FILE AUTH: expiry during real blob write rejects ready commit, recovery cleans pending bytes', async () => {
  const f = await fileFixture(), original = LocalFiles.prototype.put;
  try {
    LocalFiles.prototype.put = async function(owner, id, bytes) {
      await original.call(this, owner, id, bytes);
      await f.db.pool.query('SELECT pg_sleep(1.1)');
    };
    await f.db.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1", [hash(f.a.token)]);
    const result = await f.post('/files', upload(f.conv.id)); assert.equal(result.status, 401);
    assert.equal((await f.db.pool.query('SELECT state FROM files')).rows[0].state, 'pending');
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 0);
    await f.restart(); assert.deepEqual(await readdir(f.root), ['.key']);
  } finally { LocalFiles.prototype.put = original; await f.close(); }
});

test('FILE FS BOUNDARY: write failure reserves quota but produces no ready cache, byte quota serializes', async () => {
  const f = await fileFixture();
  try {
    await chmod(f.root, 0o500);
    assert.equal((await f.post('/files', upload(f.conv.id))).status, 500);
    await chmod(f.root, 0o700);
    assert.equal((await f.db.pool.query('SELECT state FROM files')).rows[0].state, 'pending');
    await f.restart(); assert.deepEqual(await readdir(f.root), ['.key']);
    const results = await Promise.all(Array.from({ length: 9 }, () => f.post('/files', upload(f.conv.id, 'x'.repeat(16384)))));
    assert.equal(results.filter(x => x.status === 201).length, 8); assert.equal(results.filter(x => x.status === 413).length, 1);
    assert.equal((await f.db.pool.query('SELECT sum(size)::int n FROM files')).rows[0].n, 131072);
  } finally { await chmod(f.root, 0o700); await f.close(); }
});

test('FILE STORE IDENTITY: wrong root and missing key fail closed, no replacement key on existing data', async () => {
  const f = await fileFixture();
  const other = await mkdtemp(join(tmpdir(), 'nova-other-files-'));
  let app: any;
  try {
    await f.post('/files', upload(f.conv.id));
    app = buildApp(f.db.pool, { fileRoot: other });
    await assert.rejects(app.listen({ host: '127.0.0.1', port: 0 }), /storage|Storage/);
    await app.close();
    await unlink(join(f.root, '.key'));
    await assert.rejects(f.restart(), /key|Key/);
    assert.equal((await readdir(f.root)).includes('.key'), false);
  } finally { await app?.close(); await f.close(); await rm(other, { recursive: true, force: true }); }
});

test('FILE RECOVERY: real DB failure after blob fsync, pending hidden and startup conservative cleanup', async () => {
  const f = await fileFixture();
  try {
    await f.db.pool.query(`CREATE FUNCTION reject_file_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='file.ready' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_file_ready BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_file_ready()`);
    const key = randomUUID(), body = upload(f.conv.id);
    const result = await f.post('/files', body, key); assert.equal(result.status, 500);
    const pending = (await f.db.pool.query('SELECT id,state FROM files')).rows[0]; assert.equal(pending.state, 'pending');
    assert.ok((await readdir(f.root)).includes(pending.id));
    assert.equal((await f.get(`/files/${pending.id}/content`)).status, 404);
    assert.equal((await f.post('/files', body, key)).body.error, 'upload_pending');
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM idempotency WHERE key=$1', [key])).rows[0].n, 0);
    await f.db.pool.query('DROP TRIGGER reject_file_ready ON outbox');
    await f.restart();
    assert.deepEqual(await readdir(f.root), ['.key']);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n, 0);
    assert.equal((await f.post('/files', body, key)).status, 201);
  } finally { await f.close(); }
});

test('FILE VALIDATION: paths, MIME, strict UTF-8, oversize, quotas and authenticated corruption failures', async () => {
  const f = await fileFixture();
  try {
    const body = upload(f.conv.id);
    for (const name of ['../notes.txt', '/tmp/a.txt', 'a/b.txt', 'a\\\\b.txt', 'a.txt.exe', '%2e%2e.txt']) assert.equal((await f.post('/files', { ...body, name })).status, 400);
    for (const patch of [{ mime: 'application/pdf' }, { path: '/tmp/evil' }, { owner: f.b.userId }, { dataBase64: '/w==' }, { dataBase64: 'SGk=\n' }, { dataBase64: Buffer.from('%PDF-1.7').toString('base64') }, { dataBase64: Buffer.from('bad\u0000text').toString('base64') }]) assert.equal((await f.post('/files', { ...body, ...patch })).status, 400);
    assert.equal((await f.post('/files', upload(f.conv.id, 'x'.repeat(16385)))).status, 413);
    assert.equal((await f.post('/files', body, randomUUID(), f.b.token)).status, 404);
    const file = (await f.post('/files', body)).body;
    const path = join(f.root, file.id), blob = await readFile(path); blob[30] ^= 1; await writeFile(path, blob);
    assert.deepEqual(await f.get(`/files/${file.id}/content`), { status: 409, body: { error: 'file_integrity_failure' } });
    assert.equal((await f.post('/sources', { conversationId: f.conv.id, fileId: file.id })).status, 409);
    await unlink(path); await symlink(join(f.root, '.key'), path);
    assert.equal((await f.get(`/files/${file.id}/content`)).status, 409);
    await assert.rejects(f.db.pool.query("INSERT INTO files(id,owner_id,conversation_id,name,mime,size,hash,state,request_key,fingerprint) VALUES($1,$2,$3,'a.txt','text/plain',1,$4,'pending','foreign','foreign')", [randomUUID(), f.b.userId, f.conv.id, file.hash]), /foreign key/);
    for (let n = 0; n < 15; n++) assert.equal((await f.post('/files', upload(f.conv.id, 'small'))).status, 201);
    assert.equal((await f.post('/files', body)).body.error, 'file_quota_exceeded');
  } finally { await f.close(); }
});

test('FILE PURGING: filesystem failure keeps durable cleanup, restart completes deletion', async () => {
  const f = await fileFixture();
  try {
    const file = (await f.post('/files', upload(f.conv.id))).body;
    await unlink(join(f.root, file.id)); await mkdir(join(f.root, file.id));
    const purged = await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
    assert.deepEqual(purged, { status: 202, body: { status: 'purging' } });
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM file_cleanup')).rows[0].n, 1);
    assert.equal((await f.get('/me/export')).status, 401);
    await rm(join(f.root, file.id), { recursive: true });
    await f.restart(); assert.deepEqual(await readdir(f.root), ['.key']);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM file_cleanup')).rows[0].n, 0);
  } finally { await f.close(); }
});

test('FILE SOURCE: owner-bound immutable UTF-8 snapshot and purge cascade', async () => {
  const f = await fileFixture();
  try {
    const file = (await f.post('/files', upload(f.conv.id))).body;
    const made = await f.post('/sources', { conversationId: f.conv.id, fileId: file.id });
    assert.equal(made.status, 201); assert.equal(made.body.snapshot, 'Private বাংলা résumé');
    assert.equal(made.body.fileId, file.id); assert.equal(made.body.hash, file.hash);
    assert.equal((await f.post('/sources', { conversationId: f.conv.id, fileId: file.id }, randomUUID(), f.b.token)).status, 404);
    const task = (await f.post('/tasks', { conversationId: f.conv.id, goal: 'Use file' })).body;
    const artifact = (await f.post('/artifacts', { taskId: task.id, title: 'Draft', content: { text: 'résumé', language: 'it' } })).body;
    assert.equal((await f.post('/evidence', { sourceId: made.body.id, artifactId: artifact.id, revision: 1, targetKind: 'claim', target: 'document label', excerpt: 'résumé', territory: 'unspecified', validFrom: '2026-01-01', validUntil: '2026-12-31' })).status, 201);
    assert.equal((await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE')).status, 200);
    for (const table of ['files','sources','evidence']) assert.equal((await f.db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    assert.deepEqual(await readdir(f.root), ['.key']);
  } finally { await f.close(); }
});

test('FILES PURGE: remove bytes and cascaded context, never resurrect a late reservation', async () => {
  const f = await fileFixture();
  let release: (() => void) | undefined, late: Promise<any> | undefined;
  try {
    const file = (await f.post('/files', upload(f.conv.id))).body;
    let entered!: () => void;
    const barrier = new Promise<void>(r => { entered = r; });
    const wait = new Promise<void>(r => { release = r; });
    await f.restart({ fileHooks: { afterReservation: async () => { entered(); await wait; } } });
    late = f.post('/files', upload(f.conv.id, 'late private bytes'));
    // A bounded race makes missing hook support fail rather than hang.
    const reached = await Promise.race([barrier.then(() => true), late.then(() => false)]);
    assert.equal(reached, true, 'Upload must have a durable reservation before blob I/O');
    const purged = await request(f.base, '/me', f.a.token, { confirm: 'purge' }, 'DELETE');
    assert.equal(purged.status, 200); assert.deepEqual(purged.body, { status: 'purged' });
    assert.deepEqual((await readdir(f.root)).filter(x => x !== '.key'), []);
    release!(); assert.equal((await late).status, 401);
    assert.equal((await f.get(`/files/${file.id}`)).status, 401);
    await f.restart();
    assert.deepEqual((await readdir(f.root)).filter(x => x !== '.key'), []);
    for (const table of ['files', 'messages', 'sources', 'evidence', 'file_cleanup']) assert.equal((await f.db.pool.query(`SELECT count(*)::int n FROM ${table} WHERE owner_id=$1`, [f.a.userId])).rows[0].n, 0);
  } finally { release?.(); await late?.catch(() => {}); await f.close(); }
});

test('FILES: real encrypted immutable private bytes, owner download and restart', async () => {
  const f = await fileFixture();
  try {
    const body = upload(f.conv.id), key = randomUUID();
    const made = await f.post('/files', body, key); assert.equal(made.status, 201);
    assert.equal(made.body.state, 'ready'); assert.equal(made.body.storage, 'local-encrypted-development');
    assert.deepEqual(await f.post('/files', body, key), made);
    assert.equal((await f.post('/files', { ...body, name: 'other.txt' }, key)).status, 409);
    const names = await readdir(f.root); assert.ok(names.includes(made.body.id)); assert.ok(names.includes('.key'));
    const blob = await readFile(join(f.root, made.body.id)); assert.ok(!blob.includes(Buffer.from('Private')));
    assert.equal((await stat(f.root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(f.root, made.body.id))).mode & 0o777, 0o600);
    assert.equal((await stat(join(f.root, '.key'))).mode & 0o777, 0o600);
    assert.equal((await f.get(`/files/${made.body.id}`, f.b.token)).status, 404);
    assert.equal((await f.get(`/files/${made.body.id}/content`, f.b.token)).status, 404);
    await f.restart();
    const downloaded = await fetch(f.base + `/files/${made.body.id}/content`, { headers: { authorization: `Bearer ${f.a.token}` } });
    assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.match(downloaded.headers.get('content-disposition')!, /^attachment;/);
    const bytes = Buffer.from(await downloaded.arrayBuffer()); assert.equal(bytes.toString('base64'), body.dataBase64);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), made.body.hash);
    const metadata = await f.get(`/files/${made.body.id}`); assert.deepEqual(metadata.body, made.body);
    await assert.rejects(f.db.pool.query('UPDATE files SET name=$1 WHERE id=$2', ['tampered.txt', made.body.id]), /immutable/);
    const exported = (await f.get('/me/export')).body;
    assert.equal(exported.files[0].id, made.body.id); assert.equal(exported.fileDelivery.binaryIncluded, false);
    assert.ok(!JSON.stringify(exported).includes(body.dataBase64));
  } finally { await f.close(); }
});
