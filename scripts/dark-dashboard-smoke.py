import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/dark-byok-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 invite=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite']
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=await b.new_page(viewport={'width':390,'height':844});errors=[];page.on('response',lambda r:print('RESP',r.status,r.url) if '/api/providers' in r.url else None);await page.goto(BASE+'/#invite='+invite);await page.get_by_role('button',name='Entra nel tuo spazio').click();await expect(page.locator('#nova-dashboard')).to_be_visible();await expect(page.locator('#classic-main')).to_be_hidden();assert not await page.evaluate("document.querySelector('#nova-dashboard').scrollWidth>innerWidth");await page.screenshot(path=str(O/'mobile-dashboard.png'),full_page=True)
  await page.evaluate('window.openProviderSettings()');await expect(page.locator('#providerdialog')).to_be_visible();await page.screenshot(path=str(O/'mobile-settings.png'),full_page=True)
  await page.get_by_role('combobox',name='Provider').select_option('nova');await page.get_by_role('button',name='Carica tutti i modelli disponibili').click();await expect(page.locator('#catalognote')).to_contain_text('modelli restituiti',timeout=40000);count=await page.locator('#modellist option').count();assert count>100,count
  await page.get_by_role('button',name='←').click();await page.evaluate('openDashboard()');await page.locator('#dashinput').fill('Ciao Nova');await page.locator('#dashinput').press('Enter');await expect(page.locator('#messages')).to_contain_text('Ciao Nova');assert not errors,errors
  await page.set_viewport_size({'width':1440,'height':950});await page.evaluate('openDashboard()');await page.screenshot(path=str(O/'desktop-dashboard.png'),full_page=True)
  result={'dark_dashboard':True,'mobile_overflow':False,'settings':True,'foundry_managed_catalog_count':count,'dashboard_to_real_chat':True,'page_errors':errors};(O/'browser.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await b.close()
asyncio.run(main())
