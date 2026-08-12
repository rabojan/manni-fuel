const state = {
  lat: null,
  lon: null,
  radiusKm: Number(localStorage.getItem('radiusKm') || 20),
  fuel: localStorage.getItem('fuel') || 'diesel',
  tankerKey: localStorage.getItem('tankerKey') || '',
  stations: [],
  markers: [],
  userMarker: null,
  circle: null,
  map: null
};

const els = {
  status: document.getElementById('statusText'),
  stationList: document.getElementById('stationList'),
  stationCount: document.getElementById('stationCount'),
  radiusLabel: document.getElementById('radiusLabel'),
  radiusSelect: document.getElementById('radiusSelect'),
  fuelSelect: document.getElementById('fuelSelect'),
  tankerKey: document.getElementById('tankerKey'),
  settings: document.getElementById('settingsDialog'),
  sort: document.getElementById('sortSelect'),
  refresh: document.getElementById('refreshBtn')
};

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([46.15, 14.99], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
}

function saveSettings() {
  state.radiusKm = Number(els.radiusSelect.value);
  state.fuel = els.fuelSelect.value;
  state.tankerKey = els.tankerKey.value.trim();
  localStorage.setItem('radiusKm', String(state.radiusKm));
  localStorage.setItem('fuel', state.fuel);
  localStorage.setItem('tankerKey', state.tankerKey);
  updateLabels();
}

function updateLabels() {
  els.radiusLabel.textContent = `${state.radiusKm} km`;
  els.radiusSelect.value = String(state.radiusKm);
  els.fuelSelect.value = state.fuel;
  els.tankerKey.value = state.tankerKey;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function googleNavUrl(station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(station.lat + ',' + station.lon)}&travelmode=driving`;
}

function setPosition(lat, lon, accuracy) {
  state.lat = lat;
  state.lon = lon;

  if (state.userMarker) state.map.removeLayer(state.userMarker);
  if (state.circle) state.map.removeLayer(state.circle);

  const icon = L.divIcon({ className:'', html:'<div class="user-marker"></div>', iconSize:[18,18], iconAnchor:[9,9] });
  state.userMarker = L.marker([lat, lon], { icon }).addTo(state.map).bindPopup('Tvoja lokacija');
  state.circle = L.circle([lat, lon], {
    radius: state.radiusKm * 1000,
    color: '#2563eb',
    weight: 1,
    fillColor: '#2563eb',
    fillOpacity: 0.05
  }).addTo(state.map);

  const bounds = state.circle.getBounds();
  state.map.fitBounds(bounds, { padding:[20,20] });
  els.status.textContent = accuracy ? `Lokacija določena (±${Math.round(accuracy)} m)` : 'Lokacija določena';
}

function locateUser(loadAfter = true) {
  if (!navigator.geolocation) {
    els.status.textContent = 'Ta brskalnik ne podpira GPS lokacije.';
    return;
  }
  els.status.textContent = 'Pridobivam tvojo lokacijo …';
  navigator.geolocation.getCurrentPosition(async pos => {
    setPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    if (loadAfter) await loadStations();
  }, err => {
    els.status.textContent = 'Lokacije ni bilo mogoče pridobiti. Dovoli dostop do lokacije.';
    console.error(err);
  }, { enableHighAccuracy:true, timeout:15000, maximumAge:30000 });
}

async function fetchOsmStations() {
  const radiusM = Math.round(state.radiusKm * 1000);
  const query = `[out:json][timeout:20];nwr["amenity"="fuel"](around:${radiusM},${state.lat},${state.lon});out center tags;`;

  // Public Overpass instances can occasionally be busy or temporarily unavailable.
  // Try several official/community instances instead of failing after the first one.
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter'
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      // POST is more robust than putting the whole Overpass query in the URL.
      const body = new URLSearchParams({ data: query });
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error(`${endpoint} je vrnil neveljaven odgovor`);
      return data.elements.map(el => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) return null;
        const tags = el.tags || {};
        return {
          id: `osm-${el.type}-${el.id}`,
          osmId: el.id,
          lat,
          lon,
          name: tags.name || tags.brand || tags.operator || 'Bencinska črpalka',
          brand: tags.brand || '',
          operator: tags.operator || '',
          address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(' '),
          diesel: null,
          priceUpdated: null,
          priceSource: null,
          distanceKm: haversine(state.lat, state.lon, lat, lon)
        };
      }).filter(Boolean);
    } catch (err) {
      lastError = err;
      console.warn('Overpass neuspešen:', endpoint, err);
    } finally {
      clearTimeout(timer);
    }
  }

  const protocolHint = location.protocol === 'file:'
    ? ' Aplikacija je odprta kot lokalna datoteka; za zanesljivo delovanje jo odpri prek HTTPS.'
    : '';
  throw new Error(`Ni bilo mogoče doseči nobenega Overpass strežnika.${protocolHint} ${lastError?.message || ''}`.trim());
}

let sloveniaPriceCache = null;
let sloveniaPriceCacheAt = 0;

const SI_CORS_WRAPPERS = [
  { name: 'neposredno goriva.si', wrap: url => url },
  { name: 'goriva.si prek AllOrigins', wrap: url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url) },
  { name: 'goriva.si prek corsproxy.io', wrap: url => 'https://corsproxy.io/?url=' + encodeURIComponent(url) }
];

async function fetchJsonWithFallback(url) {
  let lastError = null;
  for (const item of SI_CORS_WRAPPERS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(item.wrap(url), {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { data, source: item.name };
    } catch (err) {
      lastError = err;
      console.warn('Slovenia source failed:', item.name, err);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('goriva.si trenutno ni dosegljiv');
}

async function fetchGorivaSiLive() {
  const base = 'https://goriva.si/api/v1/search/?format=json&page=';
  const first = await fetchJsonWithFallback(base + '1');
  const firstData = first.data;
  if (!Array.isArray(firstData.results)) throw new Error('goriva.si je vrnil neveljaven odgovor');

  const pageSize = firstData.results.length || 25;
  const totalPages = Math.max(1, Math.ceil(Number(firstData.count || firstData.results.length) / pageSize));
  const pages = [firstData.results];

  // Ostale strani nalagamo v manjših paketih, da javnih posrednikov ne obremenimo po nepotrebnem.
  for (let p = 2; p <= totalPages; p += 5) {
    const batch = [];
    for (let n = p; n < Math.min(p + 5, totalPages + 1); n++) {
      batch.push(fetchJsonWithFallback(base + n).then(r => r.data.results || []).catch(() => []));
    }
    pages.push(...await Promise.all(batch));
  }

  return { rows: pages.flat(), source: first.source };
}

async function fetchGorivaMirror() {
  const pageCount = 22;
  const bases = [
    'https://cdn.jsdelivr.net/gh/stefanb/goriva-data@master/data',
    'https://raw.githubusercontent.com/stefanb/goriva-data/master/data'
  ];

  async function fetchPage(page) {
    let lastError = null;
    for (const base of bases) {
      try {
        const response = await fetch(`${base}/search_page_${page}.json`, { cache:'no-store', headers:{'Accept':'application/json'} });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.results)) throw new Error('Neveljaven JSON');
        return data.results;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`Mirror stran ${page} ni dosegljiva`);
  }

  const pages = await Promise.all(Array.from({length:pageCount}, (_,i) => fetchPage(i+1)));
  return { rows: pages.flat(), source: 'goriva.si · goriva-data mirror' };
}

function normalizeSloveniaRows(rows, source) {
  const seen = new Set();
  const out = [];
  for (const s of rows) {
    const pk = s.pk ?? `${s.name}-${s.lat}-${s.lng}`;
    if (seen.has(pk)) continue;
    seen.add(pk);

    const lat = Number(s.lat);
    const lon = Number(s.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = haversine(state.lat, state.lon, lat, lon);
    if (d > state.radiusKm + 0.15) continue;

    const rawPrice = s.prices?.dizel;
    const diesel = rawPrice == null ? null : Number(String(rawPrice).replace(',', '.'));
    out.push({
      id: `si-${pk}`,
      lat,
      lon,
      name: String(s.name || 'Bencinska črpalka').trim(),
      brand: '',
      operator: '',
      address: [s.address, s.zip_code].filter(Boolean).join(', '),
      diesel: Number.isFinite(diesel) && diesel > 0 ? diesel : null,
      priceUpdated: null,
      priceSource: source,
      distanceKm: d
    });
  }
  return out;
}

async function fetchSloveniaPrices() {
  // 5-minutni pomnilnik: pri ponovnem razvrščanju/osveževanju ne nalagamo cele Slovenije znova.
  if (sloveniaPriceCache && Date.now() - sloveniaPriceCacheAt < 5 * 60 * 1000) {
    return {
      stations: normalizeSloveniaRows(sloveniaPriceCache.rows, sloveniaPriceCache.source),
      source: sloveniaPriceCache.source
    };
  }

  let dataset;
  try {
    dataset = await fetchGorivaSiLive();
  } catch (liveErr) {
    console.warn('Live goriva.si ni dosegljiv, poskušam mirror:', liveErr);
    dataset = await fetchGorivaMirror();
  }

  sloveniaPriceCache = dataset;
  sloveniaPriceCacheAt = Date.now();
  return { stations: normalizeSloveniaRows(dataset.rows, dataset.source), source: dataset.source };
}

async function fetchGermanyPrices() {
  if (!state.tankerKey) return [];
  const radius = Math.min(state.radiusKm, 25); // Tankerkönig list endpoint max radius is limited.
  const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${state.lat}&lng=${state.lon}&rad=${radius}&sort=dist&type=diesel&apikey=${encodeURIComponent(state.tankerKey)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  if (!data.ok || !Array.isArray(data.stations)) return [];
  return data.stations.map(s => ({
    id: s.id,
    lat: s.lat,
    lon: s.lng,
    name: s.name || s.brand || 'Bencinska črpalka',
    brand: s.brand || '',
    address: [s.street, s.houseNumber, s.place].filter(Boolean).join(' '),
    diesel: typeof s.diesel === 'number' ? s.diesel : null,
    priceUpdated: null,
    priceSource: 'Tankerkönig / MTS-K',
    distanceKm: typeof s.dist === 'number' ? s.dist : haversine(state.lat, state.lon, s.lat, s.lng)
  }));
}

async function fetchSpainPrices() {
  // Uradni španski REST vir vrača vse bencinske črpalke; filtriramo lokalno po radiusu.
  const url = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  const list = data.ListaEESSPrecio || [];
  return list.map((s, i) => {
    const lat = Number(String(s.Latitud || '').replace(',', '.'));
    const lon = Number(String(s['Longitud (WGS84)'] || '').replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const d = haversine(state.lat, state.lon, lat, lon);
    if (d > state.radiusKm) return null;
    const raw = s['Precio Gasoleo A'];
    const price = raw ? Number(String(raw).replace(',', '.')) : null;
    return {
      id: `es-${s.IDEESS || i}`,
      lat, lon,
      name: s.Rótulo || 'Bencinska črpalka',
      brand: s.Rótulo || '',
      address: [s.Dirección, s.Localidad].filter(Boolean).join(', '),
      diesel: Number.isFinite(price) ? price : null,
      priceUpdated: [s.Fecha, s.Horario].filter(Boolean).join(' '),
      priceSource: 'Gobierno de España',
      distanceKm: d
    };
  }).filter(Boolean);
}

async function detectCountryCode() {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${state.lat}&lon=${state.lon}&zoom=5&addressdetails=1`;
    const response = await fetch(url, { headers: { 'Accept-Language': 'sl,en' } });
    if (!response.ok) return null;
    const data = await response.json();
    return data.address?.country_code?.toUpperCase() || null;
  } catch {
    return null;
  }
}

function mergeStations(osm, priced) {
  if (!priced.length) return osm;
  const out = [...priced];
  // Add OSM stations not already represented within 250 m.
  for (const s of osm) {
    const duplicate = priced.some(p => haversine(s.lat, s.lon, p.lat, p.lon) < 0.25);
    if (!duplicate) out.push(s);
  }
  return out;
}

async function loadStations() {
  if (state.lat == null || state.lon == null) return;
  els.refresh.disabled = true;
  els.stationList.innerHTML = '<div class="loading">Iščem bencinske črpalke …</div>';
  els.status.textContent = `Iščem v območju ${state.radiusKm} km …`;

  try {
    if (state.circle) {
      state.circle.setRadius(state.radiusKm * 1000);
      state.map.fitBounds(state.circle.getBounds(), { padding:[20,20] });
    }

    const country = await detectCountryCode();
    let osm = [];
    let priced = [];
    let priceWarning = '';

    // Country adapters: each country can provide station-level prices in one common format.
    // Slovenia uses a browser-friendly mirror of the goriva.si API dataset.
    let activePriceSource = '';
    if (country === 'SI') {
      try {
        const siResult = await fetchSloveniaPrices();
        priced = siResult.stations;
        activePriceSource = siResult.source;
      } catch (e) {
        console.warn('Slovenia price API:', e);
        priceWarning = ' · slovenski cenik trenutno ni dosegljiv';
      }
      // OSM remains a fallback for station locations and can fill any rare gaps.
      try { osm = await fetchOsmStations(); } catch (e) { console.warn('OSM fallback:', e); }
    } else {
      osm = await fetchOsmStations();
      if (country === 'DE' && state.tankerKey) {
        priced = await fetchGermanyPrices();
      } else if (country === 'ES') {
        try { priced = await fetchSpainPrices(); } catch (e) { console.warn('Spain price API:', e); }
      }
    }

    state.stations = mergeStations(osm, priced).filter(s => s.distanceKm <= state.radiusKm + 0.1);
    renderStations();
    const pricedCount = state.stations.filter(s => s.diesel != null).length;
    els.status.textContent = `${state.stations.length} črpalk · ${pricedCount} s ceno · ${state.radiusKm} km${country ? ` · ${country}` : ''}${activePriceSource ? ` · ${activePriceSource}` : ''}${priceWarning}`;
  } catch (err) {
    console.error(err);
    const detail = escapeHtml(err?.message || 'Neznana napaka');
    els.stationList.innerHTML = `<div class="empty-state"><strong>Črpalk trenutno ni bilo mogoče naložiti.</strong><br><span style="display:block;margin-top:8px">${detail}</span><br>Poskusi ponovno z gumbom <strong>Osveži</strong>.</div>`;
    els.status.textContent = location.protocol === 'file:'
      ? 'Aplikacijo odpri prek HTTPS – lokalno odpiranje lahko blokira iskanje črpalk.'
      : 'Napaka pri pridobivanju črpalk – poskusi znova.';
  } finally {
    els.refresh.disabled = false;
  }
}

function sortedStations() {
  const arr = [...state.stations];
  if (els.sort.value === 'distance') return arr.sort((a,b) => a.distanceKm - b.distanceKm);
  return arr.sort((a,b) => {
    if (a.diesel == null && b.diesel == null) return a.distanceKm - b.distanceKm;
    if (a.diesel == null) return 1;
    if (b.diesel == null) return -1;
    return a.diesel - b.diesel || a.distanceKm - b.distanceKm;
  });
}

function renderStations() {
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];

  const stations = sortedStations();
  els.stationCount.textContent = String(stations.length);

  if (!stations.length) {
    els.stationList.innerHTML = '<div class="empty-state">V tem območju nisem našel bencinskih črpalk.</div>';
    return;
  }

  els.stationList.innerHTML = '';

  stations.forEach(s => {
    const priceText = s.diesel != null ? `${s.diesel.toFixed(3)} €/l` : 'Cena ni na voljo';
    const pinHtml = `<div class="price-pin">${s.diesel != null ? s.diesel.toFixed(3) + ' €' : '⛽'}</div>`;
    const marker = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className:'', html:pinHtml, iconAnchor:[20,14] })
    }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(s.name)}</strong><br>${priceText}<br>${s.distanceKm.toFixed(1)} km<br><a href="${googleNavUrl(s)}" target="_blank" rel="noopener">Navigiraj z Google Maps</a>`);
    state.markers.push(marker);

    const card = document.createElement('article');
    card.className = 'station-card';
    card.innerHTML = `
      <div>
        <h3 class="station-name">${escapeHtml(s.name)}</h3>
        <div class="station-meta">
          <span>📍 ${s.distanceKm.toFixed(1)} km</span>
          ${s.address ? `<span>${escapeHtml(s.address)}</span>` : ''}
        </div>
        <a class="nav-btn" href="${googleNavUrl(s)}" target="_blank" rel="noopener">Navigiraj</a>
        ${s.priceSource ? `<div class="source-note">Cena: ${escapeHtml(s.priceSource)}${s.priceUpdated ? ` · ${escapeHtml(s.priceUpdated)}` : ''}</div>` : '<div class="source-note">Lokacija: OpenStreetMap · cena za to državo še ni priklopljena</div>'}
      </div>
      <div class="price ${s.diesel == null ? 'missing' : ''}">${priceText}</div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      state.map.setView([s.lat, s.lon], 15);
      marker.openPopup();
      window.scrollTo({ top:0, behavior:'smooth' });
    });
    els.stationList.appendChild(card);
  });
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  updateLabels();
  els.settings.showModal();
});
document.getElementById('saveSettingsBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  saveSettings();
  els.settings.close();
  if (state.lat != null) await loadStations();
});
document.getElementById('locateBtn').addEventListener('click', () => locateUser(true));
document.getElementById('refreshBtn').addEventListener('click', () => loadStations());
els.sort.addEventListener('change', renderStations);

initMap();
updateLabels();
locateUser(true);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
