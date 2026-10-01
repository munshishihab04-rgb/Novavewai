import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 root=Path(__file__).parent
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  page=await browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  checks=[]
  for name,width,height,query in [('desktop',1440,1000,'view=work'),('mobile-chat',390,960,'view=work'),('mobile-result',390,960,'view=work&studio=open'),('mobile-home',390,960,'view=home')]:
   await page.set_viewport_size({'width':width,'height':height});await page.goto(root.joinpath('index.html').as_uri()+'?'+query);await page.screenshot(path=str(root/(name+'.png')),full_page=True)
   overflow=await page.evaluate('document.documentElement.scrollWidth > innerWidth')
   assert not overflow,name
   checks.append({'screen':name,'horizontal_overflow':overflow})
  await page.get_by_role('button',name='Prepariamo il mio CV').click();assert await page.locator('.chat').is_visible()
  await page.get_by_role('button',name='Apri risultato').click();assert await page.locator('.studio').is_visible();assert not await page.locator('.chat').is_visible()
  await page.get_by_role('button',name='Torna alla conversazione').click();assert await page.locator('.chat').is_visible()
  await page.get_by_role('button',name='Rispondi a voce').click();assert 'microfono non attivato' in await page.locator('.toast').inner_text()
  assert not errors,errors
  (root/'verification.json').write_text(json.dumps({'screens':checks,'console_errors':errors,'mobile_flow':'home → chat → result → chat verified','microphone':'not requested; explicit prototype notice','backend':'not connected'},indent=2))
  print((root/'verification.json').read_text());await browser.close()
asyncio.run(main())
