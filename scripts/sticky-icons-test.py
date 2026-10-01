import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright,expect
R=Path('/home/azureuser/nova-community-agent');O=R/'evidence/sticky-icons-1';BASE='https://loving-say-than-seemed.trycloudflare.com'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/home/azureuser/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=await browser.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR',e)))
  await page.route('**/api/workspace',lambda r:r.fulfill(json={'conversations':[],'artifacts':[],'runs':[]}));await page.route('**/api/providers',lambda r:r.fulfill(json={'connections':[],'selection':{'provider':'nova','model':'gpt-5.4-mini'}}))
  await page.route('**/icons.js',lambda r:r.fulfill(path=str(R/'public/icons.js')))
  for name in ['dashboard.js','dark.css']:
   src=O/(('candidate-' if os.environ.get('CANDIDATE') else 'before-')+name)
   def handler(src):
    async def f(route):await route.fulfill(path=str(src))
    return f
   await page.route('**/'+name,handler(src))
  checks=[]
  for width,height in [(390,844),(320,600)]:
   await page.set_viewport_size({'width':width,'height':height});await page.goto(BASE);await expect(page.locator('#nova-dashboard')).to_be_visible();viewport_box=await page.locator('.dash-composer').bounding_box();assert viewport_box['y']+viewport_box['height']<=height+1,(width,viewport_box)
   before_y=viewport_box['y'];await page.evaluate("document.querySelector('#nova-dashboard').scrollTo(0,Math.min(300,document.querySelector('#nova-dashboard').scrollHeight-innerHeight))");await page.wait_for_timeout(100);box=await page.locator('.dash-composer').bounding_box();assert abs(box['y']-before_y)<2,(width,before_y,box)
   assert box['y']+box['height']>=height-60,(width,box)
   assert await page.locator('.dash-card-icon svg').count()>=7
   await page.locator('#dashinput').fill('Bozza da non perdere');await page.get_by_role('button',name='Impostazioni e provider').click();await page.locator('#settingsback').click();assert await page.locator('#dashinput').input_value()=='Bozza da non perdere'
   await page.evaluate("document.querySelector('#nova-dashboard').scrollTop=100000")
   last=await page.locator('.dash-card').last.bounding_box();assert last['y']+last['height']<box['y'],(width,last,box)
   assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
   await page.screenshot(path=str(O/f'view-{width}.png'));checks.append({'width':width,'height':height,'composer_visible':True,'last_card_clear':True})
  await page.set_viewport_size({'width':390,'height':844});await page.reload();await expect(page.locator('#nova-dashboard')).to_be_visible();await page.screenshot(path=str(O/'mobile-top.png'))
  assert not errors,errors;(O/'ui-verification.json').write_text(json.dumps({'checks':checks,'errors':errors,'provider':'mocked authenticated UI'},indent=2));print(json.dumps(checks));await browser.close()
asyncio.run(main())
