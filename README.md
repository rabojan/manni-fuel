# Manni Fuel 3.21 — Alternatives + map focus fix beta

Built on 3.20. No map, trip, fuel-log, route, GPS-checkpoint, price-sanity or Smart Fuel core architecture was removed.

## Fixed in 3.21

- Smart Fuel alternatives now have explicit roles. A **PREJŠNJA MOŽNOST** must be at least 60 km before the main recommendation and a **KASNEJŠA MOŽNOST** at least 60 km after it. If one side has no meaningful candidate, Manni shows fewer cards instead of inventing a mislabeled alternative.
- A later option below 10 l is clearly labeled **SKRAJNA MOŽNOST**.
- Exactly **10.0 l** is treated as the reserve boundary, not as entering the reserve. The warning appears only below the 10 l boundary (with a small rounding tolerance).
- All **Pokaži na zemljevidu** buttons now work even when the recommended station is outside the currently loaded map cell: the map moves to the exact verified station and opens a temporary popup directly if necessary.
- Price sanity, national sanity, motorway/off-motorway logic and Slovenian number formatting remain unchanged.
