# Manni Fuel v8

V8 uporablja lasten Cloudflare Worker med GitHub Pages in Pumperly. S tem se javni `corsproxy.io` odstrani iz glavne poti in se odziv lahko predpomni na Cloudflare robnem omrežju.

## Datoteke za GitHub Pages
Naloži/zamenjaj: `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`.

## Cloudflare Worker
Datoteka `cloudflare-worker.js` je pripravljena za Cloudflare Workers. Worker dovoljuje klice iz `https://rabojan.github.io` in posreduje samo dve Pumperly poti: `/api/stations` in `/api/exchange-rates`.

Po objavi Workerja dobiš naslov, npr. `https://manni-fuel-api.<tvoj-subdomain>.workers.dev`. Ta naslov v Manni Fuel vneseš pod ⚙️ Nastavitve → Manni API (Cloudflare Worker).

Če Worker ni nastavljen ali začasno odpove, aplikacija še vedno uporabi rezervno pot: neposredni Pumperly → AllOrigins → corsproxy.io.


## v9 – iskanje po zemljevidu
Poleg iskanja okoli trenutne GPS lokacije lahko zemljevid premakneš kamorkoli po Evropi in pritisneš **Poišči na tem območju**. Aplikacija uporabi središče trenutno prikazanega zemljevida ter isti radij, ki je nastavljen v Nastavitvah. Gumb ◎ vrne iskanje na tvojo GPS lokacijo.
