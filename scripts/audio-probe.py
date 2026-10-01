import urllib.request,urllib.error,json,wave,io
from pathlib import Path
_,dummy=(0,0)
req=urllib.request.Request('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fcognitiveservices.azure.com%2F',headers={'Metadata':'true'})
token=json.load(urllib.request.urlopen(req))['access_token'];base='https://sadesheikh-2809-resource.openai.azure.com/openai/v1/'
out=[]
for model in ['gpt-realtime-2.1-mini','gpt-realtime-mini']:
 body={'session':{'type':'realtime','model':model,'output_modalities':['audio']}}
 try:
  with urllib.request.urlopen(urllib.request.Request(base+'realtime/client_secrets',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=30) as r:d=json.load(r);out.append({'type':'realtime','model':model,'status':r.status,'created':bool(d.get('value'))})
 except urllib.error.HTTPError as e:out.append({'type':'realtime','model':model,'status':e.code,'error':json.load(e).get('error')})
try:
 body={'model':'gpt-4o-mini-tts','input':'Ciao, questa è una prova audio di Nova.','voice':'alloy','response_format':'wav'}
 with urllib.request.urlopen(urllib.request.Request(base+'audio/speech',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=40) as r:
  audio=r.read();Path('/home/azureuser/nova-community-agent/evidence/trial-2/voice-fixture.wav').write_bytes(audio);out.append({'type':'tts','status':r.status,'bytes':len(audio)})
 boundary='novafixture';payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-4o-mini-transcribe\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode()+audio+f'\r\n--{boundary}--\r\n'.encode()
 with urllib.request.urlopen(urllib.request.Request(base+'audio/transcriptions',data=payload,headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=40) as r:out.append({'type':'stt','status':r.status,'text':json.load(r).get('text')})
except urllib.error.HTTPError as e:out.append({'type':'audio','status':e.code,'error':json.load(e).get('error')})
p=Path('/home/azureuser/nova-community-agent/evidence/trial-2/audio-probe.json');p.write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
