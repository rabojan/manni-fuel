# Manni Fuel 3.11 — Smart Fuel Recommendation beta

Adds an isolated smart-refuelling module on top of the stable 3.10 map build.

- reads current GPS position, saved route, fuel and average consumption
- keeps the fixed 10 L reserve
- builds the remaining road route using existing route points
- searches fuel stations along the reachable route
- only considers stations up to 5 km from the route corridor
- shows one main recommendation and two alternatives
- prefers lowest price, but keeps roughly 100 km of additional safety margin before the reserve limit whenever possible
- recommendation refreshes after app start, route/fuel changes and the main Refresh action
- "Pokaži na zemljevidu" moves the map to the recommended station

This beta deliberately does not yet implement country-border price strategy. That should be added only after the core recommendation is validated.
