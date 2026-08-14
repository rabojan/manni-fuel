# Manni Fuel 3.16 — Smart Refuel Window beta

- Osveži najprej zaključi GPS checkpoint in preračuna ocenjeno gorivo; šele nato se ponovno izračuna Smart Fuel.
- Normalna rezerva ostaja 10 l; izjemoma se lahko uporabi največ 20 % te rezerve, absolutna meja je 8 l.
- Zgodnje poceni tankanje upošteva samo litre, ki jih je ob prihodu dejansko mogoče natočiti.
- Praviloma ne priporoča ekonomskega postanka, dokler je ob prihodu več kot polovica rezervoarja; izjema je izrazito velik dejanski prihranek.
- Priporočilo je dinamično: po osvežitvi lahko ostane isto ali se spremeni glede na novo gorivo, lokacijo, cene in preverjene postaje.
- Zemljevid, ture, tankanja in verifikacija postaj ostajajo ločeni moduli.


## 3.16 changes
- Smart Fuel no longer picks three stations from the same early cluster.
- Normal recommendation window is the final ~120 km before the 10 l reserve.
- Early economical stops require a meaningful real fill; normally no stop while more than half a tank remains unless the saving is exceptional.
- Alternatives are route-spread: one meaningfully earlier and one meaningfully later where available (minimum ~60 km separation).
- Verified candidates are sampled across the whole reachable route, not just from the cheapest early area.
- Cross-border prices are normalized to EUR using daily Frankfurter reference rates before ranking; native pump currency remains visible.
