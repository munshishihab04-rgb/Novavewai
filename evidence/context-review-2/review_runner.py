from pathlib import Path
import difflib
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path('/home/azureuser/nova-community-agent')
OUT = ROOT / 'evidence/context-review-2'
OUT.mkdir(exist_ok=True)

def snapshot():
    paths = []
    for directory in ['src', 'tests', 'migrations', 'scripts', 'docs', 'evidence']:
        paths.extend(p for p in (ROOT / directory).rglob('*') if p.is_file() and not p.is_relative_to(OUT))
    paths.extend(p for p in ROOT.iterdir() if p.is_file())
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}

def run(name, args, expected=0):
    env = dict(os.environ, TMPDIR=str(OUT / 'tmp'))
    (OUT / 'tmp').mkdir(exist_ok=True)
    import shlex
    command = 'TMPDIR=' + shlex.quote(str(OUT / 'tmp')) + ' ' + shlex.join(args)
    with (OUT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps({'name': name, 'cwd': str(ROOT), 'command': command, 'expected_exit': expected}) + '\n')
    with (OUT / (name + '.log')).open('w') as f:
        result = subprocess.run(args, cwd=ROOT, env=env, stdout=f, stderr=subprocess.STDOUT)
    text = (OUT / (name + '.log')).read_text()
    import re
    stats = {k: int(v) for k, v in re.findall(r'^(?:#|ℹ) (tests|pass|fail|skipped|cancelled) (\d+)$', text, re.M)}
    record = {'name': name, 'exit_code': result.returncode, 'expected_exit': expected, 'matches_expected': result.returncode == expected, 'counts': stats}
    with (OUT / 'results.jsonl').open('a') as f:
        f.write(json.dumps(record) + '\n')
    print(json.dumps(record), flush=True)
    if result.returncode != expected:
        print(text[-16000:])
        raise SystemExit(1)

if sys.argv[1] == 'prepare':
    (OUT / 'protected-before.json').write_text(json.dumps(snapshot(), indent=2) + '\n')
    original = (ROOT / 'evidence/context-review-1/review.test.ts').read_text()
    corrected = original.replace("test('R1 reproduction: pending file key is consumed by another endpoint'", "test('R1 corrected acceptance: pending upload protects shared key and replays after restart'")
    old = "    assert.equal(conflicting.status, 201); assert.equal(upload.status, 500); assert.equal(persisted[0].state, 'pending'); assert.equal(readyEvents, 0); assert.equal(retry.status, 409);"
    new = """    assert.deepEqual(conflicting, { status: 409, body: { error: 'idempotency_conflict' } });
    assert.equal(upload.status, 201); assert.equal(upload.body.state, 'ready');
    assert.deepEqual(persisted, [{ state: 'ready', request_key: key }]);
    assert.equal(readyEvents, 1); assert.deepEqual(retry, upload);
    assert.deepEqual(cache, [{ response: upload.body, status: 201 }]);
    assert.equal((await f.db.pool.query('SELECT count(*)::int n FROM conversations WHERE owner_id=$1', [f.a.userId])).rows[0].n, 1);
    assert.deepEqual((await readdir(f.root)).sort(), ['.key', upload.body.id].sort());
    const download = await fetch(f.base + `/files/${upload.body.id}/content`, { headers: { authorization: `Bearer ${f.a.token}` } });
    assert.equal(download.status, 200); assert.equal(await download.text(), 'review private বাংলা');"""
    assert old in corrected
    corrected = corrected.replace(old, new)
    old_restart = "    record('R1-after-restart', { files: (await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n, names: await readdir(f.root), retry: await f.post('/files', body, key) });"
    new_restart = """    const afterRestart = { files: (await f.db.pool.query('SELECT count(*)::int n FROM files')).rows[0].n, names: (await readdir(f.root)).sort(), retry: await f.post('/files', body, key) };
    record('R1-after-restart', afterRestart);
    assert.deepEqual(afterRestart, { files: 1, names: ['.key', upload.body.id].sort(), retry: upload });
    assert.equal((await f.db.pool.query("SELECT count(*)::int n FROM outbox WHERE kind='file.ready'")).rows[0].n, 1);"""
    assert old_restart in corrected
    corrected = corrected.replace(old_restart, new_restart)
    (OUT / 'corrected-review.test.ts').write_text(corrected)
    (OUT / 'adaptation.diff').write_text(''.join(difflib.unified_diff(original.splitlines(True), corrected.splitlines(True), fromfile='evidence/context-review-1/review.test.ts', tofile='evidence/context-review-2/corrected-review.test.ts')))
    baseline = corrected.replace("'../../src/", "'../context-fix-1/baseline/src/")
    (OUT / 'corrected-baseline.test.ts').write_text(baseline)
    changes = []
    for p in sorted((ROOT / 'evidence/context-fix-1/baseline').rglob('*')):
        if not p.is_file(): continue
        rel = p.relative_to(ROOT / 'evidence/context-fix-1/baseline')
        current = ROOT / rel
        if current.exists() and p.read_bytes() != current.read_bytes():
            changes.append(str(rel))
            with (OUT / 'fix-vs-baseline.diff').open('a') as f:
                f.write(''.join(difflib.unified_diff(p.read_text().splitlines(True), current.read_text().splitlines(True), fromfile='baseline/' + str(rel), tofile=str(rel))))
    (OUT / 'baseline-comparison.json').write_text(json.dumps({'changed_snapshot_files': changes}, indent=2) + '\n')
    print(json.dumps({'prepared': True, 'changed_snapshot_files': changes}))
elif sys.argv[1] == 'tests':
    tsx = './node_modules/.bin/tsx'
    common = [tsx, '--test', '--test-concurrency=1']
    run('permanent-idempotency', common + ['tests/idempotency-files.test.ts'])
    run('corrected-r1', common + ['--test-name-pattern=R1 corrected acceptance', 'evidence/context-review-2/corrected-review.test.ts'])
    run('unaffected-controls', common + ['--test-name-pattern=CONTROL:|R2 observation', 'evidence/context-review-1/review.test.ts'])
    run('baseline-corrected-r1-red', common + ['--test-name-pattern=R1 corrected acceptance', 'evidence/context-review-2/corrected-baseline.test.ts'], expected=1)
    run('auth-revalidation', common + ['tests/auth-revalidation.test.ts'])
    run('typecheck', ['npm', 'run', 'typecheck'])
    run('diff-check', ['git', 'diff', '--check', '75e1600'])
elif sys.argv[1] == 'cleanup-caches':
    import shutil
    initial = OUT / 'cleanup-and-preservation.json'
    initial.rename(OUT / 'cleanup-before-cache-removal.json')
    children = list((OUT / 'tmp').iterdir())
    assert all(p.name == 'node-compile-cache' or p.name.startswith('tsx-') for p in children)
    for p in children:
        shutil.rmtree(p)
    print('Removed only reviewer-owned Node/tsx compile caches; fixture databases and file roots were already absent.')
elif sys.argv[1] == 'verify':
    before = json.loads((OUT / 'protected-before.json').read_text())
    after = snapshot()
    changed = [p for p in sorted(before.keys() | after.keys()) if before.get(p) != after.get(p)]
    (OUT / 'protected-after.json').write_text(json.dumps(after, indent=2) + '\n')
    temporary = sorted(str(p.relative_to(OUT)) for p in (OUT / 'tmp').rglob('*'))
    processes = subprocess.run(['ps', '-eo', 'pid=,args='], capture_output=True, text=True, check=True).stdout
    owned_processes = [line for line in processes.splitlines() if str(OUT / 'tmp') in line]
    result = {'protected_files_unchanged': not changed, 'changed_outside_review_directory': changed, 'temporary_files_remaining': temporary, 'owned_processes_remaining': owned_processes}
    (OUT / 'cleanup-and-preservation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    assert not changed and not temporary and not owned_processes
else:
    raise SystemExit('unknown mode')
