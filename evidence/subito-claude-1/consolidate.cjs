// Consolidamento: deduplica/conteggio con codice, redazione dati non necessari, results.json.
const fs = require("fs");
const dom = JSON.parse(fs.readFileSync("dom-inspection.json"));
// redazione: nome utente inserzionista/recensioni non conservati (non è un nome azienda pubblicato)
dom.detail.advertiser_blocks = dom.detail.advertiser_blocks.map(b => ({ cls: b.cls, text: "[redatto: nome utente/recensioni non conservati]" }));
fs.writeFileSync("dom-inspection.json", JSON.stringify(dom, null, 2));

const list = JSON.parse(fs.readFileSync("list.json"));
const det = JSON.parse(fs.readFileSync("details.json"));
const locRe = /([A-Z][\wà-ü' ]*?)\s*\((BO)\)\s*$/;
const items = list.items.map(i => {
  const m = (i.location_hint || "").match(locRe);
  let comune = m ? m[1].trim() : null;
  // location_hint a volte contiene il titolo concatenato (es. "CameriereBologna") -> prendi l'ultima parola maiuscola sequenza nota
  if (comune && i.title && comune.startsWith(i.title.replace(/\s+/g, ""))) comune = comune.slice(i.title.replace(/\s+/g, "").length).trim();
  if (comune && comune.replace(/\s/g, "").startsWith(i.title.replace(/\s/g, ""))) comune = comune.replace(i.title, "").trim();
  // la card concatena a volte titolo/quartiere + comune (es. "San Mamolo AltaBologna"): il comune è la coda
  if (comune && /Bologna$/i.test(comune)) comune = "Bologna";
  const area = !comune ? "n/d" : comune.toLowerCase() === "bologna" ? "Bologna città (dichiarato)" : "provincia BO";
  return { url: i.url, title: i.title, comune_dichiarato: comune, area, pertinente_camerier: /camerier/i.test(i.title) };
});
const strict = items.filter(i => i.pertinente_camerier);
const counts = {
  unique_ad_urls: items.length,
  pertinenti_camerier_titolo: strict.length,
  bologna_citta: strict.filter(i => i.area.startsWith("Bologna")).length,
  provincia: strict.filter(i => i.area === "provincia BO").length,
  nd: strict.filter(i => i.area === "n/d").length,
};
const dedup_ok = new Set(items.map(i => i.url)).size === items.length;
const details = det.map(d => ({
  n: d.n, url: d.final_url, http_status: d.status, observed_at: d.observed_at, title: d.h1,
  insertion_date_text: d.date_text,
  location_text: (d.location_text || "").match(/[A-Z][\wà-ü' ]*\s\(BO\)$/)?.[0] || d.location_text,
  area: "Bologna città (dichiarato dall'annuncio)",
  publisher_label: d.n === 1 ? "blocco inserzionista con classe private-user-info (account privato); nessuna etichetta testuale" : "non rilevato (regex etichetta senza match; serve selettore dedicato)",
  company_name_published: null, publisher_type: "UNKNOWN",
  unavailable_notice: d.unavailable_notice, cta_present_not_clicked: d.cta_present,
  role_hit: d.role_hit, bologna_hit: d.bologna_hit, jobposting_ldjson: d.jobposting_ld,
  verification_status: "PARTIALLY_VERIFIED: pagina pubblica 200, titolo camerier*, località Bologna (BO), data inserimento presente, nessun avviso non disponibile; datore/azienda non verificati",
}));
const res = {
  task: "cameriere Bologna su Subito.it", list_url: list.list_url, list_http_status: list.status, list_page_title: list.page_title,
  robots: JSON.parse(fs.readFileSync("robots-eval.json")), observed_at: new Date().toISOString(), counts, dedup_ok,
  list_items: items, details_read: details.length, details,
  limits: [
    "1 pagina lista, 5 dettagli, nessuna paginazione (pattern ?o= è Disallow in robots)",
    "publisher/azienda non verificati; Privato/Azienda verificata non implica datore diretto",
    "località = comune dichiarato nell'annuncio, non verificato",
    "nessun JSON-LD JobPosting: campi da DOM con classi CSS-module (fragili)",
    "descrizioni, foto, contatti non conservati",
  ],
};
fs.writeFileSync("results.json", JSON.stringify(res, null, 2));
console.log(JSON.stringify(counts), "dedup_ok", dedup_ok);
console.log(items.map(i => `${i.pertinente_camerier ? "C" : "-"} ${i.area.padEnd(26)} ${i.title}`).join("\n"));
console.log(details.map(d => `${d.n} ${d.insertion_date_text} | ${d.location_text} | ${d.url}`).join("\n"));
