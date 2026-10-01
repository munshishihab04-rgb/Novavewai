import asyncio,json,subprocess
from pathlib import Path
import edge_tts
O=Path('/home/azureuser/nova-community-agent/evidence/voice-language-1')
items=[('it','it-IT-ElsaNeural','Ciao Nova. Quale documento devo preparare per presentarmi a un colloquio di lavoro? Rispondi brevemente.'),('bn','bn-BD-NabanitaNeural','আমি একটি গুদামে কাজ করতে চাই। সাক্ষাৎকারে নিজের অভিজ্ঞতা কীভাবে বলব? সংক্ষেপে বলুন।'),('en','en-GB-SoniaNeural','What should I say if I do not remember the exact dates of my previous job? Please keep your answer short.')]
async def main():
 for language,voice,text in items:
  p=O/(language+'.mp3');await edge_tts.Communicate(text,voice).save(str(p));subprocess.run(['ffmpeg','-y','-i',str(p),'-ar','48000','-ac','1',str(O/(language+'.wav'))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 (O/'fixtures.json').write_text(json.dumps([{'language':l,'voice':v,'text':t} for l,v,t in items],ensure_ascii=False,indent=2));print('Three speech fixtures generated')
asyncio.run(main())
