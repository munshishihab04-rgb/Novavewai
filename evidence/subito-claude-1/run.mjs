// Ricerca reale bounded su Subito.it: 1 pagina lista + max 5 dettagli pertinenti.
// Navigazione pubblica ordinaria (Chromium headless, JS abilitato, nessun account, nessun proxy/stealth).
// Nessun click su "mostra numero"/"contatta", nessuna candidatura. Salva solo metadati minimi.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.dirname(new URL(import.meta.url).pathname);
const ORIGIN = 'https://www.subito.it';
const LIST_URL = ORIGIN + '/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/?q=cameriere';
const MAX_DETAILS = 5;
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const save = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const progress = (phase, detail, done = false, blocker = null) => save('progress.json', { phase, detail, updated_at: now(), done, blocker });

const PERTINENT = /camerier|sala|waiter|banconist|barist/i; // camerier* primario; gli altri solo come segnale secondario

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'it-IT', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const log = [];
page.on('response', r => { if (r.request().resourceType() === 'document') log.push({ t: now(), url: r.url(), status: r.status() }); });

async function dismissCookies() {
  // Solo cookie essenziali: cerca un pulsante di rifiuto/continua senza accettare. Nessun "Accetta".
  const candidates = ['button:has-text("Continua senza accettare")', 'button:has-text("Rifiuta")', 'button:has-text("Solo necessari")', '[data-testid*="reject"]', '#didomi-notice-disagree-button', 'button[aria-label*="Rifiuta"]'];
  for (const sel of candidates) {
    const b = page.locator(sel).first();
    if (await b.count() && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(800); return sel; }
  }
  return null;
}

try {
  // 1) robots.txt tramite navigazione ordinaria del browser
  progress('robots', 'lettura robots.txt via browser');
  const rr = await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'domcontentloaded' });
  const robotsStatus = rr?.status();
  const robotsText = robotsStatus === 200 ? await page.locator('body').innerText() : '';
  save('robots.txt', robotsText || `(status ${robotsStatus})`);
  const disallows = robotsText.split('\n').filter(l => /^disallow\s*:/i.test(l)).map(l => l.split(':').slice(1).join(':').trim());
  const pathsToCheck = ['/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/', '/offerte-lavoro/'];
  const robotsEval = { status: robotsStatus, observed_at: now(), disallow_count: disallows.length, matching_disallows: disallows.filter(d => d && pathsToCheck.some(p => p.startsWith(d.replace(/\*.*$/, '')) || (d.includes('?q=') || d.includes('*?')))), note: 'valutazione euristica su User-agent: * ; vedi robots.txt salvato' };
  save('robots-eval.json', robotsEval);
  await sleep(2000);

  // 2) pagina lista (1 sola)
  progress('list', 'navigazione lista ' + LIST_URL);
  const lr = await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const cookieSel = await dismissCookies();
  const listStatus = lr?.status();
  const listTitle = await page.title();
  await page.screenshot({ path: path.join(OUT, 'list.png'), fullPage: false });
  // Estrazione card: anchor verso pagine annuncio (pattern /.../<slug>-<id>.htm)
  const cards = await page.evaluate(() => {
    const out = [];
    const anchors = Array.from(document.querySelectorAll('a[href*=".htm"]'));
    for (const a of anchors) {
      const href = a.href;
      if (!/subito\.it\/.+-\d+\.htm/.test(href)) continue;
      const card = a.closest('article, li, div[class*="item"], div[class*="Item"], div[class*="card"], div[class*="Card"]') || a;
      const h = card.querySelector('h2, h3') || a.querySelector('h2, h3');
      const title = (h?.textContent || a.getAttribute('title') || a.textContent || '').trim().slice(0, 140);
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
      const timeEl = card.querySelector('time');
      const dateGuess = timeEl?.getAttribute('datetime') || timeEl?.textContent || (text.match(/(Oggi|Ieri|\d{1,2}\s\w{3}|\d{1,2}\s\w+)\s*(alle\s*)?\d{1,2}:\d{2}/) || [])[0] || null;
      const locGuess = (text.match(/([A-ZÀ-Ü][\wà-ü' ]{2,40})\s*\((BO|[A-Z]{2})\)/) || [])[0] || null;
      out.push({ url: href.split('?')[0], title, date_hint: dateGuess, location_hint: locGuess, card_tag: card.tagName + (card.className ? '.' + String(card.className).slice(0, 60) : ''), text_len: text.length });
    }
    return out;
  });
  // Deduplica per URL (con codice)
  const seen = new Set(); const listItems = [];
  for (const c of cards) { if (!seen.has(c.url)) { seen.add(c.url); listItems.push(c); } }
  const listBatch = { list_url: LIST_URL, status: listStatus, page_title: listTitle, observed_at: now(), cookie_action: cookieSel, raw_anchor_count: cards.length, unique_ad_urls: listItems.length, items: listItems };
  save('list.json', listBatch);
  if (listStatus !== 200 || listItems.length === 0) {
    const bodySnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
    save('list-body-snippet.txt', bodySnippet);
  }

  // 3) dettagli pertinenti (max 5, sequenziali)
  const pertinent = listItems.filter(i => PERTINENT.test(i.title));
  const targets = pertinent.slice(0, MAX_DETAILS);
  const details = [];
  let n = 0;
  for (const t of targets) {
    n++;
    progress('details', `dettaglio ${n}/${targets.length}: ${t.url}`);
    await sleep(3000);
    const dr = await page.goto(t.url, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const status = dr?.status();
    const finalUrl = page.url();
    const d = await page.evaluate(() => {
      const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const h1 = txt(document.querySelector('h1'));
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean);
      const jobPosting = ld.flatMap(x => Array.isArray(x) ? x : [x]).flatMap(x => x['@graph'] ? x['@graph'] : [x]).find(x => x && x['@type'] === 'JobPosting');
      const dateMatch = body.match(/(Oggi|Ieri|\d{1,2}\s(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*)\s*(?:alle\s*)?\d{1,2}:\d{2}/i);
      const loc = body.match(/([A-ZÀ-Ü][\wà-ü' ]{2,40})\s*\((BO)\)/);
      const publisher = /Azienda verificata/i.test(body) ? 'Azienda verificata' : /\bAzienda\b/.test(body) ? 'Azienda' : /\bPrivato\b/.test(body) ? 'Privato' : 'non rilevato';
      const unavailable = /annuncio non (è )?più disponibile|non è più disponibile|annuncio rimosso|scaduto|non disponibile/i.test(body);
      const ctaPresent = /Contatta|Mostra numero|Invia messaggio/i.test(body);
      const roleHit = /camerier/i.test(h1 + ' ' + body.slice(0, 3000));
      const bolognaHit = /Bologna/i.test(body);
      const evidenceSnippet = (body.match(/.{0,80}camerier.{0,80}/i) || [''])[0];
      return { h1, date_text: dateMatch?.[0] || null, location_text: loc?.[0] || null, publisher_label: publisher, unavailable_notice: unavailable, cta_present: ctaPresent, role_hit: roleHit, bologna_hit: bolognaHit, jobposting_ld: jobPosting ? { title: jobPosting.title, datePosted: jobPosting.datePosted, validThrough: jobPosting.validThrough, hiringOrganization: jobPosting.hiringOrganization?.name, addressLocality: jobPosting.jobLocation?.address?.addressLocality || jobPosting.jobLocation?.[0]?.address?.addressLocality } : null, evidence_snippet: evidenceSnippet.slice(0, 200), body_len: body.length };
    });
    await page.screenshot({ path: path.join(OUT, `detail-${n}.png`), fullPage: false });
    details.push({ n, requested_url: t.url, final_url: finalUrl, status, observed_at: now(), list_title: t.title, ...d });
    save('details.json', details);
  }

  save('document-log.json', log);
  const results = {
    query: 'cameriere', city_filter: 'Bologna (comune/provincia da distinguere per annuncio)', list_url: LIST_URL, observed_at: now(),
    robots: robotsEval, list: { status: listStatus, unique_ad_urls: listItems.length, pertinent_by_title: pertinent.length },
    details_read: details.length,
    details: details.map(d => ({ url: d.final_url, status: d.status, title: d.h1 || d.list_title, date_text: d.date_text, location_text: d.location_text, publisher_label: d.publisher_label, unavailable_notice: d.unavailable_notice, role_hit: d.role_hit, bologna_hit: d.bologna_hit, jobposting_ld: d.jobposting_ld, observed_at: d.observed_at })),
  };
  save('results.json', results);
  progress('done', `lista ${listStatus}, ${listItems.length} URL unici, ${pertinent.length} pertinenti per titolo, ${details.length} dettagli letti`, true, null);
} catch (e) {
  save('document-log.json', log);
  progress('error', String(e?.message || e), false, String(e?.message || e));
  console.error(e);
} finally {
  await browser.close();
}
