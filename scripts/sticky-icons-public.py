import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
B='https://loving-say-than-seemed.trycloudflare.com';O=Path('/home/azureuser/nova-community-agent/evidence/sticky-icons-1')
async def main():
 invite=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite']
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=await b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.goto(B+'/#invite='+invite);await page.get_by_role('button',name='Entra nel tuo spazio').click();await expect(page.locator('#nova-dashboard')).to_be_visible();assert await page.locator('.dash-card-icon svg').count()>=7
  before=await page.locator('.dash-composer').bounding_box();await page.evaluate("document.querySelector('#nova-dashboard').scrollTop=260");await page.wait_for_timeout(150);after=await page.locator('.dash-composer').bounding_box();assert abs(before['y']-after['y'])<2,(before,after);last=await page.locator('.dash-card').last.bounding_box();assert last['y']+last['height']<after['y'];assert after['y']+after['height']<=844;await page.screenshot(path=str(O/'public-mobile-sticky.png'))
  await page.get_by_role('button',name='Impostazioni e provider').click();await expect(page.locator('#providerdialog')).to_be_visible();await page.get_by_role('combobox',name='Provider').select_option('nova');await page.get_by_role('button',name='Carica tutti i modelli disponibili').click();await expect(page.locator('#catalognote')).to_contain_text('modelli restituiti',timeout=40000);models=await page.locator('#modellist option').count();assert models>100
  result={'sticky':True,'last_card_clear':True,'custom_svg_icons':await page.locator('.nova-icon svg').count(),'managed_foundry_models':models,'errors':errors};assert not errors;(O/'public-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await b.close()
asyncio.run(main())
