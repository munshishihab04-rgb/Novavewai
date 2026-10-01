import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/voice-design-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']);smoke=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text());ctx=await b.new_context(permissions=['microphone'],viewport={'width':390,'height':844});page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(BASE+'/#invite='+smoke['invite']);await page.get_by_role('button',name='Entra nel tuo spazio').click();await page.locator('#shell').wait_for(state='visible');await page.locator('[data-action=voice]').first.click();await page.get_by_role('button',name='Avvia microfono',exact=True).click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  await page.evaluate("voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Di soltanto: Ciao, sono Nova.'}]}}));voiceChannel.send(JSON.stringify({type:'response.create'}))")
  stats=[]
  for _ in range(50):
   await page.wait_for_timeout(300);stats=await page.evaluate("async()=>[...[...await voicePeer.getStats()].map(x=>x[1])].filter(x=>x.type==='inbound-rtp'&&x.kind==='audio').map(x=>({bytes:x.bytesReceived,packets:x.packetsReceived}))")
   if stats and stats[0]['bytes']>1000:break
  assert stats and stats[0]['bytes']>1000,stats;await expect(page.locator('#voicepanel')).to_have_attribute('data-state','speaking',timeout=30000);await page.screenshot(path=str(O/'public-mobile.png'))
  await page.get_by_role('button',name='Disattiva microfono',exact=True).click();assert await page.evaluate('voiceStream.getAudioTracks()[0].enabled===false');await page.get_by_role('button',name='Termina sessione',exact=True).click();assert await page.evaluate('voicePeer===null&&voiceStream===null');assert not errors,errors
  result={'public_url':BASE,'real_webrtc':True,'audio_stats':stats,'state_from_provider':'speaking','real_track_muted':True,'close_released':True,'page_errors':errors,'human_microphone_tested':False};(O/'public-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await b.close()
asyncio.run(main())
