import hashlib
import json
import pathlib
import subprocess

base = pathlib.Path.cwd()
assert str(base) == '/home/azureuser/nova-community-agent'
paths = ['src/context.ts', 'src/provenance.ts', 'src/files.ts', 'src/local-files.ts', 'src/file-lifecycle.ts', 'src/app.ts', 'src/privacy.ts', 'scripts/server.ts', 'tests/context.test.ts', 'tests/files.test.ts', 'tests/cli.test.ts']
paths += [str(p.relative_to(base)) for p in sorted((base / 'migrations').glob('*.sql')) if p.name[:3] in ['006', '007', '008', '009', '010', '011']]
state = {'baseline': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'sha256': {p: hashlib.sha256((base / p).read_bytes()).hexdigest() for p in paths}}
(base / 'evidence/context-review-1/reviewed-state.json').write_text(json.dumps(state, indent=2) + '\n')
remaining = []
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit():
        continue
    try:
        cmd = (proc / 'cmdline').read_bytes().split(b'\0')
    except (PermissionError, FileNotFoundError, ProcessLookupError):
        continue
    if cmd and b'postgres' in cmd[0] and any(b'nova-j0-' in x for x in cmd):
        remaining.append({'pid': proc.name, 'command': [x.decode(errors='replace') for x in cmd if x]})
cleanup = {'remaining_test_postgres_processes': remaining, 'remaining_review_temp_directories': [str(x) for x in pathlib.Path('/tmp').glob('nova-review-context-*')]}
(base / 'evidence/context-review-1/cleanup.json').write_text(json.dumps(cleanup, indent=2) + '\n')
print(json.dumps({'reviewed_files': len(paths), 'cleanup': cleanup}))
