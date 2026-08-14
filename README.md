# Manni's World 3.35 — Multilingual Help & Guide

Nadgradnja 3.33 z integriranimi navodili za uporabo.

## Novo
- v Nastavitvah je gumb **Navodila za uporabo / Anleitung / User guide**
- navodila so integrirana neposredno v aplikacijo
- vsebina se samodejno preklopi glede na izbran jezik: **SL / DE / EN**
- vizualni elementi navodil so izdelani v istem slogu kot Manni in se ne zanašajo na statične slike z napačnim jezikom
- vodič razloži namen aplikacije, nastavitve vozila, pot, razliko do Sygica, obvoze in Osveži, Smart Fuel, meje, avtocesto, rezervo 10/8 l, preverjanje cen in črpalk, tankanja, stroške, ture in osebne nastavitve

## Pomembno
Smart Fuel algoritem, routing, Pumperly/OSM logika, tankanja in stroški poti niso vsebinsko spremenjeni.

Testna URL različica po objavi na GitHub Pages:
`https://rabojan.github.io/manni-fuel/?v=334`


## 3.36
Main map UI cleanup: removed the 'Najnižja cena' display and the 'Najcenejše / Najbližje' selector. The central Refresh button remains. Smart Fuel and station data logic are unchanged. Help text updated accordingly in SL/DE/EN.

3.38: clean rebuild zgornje vozne vrstice iz stabilne 3.36 osnove. Cilj, Osveži in Lokacija so v eni vrstici; vsi gumbi so klikabilni. Splash uporablja 100dvh.

3.39 PWA/Home Screen cache fix:
- all local CSS/JS/manifest/icon URLs use the same 3.39 build version,
- Home Screen standalone mode detects a new build and performs one fresh reload,
- stale service workers are unregistered,
- Cache Storage is cleared,
- no Smart Fuel, routing, map, fuel, trip or UI-layout logic was changed from 3.38.
