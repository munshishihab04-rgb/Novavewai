from pathlib import Path
import subprocess,json
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/agent-review-2'
results=[]
for i in range(10):
 p=O/f'file-put-repeat-{i+1}.log'
 with p.open('w') as log:
  run=subprocess.run(['node','--import','tsx','--test','--test-reporter=tap','--test-name-pattern=lease loss during actual file put','evidence/agent-review-2/supplemental.test.ts'],cwd=R,stdout=log,stderr=subprocess.STDOUT,timeout=30)
 results.append({'log':p.name,'exit_code':run.returncode})
 (O/'file-put-repeat-results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(results[-1],flush=True)
