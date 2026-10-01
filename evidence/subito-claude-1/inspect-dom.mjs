// Passata di ispezione DOM (2 soli caricamenti: lista + dettaglio n.1 già letto) per documentare
// selettori riproducibili: data, località, etichetta inserzionista, nome azienda se pubblicato.
// Nessun click su contatti. Salva solo struttura e brevi prove testuali.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.dirname(new URL(import.meta.url).pathname);
const LIST_URL = 'https://www.subito.it/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/?q=cameriere';
const DETAIL_URL = 'https://www.subito.it/offerte-lavoro/cameriere-bologna-658333217.htm';
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ locale: 'it-IT', viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
page.setDefaultTimeout(20000);
const out = { observed_at: now(), list: null, detail: null };
try {
  const lr = await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
  out.list = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*=".htm"]')).find(x => /offerte-lavoro\/.+-\d+\.htm/.test(x.href));
    const chain = []; let el = a; for (let i = 0; i < 6 && el; i++) { chain.push(el.tagName + (el.className ? '.' + String(el.className).split(' ').slice(0, 3).join('.') : '') + (el.dataset?.testid ? `[data-testid=${el.dataset.testid}]` : '')); el = el.parentElement; }
    const card = a.closest('[class*="item-card"],[class*="ItemCard"],[class*="SmallCard"],article,li') || a.parentElement;
    const nodes = Array.from(card.querySelectorAll('*')).filter(n => n.children.length === 0 && n.textContent.trim()).slice(0, 15).map(n => ({ tag: n.tagName, cls: String(n.className).slice(0, 70), testid: n.dataset?.testid || null, text: n.textContent.trim().slice(0, 60) }));
    const testids = Array.from(new Set(Array.from(document.querySelectorAll('[data-testid]')).map(n => n.dataset.testid))).slice(0, 40);
    const nextData = document.getElementById('__NEXT_DATA__') ? 'present' : 'absent';
    return { status_note: 'lista', anchor_parent_chain: chain, first_card_leaf_nodes: nodes, data_testids_on_page: testids, next_data: nextData, ad_anchor_count: document.querySelectorAll('a[href*="/offerte-lavoro/"][href$=".htm"]').length };
  });
  out.list.status = lr?.status();
  await sleep(3000);
  const dr = await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
  out.detail = await page.evaluate(() => {
    const t = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const h1 = document.querySelector('h1');
    const testids = Array.from(new Set(Array.from(document.querySelectorAll('[data-testid]')).map(n => n.dataset.testid))).slice(0, 60);
    const main = document.querySelector('main') || document.body;
    // leaf nodes near the h1 (header dell'annuncio) senza descrizione integrale
    const section = h1?.closest('section,div[class*="AdInfo"],div[class*="ad-info"],div[class*="Header"]') || h1?.parentElement?.parentElement;
    const leaves = section ? Array.from(section.querySelectorAll('*')).filter(n => n.children.length === 0 && n.textContent.trim()).slice(0, 20).map(n => ({ tag: n.tagName, cls: String(n.className).slice(0, 70), testid: n.dataset?.testid || null, text: n.textContent.trim().slice(0, 60) })) : [];
    const labels = Array.from(main.querySelectorAll('*')).filter(n => n.children.length === 0 && /^(Privato|Azienda|Azienda verificata|Agenzia|Utente privato)$/i.test(n.textContent.trim())).map(n => ({ tag: n.tagName, cls: String(n.className).slice(0, 70), testid: n.dataset?.testid || null, text: n.textContent.trim() })).slice(0, 5);
    const advertiserBlock = Array.from(main.querySelectorAll('[class*="Advertiser"],[class*="advertiser"],[class*="Seller"],[class*="seller"],[class*="Shop"],[class*="user-info"],[class*="UserInfo"]')).slice(0, 4).map(n => ({ cls: String(n.className).slice(0, 80), text: t(n).slice(0, 120) }));
    const features = Array.from(main.querySelectorAll('[class*="feature"],[class*="Feature"],[class*="Detail"] li, dl')).slice(0, 12).map(n => ({ cls: String(n.className).slice(0, 60), text: t(n).slice(0, 80) }));
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => { try { const j = JSON.parse(s.textContent); return Array.isArray(j) ? j.map(x => x['@type']) : (j['@graph'] ? j['@graph'].map(x => x['@type']) : j['@type']); } catch { return 'parse-error'; } });
    const meta = { title: document.title, ogTitle: document.querySelector('meta[property="og:title"]')?.content || null, description_len: (document.querySelector('meta[name="description"]')?.content || '').length };
    const body = document.body.innerText;
    const dateLine = (body.match(/^.*(Oggi|Ieri|\d{1,2} \w{3}) alle \d{1,2}:\d{2}.*$/m) || [''])[0].slice(0, 100);
    return { h1: t(h1), h1_path: h1 ? (h1.parentElement?.className || '').slice(0, 80) : null, header_leaf_nodes: leaves, publisher_label_nodes: labels, advertiser_blocks: advertiserBlock, feature_nodes: features, ldjson_types: ld, meta, date_line: dateLine, data_testids: testids, has_next_data: !!document.getElementById('__NEXT_DATA__'), cta_texts: Array.from(main.querySelectorAll('button,a')).map(b => t(b)).filter(x => /Contatta|Mostra numero|Invia|Candidat/i.test(x)).slice(0, 5) };
  });
  out.detail.status = dr?.status();
  fs.writeFileSync(path.join(OUT, 'dom-inspection.json'), JSON.stringify(out, null, 2));
} catch (e) { out.error = String(e); fs.writeFileSync(path.join(OUT, 'dom-inspection.json'), JSON.stringify(out, null, 2)); console.error(e); }
finally { await browser.close(); }
