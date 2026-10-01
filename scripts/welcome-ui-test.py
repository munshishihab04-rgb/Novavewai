import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/ricky-welcome';O.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox']);page=await b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def route(r):
   path=r.request.url.split('https://trial.example')[-1].split('?')[0]
   if path=='/auth/preview':await r.fulfill(json={'welcome':{'title':'Benvenuto, Ricky.','message':'Sei il primo a provare NOVA.\n\nIl mio carissimo socio e il mio mentore.'}})
   elif path.startswith('/api/'):await r.fulfill(status=401,json={'error':'unauthorized'})
   else:
    f=R/'public'/('index.html' if path=='/' else path.lstrip('/'))
    await r.fulfill(path=str(f)) if f.is_file() else await r.fulfill(status=404)
  await page.route('**/*',route)
  for w,h in [(320,600),(390,844),(1440,950)]:
   await page.set_viewport_size({'width':w,'height':h});await page.goto('https://trial.example/#invite='+'a'*43)
   await expect(page.get_by_role('heading',name='Benvenuto, Ricky.')).to_be_visible()
   await expect(page.locator('#welcome-message')).to_contain_text('carissimo socio')
   await expect(page.get_by_role('button',name='Scopri NOVA')).to_be_visible()
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(O/f'welcome-{w}.png'),full_page=True)
  assert not errors,errors
  print(json.dumps({'viewports':[320,390,1440],'errors':errors,'personal_welcome':True}))
  await b.close()
asyncio.run(main())
