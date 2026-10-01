import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
B='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 i=json.loads(Path('/home/azureuser/.local/share/nova-community-trial/smoke.json').read_text())['invite']
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);q=await b.new_page(viewport={'width':390,'height':844});q.on('console',lambda m:print('CONSOLE',m.type,m.text));q.on('pageerror',lambda e:print('ERR',e));q.on('response',lambda r:print('RESP',r.status,r.url) if '/providers' in r.url else None);await q.goto(B+'/#invite='+i);await q.get_by_role('button',name='Entra nel tuo spazio').click();await q.locator('#nova-dashboard').wait_for(state='visible');print(await q.evaluate("({fn:String(window.openProviderSettings).slice(0,120), cookie:document.cookie, state:document.body.className})"));print('call',await q.evaluate("window.openProviderSettings().then(()=>({open:document.querySelector('#providerdialog').open,text:document.querySelector('.toast').textContent}))"));await b.close()
asyncio.run(main())
