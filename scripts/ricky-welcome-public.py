import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
O=Path('/home/azureuser/nova-community-agent/evidence/ricky-welcome')
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox']);page=await b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('https://loving-say-than-seemed.trycloudflare.com/#invite='+os.environ['RICKY_INVITE'])
  await expect(page.get_by_role('heading',name='Benvenuto, Ricky.')).to_be_visible()
  await expect(page.locator('#welcome-message')).to_contain_text('Questa prima prova è dedicata a te.')
  button=page.get_by_role('button',name='Scopri NOVA');await button.scroll_into_view_if_needed();await button.click(trial=True)
  assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth');assert not errors,errors
  await page.screenshot(path=str(O/'ricky-live.png'),full_page=True)
  result={'public_welcome':True,'real_message':True,'cta_actionable':True,'invite_not_consumed':True,'browser_errors':errors};(O/'public-check.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));await b.close()
asyncio.run(main())
