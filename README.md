# Manni Fuel 2.0

Mobilna PWA za hitro iskanje cen dizla po Evropi.

## Kaj je novo
- zemljevid čez cel zaslon
- drsni bottom sheet s črpalkami
- cenovni markerji neposredno na zemljevidu
- iskanje okoli GPS lokacije ali okoli poljubnega dela zemljevida
- Google Maps navigacija
- optimiziran Cloudflare Worker z geografskim cacheom
- timeouti so kratki: aplikacija ne čaka več zaporedoma 20–60 sekund na javne CORS proxyje

## GitHub Pages
Na GitHub naloži:
- index.html
- styles.css
- app.js
- manifest.json
- sw.js
- icon-192.png
- icon-512.png
- apple-touch-icon.png

## Cloudflare Worker
Datoteki:
- cloudflare-worker.js
- wrangler.toml

Worker objavi kot `manni-fuel-api`. Nato njegov URL vpiši v Manni Fuel: **••• → Manni API — Cloudflare Worker**.

Primer URL-ja:
`https://manni-fuel-api.<tvoj-subdomain>.workers.dev`

## Kako deluje cache
Worker center iskanja zaokroži na približno 0,05° (~5 km) in uporablja radijske razrede 10/20/30/50 km. Zato premiki po istem območju pogosto zadenejo isti Cloudflare cache in so precej hitrejši.

Pumperly uporablja bbox endpoint za črpalke; Manni Worker rezultate predpomni za 5 minut ter omogoča stale odzive do 30 minut.

## ETA
Gumb *Calculate ETAs* je v 2.0 vizualno pripravljen, vendar namenoma še ni aktiven. Za pravi ETA potrebujemo routing API; ne prikazujemo izmišljenega časa vožnje.
