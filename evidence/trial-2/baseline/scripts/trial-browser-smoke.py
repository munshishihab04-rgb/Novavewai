import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright, expect
ROOT=Path('/home/azureuser/nova-community-agent');OUT=ROOT/'evidence/trial-1';OUT.mkdir(exist_ok=True)
BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 smoke=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000});page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/#invite='+smoke['invite']);await page.get_by_role('button',name='Entra nel tuo spazio').click();await page.locator('#shell').wait_for(state='visible')
  assert not await page.evaluate('location.hash')
  await page.locator('#homeinput').fill('Test sintetico: crea e salva con il tool una bozza intitolata PROVA-NOVA con testo esatto: Documento sintetico di prova. Non contiene dati personali. Poi chiedimi quale modifica voglio.')
  await page.get_by_role('button',name='Invia messaggio',exact=True).click()
  await expect(page.locator("#messages")).to_contain_text("Apri risultato",timeout=100000)
  await expect(page.locator("#cancel")).to_be_hidden(timeout=100000)
  await page.get_by_role('button',name='Apri risultato').first.click();await expect(page.locator("#artifacttext")).to_contain_text("Documento sintetico")
  await page.get_by_role('button',name='Modifica',exact=True).click();await page.locator('#editor').fill('Documento sintetico di prova. Modifica UI verificata.');await page.get_by_role('button',name='Salva modifica').click();await expect(page.locator("#artifacttext")).to_contain_text("Modifica UI verificata")
  await page.reload();await page.locator('#shell').wait_for(state='visible');await page.locator('#homerecent button').first.click();await expect(page.locator("#artifacttext")).to_contain_text("Modifica UI verificata")
  await page.screenshot(path=str(OUT/'desktop-live.png'),full_page=True)
  await page.set_viewport_size({'width':390,'height':844});await page.get_by_role('button',name='Apri risultato').first.click();await expect(page.locator('.studio')).to_be_visible();await expect(page.locator('.chat')).to_be_hidden();assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth');await page.screenshot(path=str(OUT/'mobile-live.png'),full_page=True)
  # Save browser auth only in a private file for restart readback; never in evidence.
  await context.storage_state(path='/home/azureuser/.local/share/nova-community-trial/smoke-browser.json')
  Path('/home/azureuser/.local/share/nova-community-trial/smoke-browser.json').chmod(0o600)
  result={'public_url':BASE,'login':True,'fragment_cleared':True,'real_model_artifact_created':True,'edit_saved':True,'reload_preserved':True,'mobile_studio':True,'horizontal_overflow':False,'page_errors':errors};assert not errors
  (OUT/'browser-smoke.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await browser.close()
asyncio.run(main())
