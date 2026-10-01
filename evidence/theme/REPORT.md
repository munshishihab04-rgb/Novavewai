# Aspetto: chiaro / scuro / come il telefono · 2026-10-01

Richiesta: «rendi sia modalità notte che modalità non notte: segue le impostazioni del telefono e l'utente può selezionare da impostazioni».

## Fatto
- **Default «Come il telefono»**: `public/theme.js` (sincrono in `<head>`, prima del paint) legge la scelta in cache e `prefers-color-scheme`, imposta `html[data-theme=light|dark]`, `color-scheme` e il `<meta theme-color>` (barra di stato Android). Reagisce al cambio di tema del sistema in tempo reale finché la scelta è «sistema».
- **Scelta utente**: nuovo select «Aspetto» nel pannello *Lingua e voce* (Come il telefono · Chiaro · Scuro), stringhe in 4 lingue. Salvata **server-side** (`user_preferences.theme`, migrazione 021, CHECK `system|light|dark`, PUT validato → 400 su valori sconosciuti) così segue l'account su ogni dispositivo; copia in `localStorage` per evitare il flash al reload.
- **CSS tokenizzato**: tutti i 168 colori di `dark.css` sono ora token `--c-N` definiti in due soli blocchi (`html[data-theme=dark],:root` e `html[data-theme=light]`); fuori dai blocchi non esistono più colori grezzi (test). Il tema scuro è **identico** a prima (stessi valori). La palette chiara è disegnata **per ruolo** (pagina #eef1ee, superfici bianche, bordi #c5cec8, inchiostro #15201b, verde #1f7a4f/#17603d, tinte verdi morbide, scrim 55 %, ombre al posto dei riempimenti scuri) — non un'inversione: testo su verde resta bianco, glow delle card verde tenue, header/dialog chiari.

## Prove
- `tests/theme.test.ts` (3 test): API (default system, 400 su `neon`/`1`, persistenza, lingua intatta); struttura CSS (due blocchi, ogni token del dark presente nel light, zero colori fuori blocco, `color-scheme` entrambi); Chromium con `colorScheme` light e dark: tema segue il sistema, luminanza sfondo (>0.8 chiaro / <0.05 scuro), contrasto titolo ≥ 7:1, `theme-color` coerente con lo sfondo, cambio da impostazioni → PUT `{theme}` → applicato subito, reload mantiene il tema prima della risposta API, zero errori JS.
- Mutante (sfondo chiaro → #090b0d) → test fallisce; ripristino → passa.
- Screenshot `evidence/theme/*-{light,dark}-{phone,desktop}.png` (home, drawer, chat, impostazioni, login) verificati con vision in 4 iterazioni: v1 inversione automatica bocciata (card fangose, icone scure su verde, composer grigio), v2–v4 palette per ruolo → «deliberate light design», nessun artefatto da dark mode; dark senza regressioni.
- Suite completa: `test-full.log`, `typecheck.log`.

## Limiti
- Il tema chiaro non è stato rivisto da un designer: nit rimasti (band header dialog poco marcata, bolla utente leggera). I PDF/CV non c'entrano (già su carta).
- Nessun toggle rapido nell'header: la scelta è solo in Impostazioni (come richiesto).
