# Manni Fuel 3.20 — National + local price sanity beta

Built on 3.19. No route, trip, fuel-log, GPS-checkpoint, map UX, or recommendation-window architecture was removed.

## New in 3.20

- Adds a second price sanity gate using **national weekly diesel averages** from the European Commission Weekly Oil Bulletin (prices with taxes, week of 10 Aug 2026).
- Local sanity remains road-aware: motorway stations are compared with motorway peers and off-motorway stations with off-motorway peers.
- A clearly implausibly **low** price (more than 20% below the current national weekly average) is hidden from the map and excluded from Smart Fuel even if a whole local cluster contains similarly bad prices.
- A high price is **not** rejected from the national benchmark alone, because motorway premiums can legitimately be large. High-price rejection remains local and road-class aware.
- If the embedded national benchmark is older than 35 days, the national gate disables itself automatically rather than hiding stations on stale reference data. Local road-aware sanity remains active.
- Foreign-currency popups continue to show native price plus approximate EUR conversion.

Reference date: 2026-08-10.
