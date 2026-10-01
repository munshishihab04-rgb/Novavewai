import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/voice-design-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=await b.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/api/workspace',lambda r:r.fulfill(json={'conversations':[],'artifacts':[],'runs':[]}))
  await page.route('**/api/voice/connect',lambda r:r.fulfill(json={'sdp':'fake-answer','maxSeconds':180}))
  for name in ['features.js','style.css']:
   source=O/('candidate-'+name) if os.environ.get('CANDIDATE') else O/('before-'+name)
   def handler(src):
    async def respond(route):await route.fulfill(path=str(src))
    return respond
   await page.route('**/'+name,handler(source))
  await page.goto(BASE);await page.locator('#shell').wait_for(state='visible');await page.locator('[data-action=voice]').first.click();await expect(page.locator('#voicepanel')).to_be_visible()
  box=await page.locator('#voicepanel').bounding_box();assert box['height']>=830 and box['width']>=380,box
  await page.evaluate("""()=>{window.mockTracks=[];window.deferMic=false;navigator.mediaDevices.getUserMedia=async()=>{if(window.deferMic)await new Promise(r=>window.releaseMic=r);const t={enabled:true,stopped:false,stop(){this.stopped=true}};mockTracks.push(t);return {getTracks:()=>[t],getAudioTracks:()=>[t]}};window.RTCPeerConnection=class{constructor(){window.fakePeer=this}addTrack(){}createDataChannel(){return this.channel={readyState:'open',send(){},close(){}}}async createOffer(){return {sdp:'fake-offer'}}async setLocalDescription(){}async setRemoteDescription(){this.channel.onopen()}close(){this.closed=true}}}""")
  await page.get_by_role('button',name='Avvia microfono',exact=True).click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto')
  await page.get_by_role('button',name='Disattiva microfono',exact=True).click();assert await page.evaluate('mockTracks[0].enabled===false');await expect(page.locator('#voicestatus')).to_contain_text('Microfono spento')
  await page.get_by_role('button',name='Attiva microfono',exact=True).click();assert await page.evaluate('mockTracks[0].enabled===true')
  await page.evaluate("fakePeer.channel.onmessage({data:JSON.stringify({type:'output_audio_buffer.started'})})");await expect(page.locator('#voicestatus')).to_contain_text('Nova sta parlando')
  await page.evaluate("fakePeer.channel.onmessage({data:JSON.stringify({type:'response.output_audio_transcript.done',transcript:'Ciao. Da cosa vuoi cominciare?'})})")
  await page.get_by_role('button',name='Mostra sottotitoli').click();await expect(page.locator('#voicecaptions')).to_contain_text('Da cosa vuoi cominciare')
  await page.screenshot(path=str(O/'mobile-captions.png'))
  await page.get_by_role('button',name='Nascondi sottotitoli').click();await page.screenshot(path=str(O/'mobile-voice.png'))
  await page.set_viewport_size({'width':1440,'height':900});await page.screenshot(path=str(O/'desktop-voice.png'))
  await page.get_by_role('button',name='Termina sessione',exact=True).click();assert await page.evaluate('mockTracks.every(t=>t.stopped)');await expect(page.locator('#voicepanel')).to_be_hidden()
  # Close before the browser resolves microphone permission.
  await page.locator('[data-action=voice]').first.click();await page.evaluate('window.deferMic=true');await page.get_by_role('button',name='Avvia microfono',exact=True).click();await page.get_by_role('button',name='Termina sessione',exact=True).click();await page.evaluate('window.releaseMic()');await page.wait_for_timeout(100);assert await page.evaluate('mockTracks.every(t=>t.stopped)')
  await page.set_viewport_size({'width':320,'height':600});await page.locator('[data-action=voice]').first.click();assert not await page.evaluate("document.querySelector('#voicepanel').scrollWidth>innerWidth");assert not errors,errors
  result={'fullscreen_mobile':True,'mute_changes_track':True,'states_from_events':True,'captions_toggle':True,'close_stops_tracks':True,'close_during_permission':True,'small_viewport':True,'console_errors':errors,'provider':'controlled RTC fixture'};print(json.dumps(result));(O/'ui-tests.json').write_text(json.dumps(result,indent=2));await b.close()
asyncio.run(main())
