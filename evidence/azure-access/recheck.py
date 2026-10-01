import json, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
endpoint='https://sadesheikh-2809-resource.openai.azure.com/openai/v1/chat/completions'
result={'checked_at':datetime.now(timezone.utc).isoformat(),'endpoint':endpoint,'requested_model':'gpt-5.4-mini','rbac_changed':False,'secrets_written':False}
try:
 req=urllib.request.Request('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fcognitiveservices.azure.com%2F',headers={'Metadata':'true'})
 with urllib.request.urlopen(req,timeout=15) as r: identity=json.load(r)
 token=identity['access_token'];result['managed_identity_available']=True
 payload={'model':'gpt-5.4-mini','messages':[{'role':'user','content':'Reply with exactly OK.'}],'max_completion_tokens':32}
 req=urllib.request.Request(endpoint,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=60) as r: status=r.status; data=json.load(r)
 except urllib.error.HTTPError as e:
  status=e.code
  try:data=json.loads(e.read())
  except Exception:data={}
 result['inference_http_status']=status
 if status==200:
  result['response_model']=data.get('model');result['usage']=data.get('usage');result['response_text']=data.get('choices',[{}])[0].get('message',{}).get('content');result['actual_model_inference_verified']=True
 else:
  result['error_code']=data.get('error',{}).get('code');result['error_message']=data.get('error',{}).get('message','')[:1200];result['actual_model_inference_verified']=False
except Exception as e:
 result['probe_error_type']=type(e).__name__;result['actual_model_inference_verified']=False
out=Path(__file__).with_name('recheck-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));print('Evidence:',out)
