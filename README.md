# Manni Fuel 3.18 — Price Sanity beta

Spremembe po 3.17:
- tuje valute v popupu: lokalna cena + približen EUR/l,
- Najcenejše primerja normalizirano ceno v EUR,
- lokalni sanity filter cen loči avtocestne in izven-avtocestne postaje,
- sumljiv ekstrem (ob dovolj primerljivih lokalnih postajah) se skrije z zemljevida in iz Smart Fuel,
- filter je konservativen: če ni dovolj primerljivih postaj, OSM klasifikacije ali FX podatka, postaje ne skrije.

Beta pragovi:
- najmanj 5 primerljivih postaj v istem tipu okolja,
- lokalni radij 45 km,
- manj kot 75 % lokalnega mediana ali več kot 145 % lokalnega mediana = izločitev.
