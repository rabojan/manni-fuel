# Manni Fuel 3.23 — Border Strategy beta

Ta verzija nadgrajuje 3.22 in ohranja vse prejšnje funkcije.

## Novo
- Smart Fuel najprej pregleda prehode med državami na trenutnem dosegljivem delu poti.
- Primerja samo preverjene in cenovno verodostojne kandidate, cene pa normalizira v EUR.
- Za primerjavo med državami daje prednost preverjenim črpalkam izven avtoceste; če jih je premalo, uporabi vse preverjene v državi.
- Če je naslednja država smiselno cenejša in je dosegljiva, priporoči tankanje po meji.
- Če je trenutna država smiselno cenejša, najprej išče smiselno tankanje pred mejo.
- Mejna strategija se ne aktivira za majhne razlike: prag je približno 0,06 EUR/l oziroma 4 %.
- Zgodnji postanek zaradi meje se predlaga samo, če lahko natočiš vsaj približno 35 % rezervoarja ali je ocenjeni realni prihranek vsaj 5 EUR.
- Šele po odločitvi pred/po meji se izbere konkretno PRIPOROČENO ter prejšnja/kasnejša možnost.
- 10 l ostaja normalna rezerva, absolutna meja ostaja 8 l.
- Po Osveži se najprej preračuna trenutno gorivo in nato celotna mejna strategija ponovno.

Zemljevid, ture, tankanja, GPS checkpointi, arhiv in preverjanje cen ostajajo iz 3.22/3.20.
