// progress.json finale con timestamp reale; controllo coerenza numeri tra list.json / results.json / REPORT.md
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("results.json"));
const l = JSON.parse(fs.readFileSync("list.json"));
const d = JSON.parse(fs.readFileSync("details.json"));
const rep = fs.readFileSync("REPORT.md", "utf8");
const checks = {
  list_unique: l.unique_ad_urls === 30 && r.counts.unique_ad_urls === 30 && rep.includes("30 URL unici"),
  pertinent: r.counts.pertinenti_camerier_titolo === 25 && rep.includes("25 con «camerier*»"),
  citta_prov: r.counts.bologna_citta === 17 && r.counts.provincia === 8 && rep.includes("17 Bologna città, 8 provincia"),
  details: d.length === 5 && r.details_read === 5 && d.every(x => x.status === 200 && !x.unavailable_notice),
  urls_in_report: d.every(x => rep.includes(x.final_url)),
};
const ok = Object.values(checks).every(Boolean);
fs.writeFileSync("progress.json", JSON.stringify({ phase: ok ? "done" : "inconsistent", detail: `Subito accessibile: lista 200 (30 URL unici, 25 camerier*, 17 città/8 provincia), 5 dettagli 200 letti, publisher UNKNOWN, vincolo policy robots (commento) da valutare; REPORT.md/results.json pronti per verifica parent`, updated_at: new Date().toISOString(), done: ok, blocker: ok ? null : "incoerenza conteggi: " + JSON.stringify(checks) }, null, 2));
console.log(JSON.stringify(checks), fs.readFileSync("progress.json", "utf8"));
