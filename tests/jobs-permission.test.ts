import test from 'node:test';import assert from 'node:assert/strict';
import {parseRobots,selectGroup,pathAllowed,robotsDecision,OriginPermissionGate,permanentlyDenied,MIN_CRAWL_DELAY_MS} from '../src/jobs-permission.ts';
const u=(p:string,o='https://board.example')=>new URL(o+p);
test('robots: NovaJobBot group preferred over *, rules merged across repeated groups',()=>{
 const text='User-agent: *\nDisallow: /\n\nUser-agent: NovaJobBot\nAllow: /jobs/\nCrawl-delay: 2\n\nUser-agent: novajobbot\nDisallow: /jobs/private/';
 const g=selectGroup(parseRobots(text))!;assert.ok(g.agents.includes('novajobbot'));assert.equal(g.rules.length,2);assert.equal(g.crawlDelayMs,2000);
 assert.equal(pathAllowed(g,'/jobs/1'),true);assert.equal(pathAllowed(g,'/jobs/private/1'),false);assert.equal(pathAllowed(g,'/other'),true);
 const star=robotsDecision('User-agent: *\nDisallow: /x\nUser-agent: Googlebot\nAllow: /',u('/x/1'));assert.equal(star.allowed,false);assert.equal(star.matchedGroup,'star');
 assert.equal(robotsDecision('User-agent: GPTBot\nDisallow: /',u('/x')).matchedGroup,'none');
});
test('robots: longest-match wins, Allow wins ties, wildcards and $ anchors, empty Disallow allows all',()=>{
 const g=selectGroup(parseRobots('User-agent: *\nDisallow: /offerte\nAllow: /offerte-lavoro/\nDisallow: /*.aspx*\nDisallow: /*?*\nAllow: /a$\nDisallow: /a'))!;
 assert.equal(pathAllowed(g,'/offerte-lavoro/x/1'),true);assert.equal(pathAllowed(g,'/offerte/x'),false);
 assert.equal(pathAllowed(g,'/detail/page.aspx?id=1'),false);assert.equal(pathAllowed(g,'/detail/1?x=1'),false);assert.equal(pathAllowed(g,'/detail/1'),true);
 assert.equal(pathAllowed(g,'/a'),true);assert.equal(pathAllowed(g,'/ab'),false);
 assert.equal(pathAllowed(selectGroup(parseRobots('User-agent: *\nDisallow:')),'/anything'),true);
 // helplavoro shape observed 2026-09-30
 const hl=robotsDecision('User-Agent: GPTBot\nDisallow: /\n\nUser-Agent: *\nAllow: /\nCrawl-Delay: 1',u('/offerta-di-lavoro-x/6903100.html'));assert.equal(hl.allowed,true);assert.equal(hl.crawlDelayMs,1000);
 // Crawl-delay below 1s is raised to the floor; absurd delays are capped
 assert.equal(robotsDecision('User-agent: *\nCrawl-delay: 0.2',u('/')).crawlDelayMs,MIN_CRAWL_DELAY_MS);assert.equal(robotsDecision('User-agent: *\nCrawl-delay: 9999',u('/')).crawlDelayMs,30000);
});
test('gate: 404 permitted, 5xx and network failure denied, per-origin cache with TTL, https only',async()=>{
 const hits:string[]=[];let status=200;let robots='User-agent: *\nDisallow: /private/\nCrawl-delay: 3';
 const fetcher=(async(input:any)=>{hits.push(String(input));if(status===0)throw Error('ECONNREFUSED');return new Response(status===404?'nf':robots,{status})}) as typeof fetch;
 let now=1_000_000;const gate=new OriginPermissionGate({fetcher,now:()=>now,ttlMs:1000});const s=new AbortController().signal;
 let d=await gate.check(u('/jobs/1'),s);assert.equal(d.permitted,true);assert.equal(d.crawlDelayMs,3000);assert.match(d.reason,/allows/);
 d=await gate.check(u('/private/1'),s);assert.equal(d.permitted,false);assert.equal(hits.length,1,'cached per origin');
 now+=2000;status=404;d=await gate.check(u('/private/1'),s);assert.equal(d.permitted,true);assert.equal(hits.length,2);assert.match(d.reason,/404/);
 status=503;d=await gate.check(u('/x','https://other.example'),s);assert.equal(d.permitted,false);assert.match(d.reason,/503/);
 status=0;d=await gate.check(u('/x','https://down.example'),s);assert.equal(d.permitted,false);assert.match(d.reason,/unreachable/);
 status=200;d=await gate.check(new URL('http://board.example/jobs/1'),s);assert.equal(d.permitted,false);assert.match(d.reason,/https/);
 assert.deepEqual(hits.map(h=>new URL(h).pathname),['/robots.txt','/robots.txt','/robots.txt','/robots.txt']);
});
test('gate: deny-list origins are refused before any robots fetch, regardless of Allow',async()=>{
 let calls=0;const gate=new OriginPermissionGate({fetcher:(async()=>{calls++;return new Response('User-agent: *\nAllow: /')}) as typeof fetch});
 for(const host of ['www.subito.it','subito.it','m.subito.it','SUBITO.IT.']){const d=await gate.check(new URL(`https://${host}/offerte-lavoro/cameriere-bologna-1.htm`),new AbortController().signal);assert.equal(d.permitted,false,host);assert.match(d.reason,/deny-list|permission/);}
 assert.equal(calls,0);assert.equal(permanentlyDenied('notsubito.it'),false);assert.equal(permanentlyDenied('subito.it.evil.example'),false);
});
