import asyncio,json,base64,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/trial-2';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']);ctx=await b.new_context(storage_state='/home/azureuser/.local/share/nova-community-trial/smoke-browser2.json',permissions=['microphone']);page=await ctx.new_page();await page.goto(BASE);await page.locator('#shell').wait_for(state='visible');await page.locator('[data-action=voice]').first.click();await page.get_by_role('button',name='Avvia microfono').click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  # Record actual generated speech, then feed that audio back as a synthetic spoken turn.
  await page.evaluate("""()=>{window.recorded=[];window.recorder=new MediaRecorder(voiceAudio.srcObject,{mimeType:'audio/webm;codecs=opus'});recorder.ondataavailable=e=>recorded.push(e.data);recorder.start();window.done=false;voiceChannel.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.type==='response.done')window.done=true});voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Ripeti esattamente, senza altre parole: Ciao Nova, quanto fa due più tre?'}]}}));voiceChannel.send(JSON.stringify({type:'response.create'}));}""")
  for _ in range(60):
   await page.wait_for_timeout(300)
   if await page.evaluate('window.done'):break
  await page.wait_for_timeout(1000)
  audio=await page.evaluate("""async()=>{await new Promise(r=>{recorder.onstop=r;recorder.stop()});return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(new Blob(recorded,{type:'audio/webm'}))})}""")
  (O/'synthetic-voice.webm').write_bytes(base64.b64decode(audio));subprocess.run(['ffmpeg','-y','-i',str(O/'synthetic-voice.webm'),'-ar','24000','-ac','1','-f','s16le',str(O/'synthetic-voice.pcm')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  await page.get_by_role('button',name='Termina',exact=True).click()
  await page.locator('[data-action=voice]').first.click();await page.get_by_role('button',name='Avvia microfono').click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  await page.evaluate("""()=>{window.done=false;voiceChannel.addEventListener('message',e=>{if(JSON.parse(e.data).type==='response.done')window.done=true})}""")
  pcm=base64.b64encode((O/'synthetic-voice.pcm').read_bytes()).decode()
  await page.evaluate("""(audio)=>{window.done=false;window.voiceReply='';voiceChannel.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.type==='response.output_audio_transcript.done')window.voiceReply=d.transcript});voiceChannel.send(JSON.stringify({type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:null}}}}));voiceChannel.send(JSON.stringify({type:'input_audio_buffer.append',audio}));voiceChannel.send(JSON.stringify({type:'input_audio_buffer.commit'}));voiceChannel.send(JSON.stringify({type:'response.create'}));}""",pcm)
  for _ in range(100):
   await page.wait_for_timeout(300)
   if await page.evaluate('window.done'):break
  reply=await page.evaluate('window.voiceReply');print(json.dumps({'synthetic_spoken_turn_reply':reply,'recorded_bytes':len(base64.b64decode(audio))}));assert any(x in reply.lower() for x in ['cinque','5']),reply
  await page.get_by_role('button',name='Termina',exact=True).click();(O/'voice-input-proof.json').write_text(json.dumps({'synthetic_spoken_input':True,'reply':reply,'human_phone_microphone_tested':False},indent=2));await b.close()
asyncio.run(main())
