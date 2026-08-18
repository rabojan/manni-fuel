# Manni's World 3.58 — Multilingual Help & Guide

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


## 3.58
- Pot: začetek je lahko Moja trenutna lokacija ali poljubno potrjeno mesto.
- Stroški poti: odstranjeni Do zdaj plačano, Še do cilja in Strošek / 100 km.
- Dejanska poraba ostaja; izračun full-to-full je nespremenjen.

## 3.36.0 – Price Trust + Smart Fuel timing
- Sumljive cene so zavrnjene pred prikazom in pred Smart Fuel izborom.
- Prag za očitno prenizko ceno je zaostren na približno 10 % pod zanesljivim državnim/lokalnim nivojem.
- Lokalna primerjava je ločena za avtocestne in ne-avtocestne postaje.
- OSM-verifikacija lahko popravi napačno državo postaje (`addr:country`), zato je pravilnejša tudi zastava.
- Strategija pred/po meji ne sme več prisiliti nerazumno zgodnjega tankanja, ko je rezervoar še več kot približno napol poln, razen ob res izjemni preverjeni priložnosti.
- Nemški nacionalni varnostni benchmark je v tej izdaji osvežen z ADAC dnevnim povprečjem za 17. 8. 2026; brez API ključa Tankerkönig/MTS-K ostaja vir posamezne postaje Pumperly, zato strogi sanity filter ostaja obvezen.
