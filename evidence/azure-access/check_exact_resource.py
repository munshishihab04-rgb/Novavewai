import json, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
project='/subscriptions/6220ce8e-fa6e-47a9-93a5-39b8f8d63ae5/resourceGroups/Nuovaopenai/providers/Microsoft.CognitiveServices/accounts/sadesheikh-2809-resource/projects/sadesheikh-2809'
account=project.rsplit('/projects/',1)[0]
def get(url,headers):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:b=json.loads(e.read())
  except Exception:b={}
  return e.code,b
s,identity=get('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F',{'Metadata':'true'})
result={'checked_at':datetime.now(timezone.utc).isoformat(),'project_id':project,'read_only':True,'checks':[]}
if s==200:
 headers={'Authorization':'Bearer '+identity['access_token']}
 for label,path,version in [('account',account,'2025-06-01'),('project',project,'2025-06-01'),('deployments',account+'/deployments','2024-10-01')]:
  status,body=get('https://management.azure.com'+path+'?api-version='+version,headers)
  entry={'target':label,'http_status':status}
  if status==200:
   if label=='deployments':entry['deployments']=[{'name':r.get('name'),'model':r.get('properties',{}).get('model'),'provisioningState':r.get('properties',{}).get('provisioningState')} for r in body.get('value',[])];entry['has_more']=bool(body.get('nextLink'))
   else:entry.update({'id':body.get('id'),'kind':body.get('kind'),'location':body.get('location'),'endpoint':body.get('properties',{}).get('endpoint'),'endpoints':body.get('properties',{}).get('endpoints')})
  else:entry['error']={k:body.get('error',{}).get(k) for k in ['code','message']}
  result['checks'].append(entry)
else:result['identity_http_status']=s
out=Path(__file__).with_name('exact-resource-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));print('Evidence:',out)
