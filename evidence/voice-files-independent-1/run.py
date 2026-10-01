#!/usr/bin/env python3
"""Bounded local acceptance runner; retains actual output and source hashes."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

def source_hashes():
    paths = sorted((ROOT / 'src').glob('*.ts')) + sorted((ROOT / 'migrations').glob('*.sql')) + [ROOT / 'tests/helpers.ts']
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}

if __name__ == '__main__':
    before = source_hashes()
    command = [str(ROOT / 'node_modules/.bin/tsx'), '--test', '--test-reporter=tap', '--test-concurrency=1', str(HERE / 'acceptance.test.ts')]
    env = dict(os.environ, TSX_DISABLE_CACHE='1', TMPDIR=str(HERE / '.tmp'), NOVA_JOBS_CACHE_DIR=str(HERE / '.tmp/unused-jobs'))
    (HERE / '.tmp').mkdir(mode=0o700, exist_ok=True)
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        output, code = result.stdout + result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        output = 'HARNESS TIMEOUT: 120 seconds; no passing result claimed.\n' + str(error.stdout or '') + str(error.stderr or '')
        code = 124
    after = source_hashes()
    changed = [p for p in sorted(before.keys() | after.keys()) if before.get(p) != after.get(p)]
    counts = {name: int(value) for name, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', output, re.M)}
    record = {'command': command, 'exit_code': code, 'counts': counts, 'source_changed_during_run': changed, 'before_sha256': before, 'after_sha256': after, 'provider': 'injected controlled outputs; global fetch denied', 'formats_opt_in': env.get('INDEPENDENT_FORMATS_READY') == '1', 'voice_adapter': env.get('INDEPENDENT_VOICE_ADAPTER'), 'caveat': 'Local Fastify inject + private real PostgreSQL. Not real speech, browser, public deployment or live provider evidence.'}
    (HERE / 'latest.tap').write_text(output)
    (HERE / 'latest.json').write_text(json.dumps(record, indent=2) + '\n')
    print(output, end='')
    print(json.dumps({'exit_code': code, 'counts': counts, 'source_changed_during_run': changed}))
    sys.exit(code)
