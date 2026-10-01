import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/trial-2';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 invite=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite']
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'])
  context=await browser.new_context(permissions=['microphone'],viewport={'width':1440,'height':1000});page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/#invite='+invite);await page.get_by_role('button',name='Entra nel tuo spazio').click();await page.locator('#shell').wait_for(state='visible')
  await page.locator('[data-action=voice]').first.click();await page.get_by_role('button',name='Avvia microfono').click();await expect(page.locator('#voicestatus')).to_contain_text('In ascolto',timeout=60000)
  await page.evaluate("voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Di soltanto: Ciao, sono Nova. Questa è una prova audio.'}]}}));voiceChannel.send(JSON.stringify({type:'response.create'}))")
  stats=None
  for i in range(30):
   await page.wait_for_timeout(500)
   stats=await page.evaluate("async()=>{const stats=await voicePeer.getStats();return [...stats.values()].filter(x=>x.type==='inbound-rtp'&&x.kind==='audio').map(x=>({bytes:x.bytesReceived,packets:x.packetsReceived}))}")
   if stats and stats[0]['bytes']>1000:break
  assert stats and stats[0]['bytes']>1000,stats
  await page.get_by_role('button',name='Termina',exact=True).click();assert await page.evaluate('voicePeer===null&&voiceStream===null')
  await page.get_by_role('button',name='Cerca sul web').click();await page.get_by_role('textbox',name='Domanda di ricerca').fill('Qual è il sito ufficiale INPS?');await page.get_by_role('button',name='Cerca nelle fonti').click();await expect(page.locator('.researchresult')).to_contain_text('Fonti consultate',timeout=90000);links=await page.locator('.researchresult a').evaluate_all('(xs)=>xs.map(x=>x.href)');assert any('inps.it' in u for u in links);await page.get_by_role('button',name='Chiudi',exact=True).click()
  await page.locator('#file').set_input_files(str(O/'fixture.pdf'));await expect(page.locator('.toast')).to_contain_text('PDF letto',timeout=30000)
  await page.locator('#chatinput').fill('Leggi il PDF caricato e crea una bozza di curriculum fedele, mantenendo nome, esperienza e competenze. Usa titoli di sezione con ##. Salvala con create_artifact e chiedimi se desidero modifiche.');await page.get_by_role('button',name='Invia risposta',exact=True).click();await expect(page.locator('#messages')).to_contain_text('Apri risultato',timeout=100000);await expect(page.locator('#cancel')).to_be_hidden(timeout=60000);await page.get_by_role('button',name='Apri risultato').first.click();await expect(page.locator('#artifacttext')).to_contain_text('Amina')
  async with page.expect_download() as download:await page.get_by_role('button',name='Scarica PDF',exact=True).click()
  await (await download.value).save_as(O/'cv-export.pdf');await page.screenshot(path=str(O/'live-desktop.png'),full_page=True)
  await context.storage_state(path='/home/azureuser/.local/share/nova-community-trial/smoke-browser2.json');Path('/home/azureuser/.local/share/nova-community-trial/smoke-browser2.json').chmod(0o600)
  result={'voice_ui_connected':True,'outbound_audio_received':stats,'voice_closed':True,'web_search_sources':links,'pdf_ingestion':True,'real_model_cv_from_pdf':True,'pdf_download':True,'page_errors':errors,'microphone':'fake device; real human speech not tested'};assert not errors;(O/'public-smoke.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await browser.close()
asyncio.run(main())
