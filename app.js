// Manni's World welcome screen — full 5 seconds before map
window.addEventListener('DOMContentLoaded',()=>{
  const welcome=document.getElementById('welcomeScreen');
  if(!welcome)return;
  setTimeout(()=>welcome.classList.add('is-hidden'),5000);
  setTimeout(()=>welcome.remove(),5700);
});

const state={
  map:null,gps:null,center:null,
  radiusKm:Number(localStorage.getItem('radiusKm')||20),
  fuel:localStorage.getItem('fuel')||'B7',
  apiBase:(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,''),
  stations:[],markerLayer:null,userMarker:null,searchMarker:null,circle:null,
  searchMode:'gps',dataRoute:'',lastUpdated:null,requestSeq:0,
  sheetState:0,autoTimer:null,programmaticUntil:0,isLoading:false
};
const $=id=>document.getElementById(id);
const els={
  stationList:$('stationList'),status:$('statusBar'),updated:$('updatedText'),bestPrice:$('bestPrice'),
  sort:$('sortSelect'),sheet:$('sheet'),dragZone:$('sheetDragZone'),sheetToggle:$('sheetToggle'),
  radius:$('radiusSelect'),fuel:$('fuelSelect'),api:$('apiBaseInput'),settings:$('settingsDialog'),
  refresh:$('refreshBtn'),locate:$('locateBtn')
};
const EURO={AT:'🇦🇹',BE:'🇧🇪',BA:'🇧🇦',BG:'🇧🇬',CH:'🇨🇭',CZ:'🇨🇿',DE:'🇩🇪',DK:'🇩🇰',EE:'🇪🇪',ES:'🇪🇸',FI:'🇫🇮',FR:'🇫🇷',GB:'🇬🇧',GR:'🇬🇷',HR:'🇭🇷',HU:'🇭🇺',IE:'🇮🇪',IT:'🇮🇹',LT:'🇱🇹',LU:'🇱🇺',LV:'🇱🇻',MK:'🇲🇰',NL:'🇳🇱',NO:'🇳🇴',PL:'🇵🇱',PT:'🇵🇹',RO:'🇷🇴',RS:'🇷🇸',SE:'🇸🇪',SI:'🇸🇮',SK:'🇸🇰'};

function initMap(){
  state.map=L.map('map',{zoomControl:false,attributionControl:true}).setView([46.15,14.99],8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);
  state.markerLayer=L.markerClusterGroup({
    maxClusterRadius:58,
    disableClusteringAtZoom:14,
    spiderfyOnMaxZoom:true,
    showCoverageOnHover:false,
    zoomToBoundsOnClick:true,
    iconCreateFunction(cluster){
      return L.divIcon({className:'',html:`<div class="manni-cluster">${cluster.getChildCount()}</div>`,iconSize:[42,42],iconAnchor:[21,21]});
    }
  });
  state.map.addLayer(state.markerLayer);
  state.map.on('dragend',()=>scheduleAutoSearch());
  state.map.on('zoomend',()=>{if(Date.now()>state.programmaticUntil)scheduleAutoSearch()});
}
function scheduleAutoSearch(){
  if(!state.map||Date.now()<state.programmaticUntil)return;
  clearTimeout(state.autoTimer);
  state.autoTimer=setTimeout(()=>{
    const c=state.map.getCenter();
    setSearchCenter(c.lat,c.lng,'map',false);
    loadStations({keepExisting:true});
  },550);
}
function hkm(a,b,c,d){const R=6371,p=Math.PI/180,da=(c-a)*p,do_=(d-b)*p;const x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(do_/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function googleNav(s){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+','+s.lon)}&travelmode=driving`}
function timeAgo(iso){if(!iso)return'';const t=new Date(iso).getTime();if(!Number.isFinite(t))return'';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<2)return'just now';if(m<60)return`${m} min`;const h=Math.round(m/60);if(h<48)return`${h} h`;return`${Math.round(h/24)} d`}
function nativePrice(s){if(s.price==null)return null;const d=['HUF','RSD'].includes(s.currency)?1:3;return `${Number(s.price).toFixed(d)} ${s.currency||'EUR'}`}
function brandLetters(name,brand){const x=(brand||name||'FS').trim().split(/\s+/).filter(Boolean);return (x.length>1?x.slice(0,2).map(v=>v[0]).join(''):x[0]?.slice(0,2)||'FS').toUpperCase()}
function bbox(lat,lon,r){const dy=r/111.32,dx=r/Math.max(15,111.32*Math.cos(lat*Math.PI/180));return [lon-dx,lat-dy,lon+dx,lat+dy]}

function setSearchCenter(lat,lon,mode='gps',fit=false){
  state.center={lat,lon};state.searchMode=mode;
  if(state.circle)state.map.removeLayer(state.circle);
  state.circle=L.circle([lat,lon],{radius:state.radiusKm*1000,color:mode==='gps'?'#42d889':'#ffab3d',weight:1,fillOpacity:.04}).addTo(state.map);
  if(state.searchMarker){state.map.removeLayer(state.searchMarker);state.searchMarker=null}
  if(mode!=='gps'){
    const ic=L.divIcon({className:'',html:'<div class="search-dot"></div>',iconSize:[17,17],iconAnchor:[8,8]});
    state.searchMarker=L.marker([lat,lon],{icon:ic}).addTo(state.map);
  }
  if(fit){state.programmaticUntil=Date.now()+1200;state.map.fitBounds(state.circle.getBounds(),{padding:[26,26]})}
}
function setGps(lat,lon,acc){
  state.gps={lat,lon,acc};
  if(state.userMarker)state.map.removeLayer(state.userMarker);
  const ic=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  state.userMarker=L.marker([lat,lon],{icon:ic}).addTo(state.map).bindPopup('Tvoja lokacija');
  setSearchCenter(lat,lon,'gps',true);
}
function locate(load=true){
  els.status.textContent='Pridobivam tvojo lokacijo …';
  navigator.geolocation?.getCurrentPosition(async p=>{
    setGps(p.coords.latitude,p.coords.longitude,p.coords.accuracy);
    if(load)await loadStations({keepExisting:false});
  },()=>{els.status.textContent='Lokacije ni bilo mogoče pridobiti. Dovoli GPS v brskalniku.'},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}

async function fetchJson(url,timeout=4500){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'},signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}
}
async function fetchStationsFast(){
  const {lat,lon}=state.center;
  if(state.apiBase){
    const u=new URL(state.apiBase+'/stations');u.searchParams.set('lat',lat);u.searchParams.set('lon',lon);u.searchParams.set('radius',state.radiusKm);u.searchParams.set('fuel',state.fuel);
    const j=await fetchJson(u.toString(),4500);state.dataRoute=j.meta?.route||'Manni API';return j.features||j.data?.features||[];
  }
  const bb=bbox(lat,lon,state.radiusKm).map(n=>n.toFixed(6)).join(',');
  const j=await fetchJson(`https://pumperly.com/api/stations?bbox=${bb}&fuel=${encodeURIComponent(state.fuel)}`,4500);
  state.dataRoute='Pumperly direct';return j.features||[];
}
async function fetchOsmQuick(){
  const {lat,lon}=state.center,r=Math.round(state.radiusKm*1000);
  const q=`[out:json][timeout:5];nwr["amenity"="fuel"](around:${r},${lat},${lon});out center tags;`;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);
  try{
    const rr=await fetch('https://overpass.kumi.systems/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:q}),signal:c.signal});
    if(!rr.ok)throw new Error('OSM '+rr.status);const j=await rr.json();
    return (j.elements||[]).map(e=>{const la=e.lat??e.center?.lat,lo=e.lon??e.center?.lon,t=e.tags||{};if(la==null||lo==null)return null;return{id:'osm-'+e.id,name:t.name||t.brand||t.operator||'Bencinska črpalka',brand:t.brand||'',address:[t['addr:street'],t['addr:housenumber'],t['addr:city']].filter(Boolean).join(' '),lat:la,lon:lo,country:'',price:null,currency:'EUR',updated:null}}).filter(Boolean);
  }finally{clearTimeout(t)}
}
function normalize(features){
  const out=[];for(const f of features){const c=f.geometry?.coordinates,p=f.properties||{};if(!Array.isArray(c))continue;const lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const d=hkm(state.center.lat,state.center.lon,lat,lon);if(d>state.radiusKm+.2)continue;let price=p.price==null?null:Number(p.price);if(!Number.isFinite(price)||price<=0)price=null;out.push({id:String(p.id||p.externalId||`${lat}-${lon}`),name:p.name||p.brand||'Bencinska črpalka',brand:p.brand||'',address:[p.address,p.city].filter(Boolean).join(', '),lat,lon,country:p.country||'',price,currency:p.currency||'EUR',updated:p.reportedAt||null,distance:d,source:'Pumperly'})}return out
}
function normalizeOsm(rows){return rows.map(s=>({...s,distance:hkm(state.center.lat,state.center.lon,s.lat,s.lon),source:'OpenStreetMap'})).filter(s=>s.distance<=state.radiusKm+.2)}
function dedupe(rows){const a=[...rows].sort((x,y)=>(x.price==null)-(y.price==null)),o=[];for(const s of a){if(!o.some(x=>hkm(s.lat,s.lon,x.lat,x.lon)<.07))o.push(s)}return o}

async function loadStations({keepExisting=true}={}){
  if(!state.center||state.isLoading)return;
  const seq=++state.requestSeq;state.isLoading=true;
  els.status.textContent='Posodabljam cene …';els.updated.textContent='Posodabljam …';
  if(!keepExisting&&!state.stations.length)els.stationList.innerHTML='<div class="loading">Iščem najbližje cene dizla …</div>';
  const start=performance.now();let priced=[],err=null;
  try{priced=normalize(await fetchStationsFast())}catch(e){err=e;console.warn(e)}
  if(seq!==state.requestSeq){state.isLoading=false;return}
  let rows=priced;
  if(!rows.length){try{rows=normalizeOsm(await fetchOsmQuick())}catch(e){console.warn(e)}}
  if(seq!==state.requestSeq){state.isLoading=false;return}
  // Če je bila poizvedba neuspešna, ne briši že prikazanih rezultatov zaradi menijev ali kratke omrežne napake.
  if(rows.length||!keepExisting||!state.stations.length){state.stations=dedupe(rows);render()}
  const ms=Math.round(performance.now()-start),pc=state.stations.filter(s=>s.price!=null).length;
  els.updated.textContent='Posodobljeno pravkar';
  els.status.textContent=`${state.stations.length} črpalk · ${pc} s ceno · ${ms} ms${err?' · rezervni način':''}`;
  state.isLoading=false;
}

function markerIcon(s){const txt=s.price!=null?nativePrice(s):'⛽';return L.divIcon({className:'',html:`<div class="price-marker">${escapeHtml(txt)}</div>`,iconSize:[76,28],iconAnchor:[38,14]})}
function render(){
  if(state.markerLayer)state.markerLayer.clearLayers();
  const arr=[...state.stations].sort((a,b)=>els.sort.value==='distance'?a.distance-b.distance:(a.price==null)-(b.price==null)||(a.price??9999)-(b.price??9999)||a.distance-b.distance);
  const bp=arr.find(s=>s.price!=null);els.bestPrice.textContent=bp?nativePrice(bp):'—';
  if(!arr.length){els.stationList.innerHTML='<div class="empty">Na tem območju ni bilo rezultatov. Premakni zemljevid ali povečaj radij.</div>';return}
  els.stationList.innerHTML='';
  for(const s of arr){
    const m=L.marker([s.lat,s.lon],{icon:markerIcon(s)}).bindPopup(`<b>${escapeHtml(s.name)}</b><br>${s.distance.toFixed(1)} km<br>${escapeHtml(nativePrice(s)||'Cena ni na voljo')}`);
    state.markerLayer.addLayer(m);
    const age=timeAgo(s.updated),flag=EURO[s.country]||'';
    const art=document.createElement('article');art.className='station-card';
    art.innerHTML=`<div class="station-top"><div class="brand-icon">${escapeHtml(brandLetters(s.name,s.brand))}</div><div class="station-main"><div class="station-name">${flag} ${escapeHtml(s.name)}</div><div class="station-address">${escapeHtml(s.address||s.brand||'')}</div></div></div><div class="station-price-row"><div class="price-block"><div class="price-line">Cena ${s.price!=null?`<strong>${escapeHtml(nativePrice(s))}</strong>`:'<strong style="color:#a0aaa7">—</strong>'}</div><div class="price-sub">${age?`Posodobljeno ${escapeHtml(age)}`:`Vir: ${escapeHtml(s.source)}`}</div></div><div class="right-actions"><div class="distance">${age?`<span class="fresh">✓ ${escapeHtml(age)}</span>`:''}→ ${s.distance.toFixed(1)} km</div><a class="nav-btn" href="${googleNav(s)}" target="_blank" rel="noopener">Navigiraj</a></div></div>`;
    els.stationList.appendChild(art);
  }
}

function setSheetState(expanded){
  state.sheetState=expanded?1:0;
  state.sheet.style.height='';
  state.sheet.classList.toggle('sheet-half',expanded);
  state.sheet.classList.toggle('sheet-low',!expanded);
  els.sheetToggle.textContent=expanded?'Spusti ↓':'Povleci ↑';
}
function toggleSheet(){setSheetState(!state.sheetState)}
let drag={active:false,startY:0,startH:0,pointerId:null};
function pointerDown(e){
  drag.active=true;drag.startY=e.clientY;drag.startH=state.sheet.getBoundingClientRect().height;drag.pointerId=e.pointerId;
  els.dragZone.classList.add('dragging');state.sheet.style.transition='none';
  try{els.dragZone.setPointerCapture(e.pointerId)}catch(_){ }
  e.preventDefault();
}
function pointerMove(e){
  if(!drag.active||e.pointerId!==drag.pointerId)return;
  const dy=drag.startY-e.clientY;
  const minH=Math.max(176,innerHeight*.22),maxH=innerHeight*.50;
  state.sheet.style.height=Math.max(minH,Math.min(maxH,drag.startH+dy))+'px';
  e.preventDefault();
}
function pointerUp(e){
  if(!drag.active)return;
  const ratio=state.sheet.getBoundingClientRect().height/innerHeight;
  drag.active=false;els.dragZone.classList.remove('dragging');state.sheet.style.transition='';
  setSheetState(ratio>.34);
  try{els.dragZone.releasePointerCapture(drag.pointerId)}catch(_){ }
  drag.pointerId=null;
}

$('settingsBtn').addEventListener('click',()=>{
  els.radius.value=state.radiusKm;els.fuel.value=state.fuel;els.api.value=state.apiBase;els.settings.showModal();
});
$('saveSettingsBtn').addEventListener('click',e=>{
  e.preventDefault();
  const oldRadius=state.radiusKm,oldFuel=state.fuel,oldApi=state.apiBase;
  state.radiusKm=Number(els.radius.value);state.fuel=els.fuel.value;state.apiBase=(els.api.value||'').trim().replace(/\/$/,'');
  localStorage.setItem('radiusKm',state.radiusKm);localStorage.setItem('fuel',state.fuel);localStorage.setItem('manniApiBase',state.apiBase);
  els.settings.close();
  if(state.center&&(oldRadius!==state.radiusKm||oldFuel!==state.fuel||oldApi!==state.apiBase)){
    setSearchCenter(state.center.lat,state.center.lon,state.searchMode,true);loadStations({keepExisting:true});
  }
});
els.refresh.addEventListener('click',()=>loadStations({keepExisting:true}));
els.locate.addEventListener('click',()=>locate(true));
els.sort.addEventListener('change',()=>render());
els.sheetToggle.addEventListener('click',e=>{e.stopPropagation();toggleSheet()});
els.dragZone.addEventListener('pointerdown',pointerDown);
els.dragZone.addEventListener('pointermove',pointerMove);
els.dragZone.addEventListener('pointerup',pointerUp);
els.dragZone.addEventListener('pointercancel',pointerUp);
els.dragZone.addEventListener('dblclick',toggleSheet);

initMap();locate(true);
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
console.info("Manni Fuel UI 2.6.0 — clusters, auto-search, stable filters, draggable sheet");
