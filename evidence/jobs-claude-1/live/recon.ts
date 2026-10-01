// Bounded public recon: HTTPS GET, redirect manual (recorded, not followed), 1MB cap, 10s timeout.
// Usage: node --import tsx recon.ts <out.json> <url...>
import {writeFile} from 'node:fs/promises';
const [out,...urls]=process.argv.slice(2);
const clean=(s:string)=>s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const results:any[]=[];
for(const url of urls.slice(0,15)){
 const observedAt=new Date().toISOString();
 try{
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{accept:'text/html,text/plain','user-agent':'Mozilla/5.0 (X11; Linux x86_64) NovaJobsRecon/0.1 (bounded public read)'}});
  const body=(await r.text()).slice(0,1_000_000);
  const text=clean(body);
  const links=[...body.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(h=>/bologna|camerier|sala|offert|lavor|job|annunc|cerca/i.test(h));
  const uniq=[...new Set(links)].slice(0,80);
  const title=clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'');
  const hits=[...text.matchAll(/[^.]{0,120}(?:camerier|Bologna)[^.]{0,120}/gi)].map(m=>m[0].trim()).slice(0,25);
  results.push({url,observedAt,status:r.status,location:r.headers.get('location'),contentType:r.headers.get('content-type'),bytes:body.length,title,hits,links:uniq,robots:url.endsWith('robots.txt')?body.slice(0,3000):undefined});
  console.log(url,r.status,title.slice(0,80),'hits',hits.length,'links',uniq.length);
 }catch(e){results.push({url,observedAt,error:String(e)});console.log(url,'ERR',String(e));}
}
await writeFile(out,JSON.stringify(results,null,1));
