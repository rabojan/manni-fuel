# Manni Fuel 3.31 — direct recommendation popup fix

- Smart Fuel logic is unchanged from 3.29.
- `Pokaži na zemljevidu` now closes the route dialog, zooms directly to the selected station (zoom 16), highlights it and opens its popup automatically.
- The popup immediately exposes station name, price, distance/opening-hours enrichment and the `Navigiraj` action.
- The focused recommendation uses a temporary high-priority marker so it remains obvious even when many other stations exist nearby.


## 3.31
- Pokaži na zemljevidu zapre Pot in takoj skoči na priporočeno črpalko brez animacije.
- Popup se odpre neposredno na koordinati, neodvisno od cluster markerjev in novega nalaganja postaj.
- Odpiralni čas in cestna razdalja se dopolnita naknadno, zato mreža ne more zadržati odprtja popupa.
