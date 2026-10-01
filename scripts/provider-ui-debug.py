import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 i=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite']
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=await b.new_page(viewport={'width':390,'height':844});page.on('response',lambda r:print('R',r.status,r.url) if '/providers' in r.url else None);page.on('pageerror',lambda e:print('ERR',e));await page.goto(BASE+'/#invite='+i);await page.get_by_role('button',name='Entra nel tuo spazio').click();await page.locator('#nova-dashboard').wait_for(state='visible');print(await page.evaluate("({global:typeof openProviderSettings,click:typeof document.querySelector('.dash-settings').onclick,display:getComputedStyle(document.querySelector('.dash-settings')).display})"));await page.locator('.dash-settings').click();await page.wait_for_timeout(2000);print('open',await page.locator('#providerdialog').evaluate('e=>e.open'));await b.close()
asyncio.run(main())
