import asyncio,json,base64
from pathlib import Path
from playwright.async_api import async_playwright,expect
O=Path('/home/azureuser/nova-community-agent/evidence/trial-2');BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 pcm=base64.b64encode((O/'input-question.pcm').read_bytes()).decode();assert len(pcm)>1000
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']);ctx=await b.new_context(storage_state='/home/azureuser/.local/share/nova-community-trial/smoke-browser2.json',permissions=['microphone']);page=await ctx.new_page();await page.goto(BASE);await page.locator('#shell').wait_for(state='visible');await page.locator('[data-action=voice]').first.click();await page.get_by_role('button',name='Avvia microfono').click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  await page.evaluate("""(audio)=>{window.voiceReply='';window.events=[];voiceChannel.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.type==='response.output_audio_transcript.done')window.voiceReply=d.transcript;if(d.type==='error')events.push(d.error?.code)});voiceChannel.send(JSON.stringify({type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:null}}}}));for(let i=0;i<audio.length;i+=16000)voiceChannel.send(JSON.stringify({type:'input_audio_buffer.append',audio:audio.slice(i,i+16000)}));voiceChannel.send(JSON.stringify({type:'input_audio_buffer.commit'}));voiceChannel.send(JSON.stringify({type:'response.create'}));}""",pcm)
  for _ in range(100):
   await page.wait_for_timeout(300)
   if await page.evaluate('window.voiceReply'):break
  reply=await page.evaluate('window.voiceReply');errors=await page.evaluate('window.events');print(json.dumps({'reply':reply,'errors':errors}));assert any(x in reply.lower() for x in ['cinque','5']),reply;await page.get_by_role('button',name='Termina',exact=True).click();(O/'voice-input-proof.json').write_text(json.dumps({'synthetic_spoken_input':True,'reply':reply,'errors':errors,'human_phone_microphone_tested':False},indent=2));await b.close()
asyncio.run(main())
