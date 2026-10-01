// Inspect a saved HTML page: text excerpt, JSON-LD blocks, script stats. Usage: node inspect.js file.html [maxText]
const fs=require('fs');const [file,max='3500']=process.argv.slice(2);const b=fs.readFileSync(file,'utf8');
const clean=s=>s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#x27;|&#039;/g,"'").replace(/\s+/g,' ').trim();
const t=clean(b);console.log('bytes',b.length,'textlen',t.length);console.log(t.slice(0,Number(max)));
console.log('---JSONLD---');for(const m of b.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g))console.log(m[1].slice(0,3000));
console.log('---scripts',(b.match(/<script/g)||[]).length,'meta:',[...b.matchAll(/<meta[^>]+(?:og:title|og:description|description|og:url)[^>]*>/g)].map(m=>m[0]).join('\n'));
