import json,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
subscription='6220ce8e-fa6e-47a9-93a5-39b8f8d63ae5'
result={'subscription':subscription,'checked_at':datetime.now(timezone.utc).isoformat(),'read_only':True}
def get(url,headers):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:body=json.loads(e.read())
  except Exception:body={}
  return e.code,body
status,data=get('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F',{'Metadata':'true'})
if status==200 and data.get('access_token'):
 headers={'Authorization':'Bearer '+data['access_token']}
 url=f'https://management.azure.com/subscriptions/{subscription}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01'
 accounts=[]
 while url:
  status,body=get(url,headers)
  result['arm_http_status']=status
  if status!=200:
   result['error']={k:body.get('error',{}).get(k) for k in ['code','message']};break
  for row in body.get('value',[]):
   prop=row.get('properties',{})
   accounts.append({'id':row.get('id'),'name':row.get('name'),'kind':row.get('kind'),'location':row.get('location'),'endpoint':prop.get('endpoint'),'endpoints':prop.get('endpoints')})
  url=body.get('nextLink')
  if url and not url.startswith('https://management.azure.com/'):raise RuntimeError('Unexpected pagination host')
 result['accounts']=accounts;result['account_count']=len(accounts)
else:result['identity_http_status']=status
out=Path(__file__).with_name('subscription-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));print('Evidence:',out)
