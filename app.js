const state = {
  lat: null,
  lon: null,
  radiusKm: Number(localStorage.getItem('radiusKm') || 20),
  fuel: 'B7',
  stations: [],
  markers: [],
  userMarker: null,
  circle: null,
  map: null,
  rates: { EUR: 1 },
  ratesDate: null,
  dataRoute: ''
};

const els = {
  status: document.getElementById('statusText'),
  stationList: document.getElementById('stationList'),
  stationCount: document.getElementById('stationCount'),
  radiusLabel: document.getElementById('radiusLabel'),
  radiusSelect: document.getElementById('radiusSelect'),
  fuelSelect: document.getElementById('fuelSelect'),
  settings: document.getElementById('settingsDialog'),
  sort: document.getElementById('sortSelect'),
  refresh: document.getElementById('refreshBtn'),
  listInfo: document.getElementById('listInfo')
};

const EUROPE = {
  ES:['🇪🇸','Španija'], FR:['🇫🇷','Francija'], DE:['🇩🇪','Nemčija'], IT:['🇮🇹','Italija'], GB:['🇬🇧','Združeno kraljestvo'],
  AT:['🇦🇹','Avstrija'], PT:['🇵🇹','Portugalska'], SI:['🇸🇮','Slovenija'], NL:['🇳🇱','Nizozemska'], BE:['🇧🇪','Belgija'],
  LU:['🇱🇺','Luksemburg'], RO:['🇷🇴','Romunija'], GR:['🇬🇷','Grčija'], IE:['🇮🇪','Irska'], HR:['🇭🇷','Hrvaška'],
  CH:['🇨🇭','Švica'], PL:['🇵🇱','Poljska'], CZ:['🇨🇿','Češka'], HU:['🇭🇺','Madžarska'], BG:['🇧🇬','Bolgarija'],
  SK:['🇸🇰','Slovaška'], DK:['🇩🇰','Danska'], SE:['🇸🇪','Švedska'], NO:['🇳🇴','Norveška'], RS:['🇷🇸','Srbija'],
  FI:['🇫🇮','Finska'], EE:['🇪🇪','Estonija'], LV:['🇱🇻','Latvija'], LT:['🇱🇹','Litva'], BA:['🇧🇦','BiH'], MK:['🇲🇰','Severna Makedonija']
};

const WRAPPERS = [
  { name:'Pumperly neposredno', wrap:u=>u },
  { name:'Pumperly prek AllOrigins', wrap:u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u) },
  { name:'Pumperly prek corsproxy.io', wrap:u=>'https://corsproxy.io/?url='+encodeURIComponent(u) }
];

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([46.15, 14.99], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
}

function updateLabels() {
  els.radiusLabel.textContent = `${state.radiusKm} km`;
  els.radiusSelect.value = String(state.radiusKm);
  els.fuelSelect.value = state.fuel;
}

function saveSettings() {
  state.radiusKm = Number(els.radiusSelect.value);
  state.fuel = els.fuelSelect.value;
  localStorage.setItem('radiusKm', String(state.radiusKm));
  updateLabels();
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
    color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.05
  }).addTo(state.map);
  state.map.fitBounds(state.circle.getBounds(), { padding:[20,20] });
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

function bboxForRadius(lat, lon, radiusKm) {
  const latPad = radiusKm / 111.32;
  const lonPad = radiusKm / Math.max(15, 111.32 * Math.cos(lat * Math.PI/180));
  return [lon-lonPad, lat-latPad, lon+lonPad, lat+latPad];
}

async function fetchJsonResilient(url, timeout=22000) {
  let lastError = null;
  for (const w of WRAPPERS) {
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeout);
    try {
      const r = await fetch(w.wrap(url), { cache:'no-store', headers:{Accept:'application/json'}, signal:ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return { data, route:w.name };
    } catch(e) {
      lastError = e;
      console.warn('Vir neuspešen', w.name, e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Centralni vir ni dosegljiv');
}

async function loadExchangeRates() {
  try {
    const r = await fetchJsonResilient('https://pumperly.com/api/exchange-rates', 15000);
    if (r.data && r.data.rates) {
      state.rates = r.data.rates;
      state.ratesDate = r.data.date || null;
    }
  } catch(e) {
    console.warn('Tečajev ni bilo mogoče naložiti', e);
    state.rates = { EUR: 1 };
  }
}

function eurValue(price, currency) {
  if (price == null) return null;
  if (!currency || currency === 'EUR') return price;
  const rate = Number(state.rates[currency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  // ECB: 1 EUR = rate units of currency.
  return price / rate;
}

function formatPrice(price, currency='EUR') {
  if (price == null) return 'Cena ni na voljo';
  const c = currency || 'EUR';
  const decimals = c === 'HUF' || c === 'RSD' ? 1 : 3;
  return `${Number(price).toFixed(decimals)} ${c}/l`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((Date.now()-t)/60000));
  if (min < 60) return `pred ${min} min`;
  const h = Math.round(min/60);
  if (h < 48) return `pred ${h} h`;
  const d = Math.round(h/24);
  return `pred ${d} d`;
}

async function fetchPumperlyStations() {
  const bbox = bboxForRadius(state.lat, state.lon, state.radiusKm);
  const url = `https://pumperly.com/api/stations?bbox=${bbox.map(n=>n.toFixed(6)).join(',')}&fuel=${encodeURIComponent(state.fuel)}`;
  const r = await fetchJsonResilient(url, 25000);
  state.dataRoute = r.route;
  const features = r.data?.features || [];
  const out = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const p = f.properties || {};
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]), lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const distanceKm = haversine(state.lat, state.lon, lat, lon);
    if (distanceKm > state.radiusKm + 0.15) continue;
    let price = p.price == null ? null : Number(p.price);
    if (!Number.isFinite(price) || price <= 0) price = null;
    const currency = p.currency || 'EUR';
    out.push({
      id: String(p.id || p.externalId || `${lat}-${lon}`),
      name: p.name || p.brand || 'Bencinska črpalka',
      brand: p.brand || '',
      address: [p.address, p.city].filter(Boolean).join(', '),
      city: p.city || '',
      lat, lon, distanceKm,
      diesel: price,
      currency,
      eurPrice: eurValue(price, currency),
      country: p.country || '',
      updated: p.reportedAt || null,
      source: 'Pumperly'
    });
  }
  return out;
}

async function fetchOsmStations() {
  const radiusM=Math.round(state.radiusKm*1000);
  const query=`[out:json][timeout:20];nwr["amenity"="fuel"](around:${radiusM},${state.lat},${state.lon});out center tags;`;
  const endpoints=['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter'];
  for(const endpoint of endpoints) {
    try {
      const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),18000);
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}),signal:ctrl.signal}); clearTimeout(timer);
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      return (data.elements||[]).map(el=>{
        const lat=el.lat??el.center?.lat, lon=el.lon??el.center?.lon; if(lat==null||lon==null) return null;
        const t=el.tags||{};
        return { id:`osm-${el.type}-${el.id}`, name:t.name||t.brand||t.operator||'Bencinska črpalka', brand:t.brand||'', address:[t['addr:street'],t['addr:housenumber'],t['addr:city']].filter(Boolean).join(' '), lat, lon, diesel:null, currency:'EUR', eurPrice:null, country:'', source:'OpenStreetMap', updated:null, distanceKm:haversine(state.lat,state.lon,lat,lon) };
      }).filter(s=>s && s.distanceKm <= state.radiusKm + 0.15);
    } catch(e){ console.warn('Overpass neuspešen',endpoint,e); }
  }
  return [];
}

function dedupe(stations) {
  const sorted=[...stations].sort((a,b)=>(a.diesel==null)-(b.diesel==null));
  const out=[];
  for(const s of sorted) {
    const duplicate=out.find(x=>haversine(s.lat,s.lon,x.lat,x.lon)<0.08);
    if(!duplicate) out.push(s);
    else if(duplicate.diesel==null && s.diesel!=null) Object.assign(duplicate,s);
  }
  return out;
}

async function loadStations() {
  if(state.lat==null) return;
  els.refresh.disabled=true;
  els.stationList.innerHTML='<div class="loading">Nalagam evropske cene dizla …</div>';
  els.status.textContent='Povezujem se s centralnim evropskim virom …';
  const results=[];
  let centralError=null;

  await loadExchangeRates();
  try {
    results.push(...await fetchPumperlyStations());
  } catch(e) {
    centralError=e;
    console.warn('Pumperly neuspešen',e);
  }

  // OSM dopolni lokacije in služi kot rezerva, če centralni vir odpove.
  try { results.push(...await fetchOsmStations()); } catch(e) { console.warn(e); }

  state.stations=dedupe(results).filter(s=>s.distanceKm<=state.radiusKm+0.15);
  renderStations();
  const priced=state.stations.filter(s=>s.diesel!=null).length;
  const countries=[...new Set(state.stations.map(s=>s.country).filter(Boolean))];
  const countryText=countries.map(c=>`${EUROPE[c]?.[0]||''} ${c}`).join(' · ');
  els.status.textContent = `${state.stations.length} črpalk · ${priced} s ceno${countryText ? ' · '+countryText : ''}`;
  if (centralError) {
    els.listInfo.textContent='Centralni cenovni vir trenutno ni dosegljiv; prikazane so rezervne lokacije OpenStreetMap.';
  } else {
    els.listInfo.textContent=`Vir cen: ${state.dataRoute || 'Pumperly'}${state.ratesDate ? ` · tečaji ECB ${state.ratesDate}` : ''}`;
  }
  els.refresh.disabled=false;
}

function pricePinIcon(station) {
  const txt=station.diesel!=null ? `${Number(station.diesel).toFixed(station.currency==='HUF'||station.currency==='RSD'?1:3)} ${station.currency||'EUR'}` : '⛽';
  return L.divIcon({className:'',html:`<div class="price-pin">${escapeHtml(txt)}</div>`,iconSize:[82,26],iconAnchor:[41,13]});
}

function renderStations() {
  for(const m of state.markers) state.map.removeLayer(m);
  state.markers=[];
  const sort=els.sort.value;
  const arr=[...state.stations].sort((a,b)=>{
    if(sort==='distance') return a.distanceKm-b.distanceKm;
    if(a.diesel==null && b.diesel!=null) return 1;
    if(a.diesel!=null && b.diesel==null) return -1;
    const ap=a.eurPrice, bp=b.eurPrice;
    if(ap!=null && bp!=null && ap!==bp) return ap-bp;
    if(a.currency===b.currency && a.diesel!=null && b.diesel!=null && a.diesel!==b.diesel) return a.diesel-b.diesel;
    return a.distanceKm-b.distanceKm;
  });
  els.stationCount.textContent=String(arr.length);
  if(!arr.length){ els.stationList.innerHTML='<div class="empty-state">V izbranem območju ni bilo mogoče najti črpalk.</div>'; return; }
  els.stationList.innerHTML='';
  for(const s of arr){
    const flag=EUROPE[s.country]?.[0] || '';
    const nativePrice=formatPrice(s.diesel,s.currency);
    const approx = s.diesel!=null && s.currency!=='EUR' && s.eurPrice!=null ? ` ≈ ${s.eurPrice.toFixed(3)} EUR/l` : '';
    const age=timeAgo(s.updated);
    const m=L.marker([s.lat,s.lon],{icon:pricePinIcon(s)}).addTo(state.map).bindPopup(`<strong>${flag} ${escapeHtml(s.name)}</strong><br>${s.distanceKm.toFixed(1)} km<br>${s.diesel!=null?`${escapeHtml(nativePrice)}${escapeHtml(approx)}`:'Cena ni na voljo'}${age?`<br><small>${escapeHtml(age)}</small>`:''}`);
    state.markers.push(m);
    const card=document.createElement('article'); card.className='station-card';
    card.innerHTML=`<div><h3 class="station-name">${flag} ${escapeHtml(s.name)}</h3><div class="station-meta"><span>${s.distanceKm.toFixed(1)} km</span>${s.brand?`<span>${escapeHtml(s.brand)}</span>`:''}${s.address?`<span>${escapeHtml(s.address)}</span>`:''}</div><a class="nav-btn" href="${googleNavUrl(s)}" target="_blank" rel="noopener">Navigiraj</a><div class="source-note">Vir: ${escapeHtml(s.source)}${age?` · posodobljeno ${escapeHtml(age)}`:''}</div></div><div class="price ${s.diesel==null?'missing':''}">${s.diesel!=null?`${escapeHtml(nativePrice)}${approx?`<div class="source-note">${escapeHtml(approx.trim())}</div>`:''}`:'Cena ni na voljo'}</div>`;
    els.stationList.appendChild(card);
  }
}

function escapeHtml(v){ return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

document.getElementById('settingsBtn').addEventListener('click',()=>els.settings.showModal());
document.getElementById('locateBtn').addEventListener('click',()=>locateUser(true));
els.refresh.addEventListener('click',()=>loadStations());
els.sort.addEventListener('change',()=>renderStations());
document.getElementById('saveSettingsBtn').addEventListener('click',e=>{
  e.preventDefault(); saveSettings(); els.settings.close();
  if(state.lat!=null){ setPosition(state.lat,state.lon); loadStations(); }
});

initMap(); updateLabels(); locateUser(true);
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
