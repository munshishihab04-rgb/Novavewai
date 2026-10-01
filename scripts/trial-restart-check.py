import asyncio,json,hashlib
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path('/home/azureuser/nova-community-agent');OUT=ROOT/'evidence/trial-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);c=await b.new_context(storage_state='/home/azureuser/.local/share/nova-community-trial/smoke-browser.json',viewport={'width':1440,'height':1000});page=await c.new_page();await page.goto(BASE);await page.locator('#shell').wait_for(state='visible');await page.locator('#homerecent button').first.click();await expect(page.locator('#artifacttext')).to_contain_text('Modifica UI verificata');await page.get_by_role('button',name='Apri risultato').first.click();await expect(page.locator('#revisionlabel')).to_contain_text('Versione 2')
  # A held old preview cannot overwrite an editor opened after the request.
  arrived=asyncio.Event();release=asyncio.Event()
  async def hold(route):
   response=await route.fetch();arrived.set();await release.wait();await route.fulfill(response=response)
  await page.route('**/api/artifacts/*/revisions/*',hold,times=1)
  await page.get_by_role('button',name='Apri risultato').first.click();await arrived.wait();await page.get_by_role('button',name='Modifica',exact=True).click();await page.locator('#editor').fill('UNSAVED RACE CONTROL');release.set();await page.wait_for_timeout(400);await expect(page.locator('#editor')).to_be_visible();assert await page.locator('#editor').input_value()=='UNSAVED RACE CONTROL'
  page.on('dialog',lambda d:d.accept());await page.get_by_role('button',name='Anteprima',exact=True).click()
  async with page.expect_download() as info:await page.get_by_role('button',name='Scarica .txt').click()
  dl=await info.value;dest=OUT/'synthetic-download.txt';await dl.save_as(dest);assert 'Modifica UI verificata' in dest.read_text()
  for width,height in [(390,844),(320,700),(844,390)]:
   await page.set_viewport_size({'width':width,'height':height});assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
  anon=await b.new_context();resp=await anon.request.get(BASE+'/api/workspace');assert resp.status==401
  results={'restart_readback':True,'late_preview_preserves_editor':True,'download_revision_2':True,'mobile_widths':[320,390,844],'anonymous_api':401,'download_sha256':hashlib.sha256(dest.read_bytes()).hexdigest()};(OUT/'restart-and-controls.json').write_text(json.dumps(results,indent=2));print(json.dumps(results));await b.close()
asyncio.run(main())
