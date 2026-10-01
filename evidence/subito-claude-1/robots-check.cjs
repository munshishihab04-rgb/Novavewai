// Corregge la valutazione robots euristica (falso positivo: prefisso vuoto dopo rimozione wildcard) e annota il commento di policy.
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("results.json"));
const robots = fs.readFileSync("robots.txt", "utf8");
const disallows = robots.split("\n").filter(l => /^disallow\s*:/i.test(l)).map(l => l.split(":").slice(1).join(":").trim()).filter(Boolean);
const urls = [r.list_url, ...r.details.map(d => d.url)].map(u => new URL(u));
const toRe = (d) => new RegExp("^" + d.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (d.endsWith("*") ? "" : ""));
const matches = urls.map(u => ({ url: u.href, path_query: u.pathname + u.search, matched_disallow: disallows.filter(d => toRe(d).test(u.pathname + u.search) || (d.startsWith("*") && toRe(d).test(u.pathname + u.search))) }));
r.robots = {
  ...r.robots,
  matching_disallows: undefined,
  correction: "il campo matching_disallows in robots-eval.json era un falso positivo dell'euristica (prefisso vuoto dopo rimozione wildcard). Verifica per-URL sotto.",
  per_url_directive_check: matches,
  pagination_disallowed: true,
  policy_comment_verbatim: robots.split("\n").slice(0, 2).join(" ").replace(/^#\s*/, "").replace(/\s#\s*/, " "),
  policy_note: "Le direttive User-agent:* consentono i percorsi usati (Allow: /, nessun Disallow corrispondente), ma il commento di testa vieta espressamente accessi automatici senza permesso di Subito.it. Questo è un vincolo di policy/termini da valutare prima di qualsiasi adapter automatico; non è stato aggirato nulla, la lettura è stata un browser ordinario a bassa frequenza.",
};
fs.writeFileSync("results.json", JSON.stringify(r, null, 2));
console.log(JSON.stringify(matches.map(m => [m.path_query, m.matched_disallow]), null, 0));
console.log(r.robots.policy_comment_verbatim);
