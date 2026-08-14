# Manni Fuel 3.29 — Route-country border fix

- Border Strategy follows only countries from the confirmed route instead of nearby-country fuel stations.
- Current country is inferred only near the start; subsequent country anchors come from confirmed route points.
- Very early “Prejšnja možnost” is hidden when the tank is still too full for a meaningful refuel (less than ~30% tank capacity can be added).
- Smart Fuel performance pipeline, price sanity, verification cache, reserve logic and map behavior remain unchanged from 3.28.
