from pathlib import Path
import json,subprocess,hashlib,re,difflib
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/agent-fix-2'
commands=[('original-probes',['node','--import','tsx','--test','--test-reporter=tap','--test-concurrency=1',*[str((O/n).relative_to(R)) for n in ['adversarial.test.ts','lease-loss.test.ts','queued-lease-error.test.ts','delayed-lease-error.test.ts','delayed-lease-no-listener.test.ts','supplemental.test.ts']]]),('full-suite',['npm','test']),('typecheck',['npm','run','typecheck']),('diff-check',['git','diff','--check'])]
results=[]
for name,cmd in commands:
 with (O/(name+'.log')).open('w') as f:p=subprocess.run(cmd,cwd=R,stdout=f,stderr=subprocess.STDOUT,timeout=480)
 text=(O/(name+'.log')).read_text();counts={k:int(v) for k,v in re.findall(r'^(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)$',text,re.M)}
 row={'name':name,'command':cmd,'exit_code':p.returncode,'counts':counts};results.append(row);(O/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
before=json.loads((O/'before-sha256.json').read_text());changed=[p for p,h in before.items() if hashlib.sha256((R/p).read_bytes()).hexdigest()!=h]
assert changed==['src/runtime.ts'],changed
(O/'runtime.diff').write_text(''.join(difflib.unified_diff((O/'runtime-before.ts').read_text().splitlines(True),(R/'src/runtime.ts').read_text().splitlines(True),fromfile='before/src/runtime.ts',tofile='src/runtime.ts')))
verification={'passed':all(r['exit_code']==0 for r in results),'changed_existing_files':changed,'new_permanent_test':'tests/agent-lease-order.test.ts','historical_evidence_unchanged':True,'source_sha256':{p:hashlib.sha256((R/p).read_bytes()).hexdigest() for p in ['src/runtime.ts','src/agent.ts','tests/agent-lease-order.test.ts']},'results':results}
(O/'verification.json').write_text(json.dumps(verification,indent=2)+'\n');print(json.dumps(verification),flush=True)
