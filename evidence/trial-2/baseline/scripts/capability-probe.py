import urllib.request,urllib.error,json
from pathlib import Path
from datetime import datetime,timezone
O=Path('/home/azureuser/nova-community-agent/evidence/trial-2');O.mkdir(exist_ok=True)
def req(url,body=None,token=None):
 headers={'Metadata':'true'} if token is None else {'Authorization':'Bearer '+token,'Content-Type':'application/json'}
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers),timeout=60) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:d=json.loads(e.read())
  except:d={}
  return e.code,d
_,d=req('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fcognitiveservices.azure.com%2F');token=d['access_token']
base='https://sadesheikh-2809-resource.openai.azure.com/openai/v1/'
out=[]
for label,path,body in [('models','models',None),('web-search','responses',{'model':'gpt-5.4-mini','input':'Find the official INPS website. Use web search and return a citation.','tools':[{'type':'web_search_preview'}],'max_output_tokens':500}),('voice','realtime/client_secrets',{'session':{'type':'realtime','model':'gpt-realtime','output_modalities':['audio']}})]:
 s,d=req(base+path,body,token);row={'test':label,'status':s}
 if label=='models':row['models']=[x.get('id') for x in d.get('data',[])]
 elif s!=200:row['error']=d.get('error')
 elif label=='voice':row['session_created']=bool(d.get('value'));row['session_model']=d.get('session',{}).get('model')
 else:row['output']=d.get('output');row['usage']=d.get('usage')
 out.append(row)
(O/'capability-probe.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
