# Manni Fuel v7 — centralna Evropa

Manni Fuel v7 ne kliče več ločenih državnih API-jev iz telefona. Primarni cenovni vir je centralni Pumperly backend, ki podatke zbira in normalizira po državah. OpenStreetMap ostaja rezervni vir lokacij.

## Pokritje cen v Evropi
31 držav: ES, FR, DE, IT, GB, AT, PT, SI, NL, BE, LU, RO, GR, IE, HR, CH, PL, CZ, HU, BG, SK, DK, SE, NO, RS, FI, EE, LV, LT, BA, MK.

## Delovanje
- GPS trenutna lokacija
- 5 / 10 / 20 / 30 / 50 km od uporabnika
- Diesel B7
- zemljevid in seznam
- cena v lokalni valuti
- približna pretvorba v EUR za države izven EUR (tečaji prek Pumperly/ECB)
- razvrščanje po ceni ali oddaljenosti
- Google Maps navigacija
- čas zadnje objavljene cene, kadar ga vir vsebuje
- OpenStreetMap fallback, če centralni cenovni vir ni dosegljiv

## GitHub Pages
Zamenjaj `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js` in po želji `README.md`. Po deploymentu naredi hard refresh (Cmd + Shift + R).

## Pomembno
Manni Fuel v7 je odvisen od javnega Pumperly backend-a. Pumperly je odprtokodni sistem in njegova javna instanca je namenjena tudi zunanjim integracijam. Če bo aplikacija kdaj postala javni izdelek z več uporabniki, je smiselno preiti na lasten backend/self-hosted Pumperly ali pridobiti dovoljenje/lasten podatkovni sloj.
