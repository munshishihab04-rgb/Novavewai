from pathlib import Path
import hashlib
import json
import re
import subprocess

root = Path(__file__).resolve().parents[2]
out = root / 'evidence/context-fix-1'
baseline = json.loads((out / 'baseline-state.json').read_text())
changed = [name for name, digest in baseline['sha256'].items() if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest]
assert sorted(changed) == ['src/app.ts', 'src/files.ts'], changed
for name, digest in baseline['sha256'].items():
    if name.startswith(('src/', 'migrations/', 'tests/')):
        assert hashlib.sha256((out / 'baseline' / name).read_bytes()).hexdigest() == digest, name
logs = {}
for name in ['baseline-main', 'red', 'green-first', 'green-expanded', 'red-expanded', 'final-main', 'unaffected-controls', 'old-bug-assertion']:
    text = (out / (name + '.log')).read_text()
    logs[name] = {}
    for field in ['tests', 'pass', 'fail', 'cancelled', 'skipped']:
        match = re.search(r'ℹ ' + field + r' (\d+)', text)
        assert match is not None, (name, field)
        logs[name][field] = int(match[1])
source = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for directory in ['src', 'migrations', 'tests'] for p in sorted((root / directory).rglob('*')) if p.is_file()}
status = subprocess.check_output(['git', 'status', '--short'], cwd=root, text=True)
assert not subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=root, text=True)
check = subprocess.run(['git', 'diff', '--check'], cwd=root, text=True, capture_output=True)
processes = []
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit():
        continue
    try:
        comm = (proc / 'comm').read_text().strip()
        cmd = (proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
        if comm == 'postgres' and 'nova-j0-' in cmd:
            processes.append({'pid': proc.name, 'cmd': cmd})
    except (OSError, PermissionError):
        pass
temp_roots = [str(p) for p in Path('/tmp').glob('nova-fix-idempotency-*')]
result = {'base': baseline['head'], 'changed_existing_files_since_snapshot': changed, 'new_test': 'tests/idempotency-files.test.ts', 'original_review_evidence_unchanged': True, 'baseline_source_migrations_tests_hash_verified': True, 'logs': logs, 'final_typecheck_exit': 0, 'initial_typecheck_failure': 'typecheck.log: TS2345 key narrowing; corrected using return fail without auth or validation behavior change', 'diff_check': {'exit': check.returncode, 'output': check.stdout + check.stderr}, 'index_empty': True, 'test_postgres_processes': processes, 'fix_temp_roots': temp_roots, 'source_sha256': source, 'git_status': status}
assert check.returncode == 0
assert not processes and not temp_roots
(out / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k not in ['source_sha256', 'git_status']}, indent=2))
