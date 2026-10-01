from pathlib import Path
import hashlib, json, shutil, subprocess, time, re
ROOT=Path('/home/azureuser/nova-community-agent')
OUT=ROOT/'evidence/agent-review-2'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def manifest():
    paths=[]
    for folder in ['src','scripts','tests','migrations','docs','evidence/agent-review-1','evidence/agent-fix-1']:
        paths.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and 'node_modules' not in p.parts)
    paths.extend(ROOT/name for name in ['package.json','package-lock.json','tsconfig.json'])
    return {str(p.relative_to(ROOT)):digest(p) for p in sorted(set(paths))}
before=manifest()
(OUT/'source-hashes-before.json').write_text(json.dumps(before,indent=2)+'\n')
for name in ['adversarial.test.ts','lease-loss.test.ts']:
    shutil.copyfile(ROOT/'evidence/agent-review-1'/name,OUT/name)
    assert digest(OUT/name)==digest(ROOT/'evidence/agent-review-1'/name)
commands=[
 ('permanent-regressions',['node','--import','tsx','--test','--test-concurrency=1','tests/agent-review-regressions.test.ts','tests/agent-runtime.test.ts']),
 ('unchanged-original-probes',['node','--import','tsx','--test','--test-concurrency=1','evidence/agent-review-2/adversarial.test.ts','evidence/agent-review-2/lease-loss.test.ts']),
 ('full-suite',['npm','test']),
 ('typecheck',['npm','run','typecheck']),
 ('diff-check',['git','diff','--check'])
]
results=[]
for label,command in commands:
    start=time.monotonic()
    with (OUT/(label+'.log')).open('w') as log:
        run=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=420)
    text=(OUT/(label+'.log')).read_text()
    counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
    result={'label':label,'command':command,'cwd':str(ROOT),'exit_code':run.returncode,'seconds':round(time.monotonic()-start,3),'counts':counts,'log':label+'.log','log_sha256':digest(OUT/(label+'.log'))}
    results.append(result)
    (OUT/'test-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(result),flush=True)
after=manifest()
(OUT/'source-hashes-after.json').write_text(json.dumps(after,indent=2)+'\n')
changes=[p for p in sorted(set(before)|set(after)) if before.get(p)!=after.get(p)]
(OUT/'preservation.json').write_text(json.dumps({'protected_files':len(before),'changes':changes,'original_probe_copies_byte_identical':all(digest(OUT/n)==digest(ROOT/'evidence/agent-review-1'/n) for n in ['adversarial.test.ts','lease-loss.test.ts'])},indent=2)+'\n')
print('Protected file changes:',changes,flush=True)
