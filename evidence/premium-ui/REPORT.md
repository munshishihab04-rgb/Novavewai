# Premium shell: Inter · one SVG icon family · drawer riorganizzato · 2026-10-01

Richiesta: «Icone da sostituire tutte assolutamente con icone premium svg, font da cambiare (Inter o simile), organizzare mobile side menu».

## Fatto
- **Font**: Inter (variabile 100–900, latin + latin-ext, OFL) **self-hosted** in `public/fonts/` e servito da `/fonts/*.woff2` — la CSP è `font-src 'self'`, quindi niente Google Fonts. `Segoe UI`/Arial rimossi da `dark.css` e `style.css`; Noto Sans Bengali resta per `bn`. Preload del woff2 in `<head>`.
- **Icone**: nuovo set unico in `public/icons.js` (griglia 24×24, stroke 1.75 via CSS, geometria Lucide-like, 38 glifi) e sprite `<symbol id="i-…">` in `index.html` generato dalla stessa geometria (test: sprite == icons.js, nessun drift). Tutti i glifi di testo usati come icone (`✕ ← ⚙ → ↗`) sostituiti da SVG: close del drawer, back dei pannelli, ⚙ desktop, rimozione allegato, «Torna alla chat» del voice panel, link risultati. Composer: paperclip (allega), mic + etichetta (parla), paper-plane (invia). **Bug trovato dal test**: gli id dello sprite collidevano con gli id DOM (`#download` symbol vs `#download` button → l'app scriveva il testo dentro il symbol): ora namespace `i-`.
- **Drawer mobile riorganizzato**: header (brand + close ghost) → CTA «Nuova conversazione» (pieno, centrato, 48 px) → nav primaria (Conversazioni · Chat temporanea · I miei risultati) → «Le tue conversazioni» (lista con scroll interno, drawer intero mai scrolla) → Impostazioni (Lingua e voce con valore a destra · Provider e modelli · Guida iniziale) → blocco account **ancorato in basso** (Esporta · Esci · avatar/nome/tipo account). Righe 48 px, icone 20 px su una sola colonna, etichette sezione 11/600. «Chat vocale» e «Ricerca sul web» **tolti dal drawer**: sono funzioni del composer (chip, pulsante, header desktop), non impostazioni.
- **Home**: `Scroll →` → «Vedi tutto / Sob dekhun / সব দেখুন / See all» con chevron CSS, **nascosto** sulle rail con una sola card (`:has`); card modello singola a tutta larghezza; prima card della rail allineata al titolo (`scroll-padding-inline`); l'ultima sezione non finisce più sotto il composer sticky; controlli header/composer con un'unica forma (raggio 12).
- Stringhe nuove in 4 lingue (`personal_account`, `invite_access`); `talk` accorciato in bn/bn-Latn per stare in un telefono da 360 px senza ellissi.

## Prove
- `tests/premium-ui.test.ts` (2 test): font servito e dichiarato dalla propria origine, zero `Segoe UI`/Google Fonts, zero glifi testuali, ogni riga del drawer con icona, niente voice/research nel drawer, sprite == icons.js, nessun id duplicato; su Chromium 390×844: Inter effettivamente caricato (`document.fonts.check`), «vedi tutto» segue il numero di card, ultima rail libera dal composer, raggio unico nei controlli header, icone del drawer su una sola x e una sola misura, tutte le righe esattamente 48 px, drawer non scrolla con 12 conversazioni, account in basso e visibile, nessun errore JS.
- Mutante (righe impostazioni a 52 px) → test fallisce; ripristino → passa.
- Screenshot: `home-banglish-phone.png`, `drawer-banglish-phone.png`, `chat-banglish-phone.png`, `home-bn-phone.png`, `drawer-bn-phone.png`, `home-it-desktop.png`, `drawer-it-desktop.png`, `drawer-en-tablet.png` — verificati con vision (Bengali: congiunti corretti, nessun tofu).
- Suite completa: vedi `test-full.log` / `typecheck.log`.

## Non fatto / limiti
- Il drawer a desktop resta un overlay (pattern mobile); la sidebar desktop fissa ha ricevuto le icone ma non è stata ridisegnata.
- Le bolle messaggio (reply senza sfondo) non erano in scope.
- Nessuna validazione madrelingua delle stringhe bn/bn-Latn nuove.
