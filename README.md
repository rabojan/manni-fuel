# Manni's World — Fuel 3.4 (trips/archive beta)

Safe incremental beta built on 3.3.

## Added
- Active trip lifecycle: start, finish, archive.
- Archived trip details: route snapshot, kilometres, litres, total fuel cost, average €/l, measured consumption when exact full-to-full data exists, and all refuelling entries.
- Safe deletion of current/test trip data without deleting vehicle settings or archive.
- Optional deletion of individual archived trips or the whole archive with confirmation.
- Vehicle settings remain global and survive trip completion.
- Partial refuelling now updates estimated current fuel when previous fuel, odometer and average consumption are known.
- Removed the redundant top Diesel chip (fuel remains Diesel B7 internally).

## Intentionally unchanged
- Map core
- Pumperly / Worker station source
- Marker clustering and popups
- Bottom sheet logic
- Route entry module

## Storage
Schema v3 migrates existing route, vehicle and fuel data and adds `activeTrip` + `tripArchive`.
