import asyncio,json,base64,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/voice-language-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 invite=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite'];results=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']);ctx=await b.new_context(permissions=['microphone'],viewport={'width':1440,'height':1000});page=await ctx.new_page();await page.goto(BASE+'/#invite='+invite);await page.get_by_role('button',name='Entra nel tuo spazio').click();await page.locator('#shell').wait_for(state='visible');await page.locator('[data-action=voice]').first.click()
  if os.environ.get('LANG_MODE'):await page.get_by_role('combobox',name='Lingua iniziale · riconoscimento automatico durante il dialogo').select_option(os.environ['LANG_MODE'])
  await page.get_by_role('button',name='Avvia microfono',exact=True).click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  await page.evaluate("""async()=>{window.logEvents=[];window.audioContext=new AudioContext({sampleRate:48000});await audioContext.resume();window.destination=audioContext.createMediaStreamDestination();window.silent=audioContext.createOscillator();window.silentGain=audioContext.createGain();silentGain.gain.value=0;silent.connect(silentGain).connect(destination);silent.start();await voicePeer.getSenders().find(s=>s.track?.kind==='audio').replaceTrack(destination.stream.getAudioTracks()[0]);voiceChannel.addEventListener('message',e=>{const d=JSON.parse(e.data);if(['response.done','output_audio_buffer.stopped','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','response.output_audio_transcript.done','error'].includes(d.type))logEvents.push({at:performance.now(),type:d.type,text:d.transcript,status:d.response?.status,error:d.error?.code})})}""")
  for lang in ['it','bn','en']:
   audio=base64.b64encode((O/(lang+'.wav')).read_bytes()).decode();start=await page.evaluate('performance.now()')
   duration=await page.evaluate("""async(encoded)=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const buffer=await audioContext.decodeAudioData(bytes.buffer);const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();await new Promise(r=>source.onended=r);return buffer.duration}""",audio)
   for _ in range(100):
    await page.wait_for_timeout(400)
    events=await page.evaluate('(start)=>logEvents.filter(e=>e.at>start)',start)
    if any(x['type']=='response.done' and x.get('status')=='completed' for x in events) and any(x['type']=='output_audio_buffer.stopped' for x in events):break
   texts=[x.get('text') for x in events if x['type']=='response.output_audio_transcript.done'];results.append({'input_language':lang,'audio_seconds':duration,'responses':texts,'events':events});print(json.dumps(results[-1],ensure_ascii=False),flush=True)
  await page.get_by_role('button',name='Termina sessione',exact=True).click();await b.close()
 (O/(os.environ.get('RUN_LABEL','probe')+'.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2))
asyncio.run(main())
