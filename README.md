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


3.40 Home Screen launch fix:
- manifest start_url je ./?v=3400
- vsi lokalni CSS/JS in ikone imajo enotno verzijo 3.40/3400
- standalone zagon prisilno normalizira URL na ?v=3400 pred nalaganjem aplikacije
- izhaja iz stabilne 3.38 postavitve; Smart Fuel in izračuni niso spreminjani.
