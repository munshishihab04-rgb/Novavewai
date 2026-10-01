from pathlib import Path
import subprocess,json,re,hashlib,difflib,time
R=Path('/home/azureuser/nova-community-agent'); O=R/'evidence/agent-review-2'
D=O/'baseline-probes'; D.mkdir(exist_ok=True)
for name in ['adversarial.test.ts','lease-loss.test.ts']:
    src=(R/'evidence/agent-review-1'/name).read_text()
    adapted=src.replace('../../src/','../../agent-fix-1/baseline/src/').replace('../../tests/','../../agent-fix-1/baseline/tests/').replace("cwd:new URL('../../',import.meta.url)","cwd:new URL('../../agent-fix-1/baseline/',import.meta.url)")
    (D/name).write_text(adapted)
    (D/(name+'.path-only.diff')).write_text(''.join(difflib.unified_diff(src.splitlines(True),adapted.splitlines(True),fromfile='original',tofile='baseline-path-adapted')))
# Final-write assertions are unchanged; select only those tests to avoid old in-process lease crash.
src=(R/'tests/agent-runtime.test.ts').read_text()
adapted=src.replace('../src/','../../agent-fix-1/baseline/src/').replace('./helpers.ts','../../agent-fix-1/baseline/tests/helpers.ts')
(D/'agent-runtime.test.ts').write_text(adapted)
(D/'agent-runtime.path-only.diff').write_text(''.join(difflib.unified_diff(src.splitlines(True),adapted.splitlines(True),fromfile='permanent-runtime',tofile='baseline-path-adapted')))
commands=[
('supplemental',['node','--import','tsx','--test','--test-concurrency=1','evidence/agent-review-2/supplemental.test.ts']),
('baseline-original-probes',['node','--import','tsx','--test','--test-concurrency=1','evidence/agent-review-2/baseline-probes/adversarial.test.ts','evidence/agent-review-2/baseline-probes/lease-loss.test.ts']),
('baseline-final-write-probes',['node','--import','tsx','--test','--test-name-pattern=session final validation','evidence/agent-review-2/baseline-probes/agent-runtime.test.ts'])]
results=[]
for label,command in commands:
    start=time.monotonic()
    with (O/(label+'.log')).open('w') as log:
        proc=subprocess.run(command,cwd=R,stdout=log,stderr=subprocess.STDOUT,timeout=150)
    text=(O/(label+'.log')).read_text()
    counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
    row={'label':label,'command':command,'exit_code':proc.returncode,'seconds':round(time.monotonic()-start,3),'counts':counts,'log':label+'.log','log_sha256':hashlib.sha256(text.encode()).hexdigest()}
    results.append(row);(O/'supplemental-results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
