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
  sheetState:0,autoTimer:null,programmaticUntil:0,isLoading:false,osmCache:new Map(),siCache:{time:0,rows:null}
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
  const key=`${Math.round(lat*20)/20}:${Math.round(lon*20)/20}:${state.radiusKm}`;
  const hit=state.osmCache.get(key);
  if(hit && Date.now()-hit.time<5*60*1000)return hit.rows;
  const q=`[out:json][timeout:5];nwr["amenity"="fuel"](around:${r},${lat},${lon});out center tags;`;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),4500);
  try{
    const rr=await fetch('https://overpass.kumi.systems/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:q}),signal:c.signal});
    if(!rr.ok)throw new Error('OSM '+rr.status);const j=await rr.json();
    const rows=(j.elements||[]).map(e=>{const la=e.lat??e.center?.lat,lo=e.lon??e.center?.lon,t=e.tags||{};if(la==null||lo==null)return null;return{id:'osm-'+e.id,name:t.name||t.brand||t.operator||'Bencinska črpalka',brand:t.brand||'',address:[t['addr:street'],t['addr:housenumber'],t['addr:city']].filter(Boolean).join(' '),lat:la,lon:lo,country:'',price:null,currency:'EUR',updated:null}}).filter(Boolean);
    state.osmCache.set(key,{time:Date.now(),rows});
    return rows;
  }finally{clearTimeout(t)}
}
function normText(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function words(v){return new Set(normText(v).split(/\s+/).filter(x=>x.length>1))}
function nameMatch(a,b){
  const A=words(`${a.name||''} ${a.brand||''}`),B=words(`${b.name||''} ${b.brand||''}`);
  if(!A.size||!B.size)return false;
  for(const w of A)if(B.has(w))return true;
  return false;
}
function ageHours(iso){if(!iso)return Infinity;const t=new Date(iso).getTime();return Number.isFinite(t)?Math.max(0,(Date.now()-t)/3600000):Infinity}
function applyConfidence(priced,osmRows){
  return priced.map(s=>{
    let nearest=null,nearestD=Infinity;
    for(const o of osmRows){const d=hkm(s.lat,s.lon,o.lat,o.lon);if(d<nearestD){nearestD=d;nearest=o}}
    const matched=nearest && (nearestD<=0.08 || (nearestD<=0.18 && nameMatch(s,nearest)));
    const fresh=ageHours(s.updated)<=36;
    const hasIdentity=Boolean((s.name&&s.name!=='Bencinska črpalka') || s.brand);
    let confidence='low';
    if(matched) confidence='verified';
    else if(fresh && hasIdentity && s.price!=null) confidence='likely';
    return {...s,confidence,osmDistanceKm:Number.isFinite(nearestD)?nearestD:null};
  }).filter(s=>s.confidence!=='low');
}

function areaTouchesSlovenia(priced=[]){
  const c=state.center||{};
  const centerInSI=Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&c.lat>=45.35&&c.lat<=47.05&&c.lon>=13.20&&c.lon<=16.75;
  return centerInSI || priced.some(s=>s.country==='SI');
}
async function fetchSloveniaOfficialMirror(){
  if(state.siCache.rows && Date.now()-state.siCache.time<10*60*1000)return state.siCache.rows;
  const base='https://raw.githubusercontent.com/stefanb/goriva-data/refs/heads/master/data/search_page_';
  const pages=Array.from({length:22},(_,i)=>i+1);
  const chunks=[];
  for(let i=0;i<pages.length;i+=6)chunks.push(pages.slice(i,i+6));
  let all=[];
  for(const group of chunks){
    const rs=await Promise.all(group.map(async page=>{
      const url=base+page+'.json';
      const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);
      try{
        const r=await fetch(url,{headers:{Accept:'application/json'},cache:'default',signal:c.signal});
        if(!r.ok)throw new Error('SI '+r.status);
        const j=await r.json();return j.results||[];
      }finally{clearTimeout(t)}
    }));
    rs.forEach(x=>all.push(...x));
  }
  state.siCache={time:Date.now(),rows:all};
  return all;
}
function sloveniaRowsInRadius(raw){
  const rows=[];
  for(const s of raw){
    const lat=Number(s.lat),lon=Number(s.lng),price=Number(s.prices?.dizel);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(price)||price<=0)continue;
    const distance=hkm(state.center.lat,state.center.lon,lat,lon);
    if(distance>state.radiusKm+.2)continue;
    rows.push({
      id:'si-'+s.pk,name:s.name||'Bencinska črpalka',brand:'',address:s.address||'',lat,lon,country:'SI',
      price,currency:'EUR',updated:null,distance,source:'goriva.si / goriva-data',confidence:'verified-official'
    });
  }
  return rows;
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
  if(!keepExisting&&!state.stations.length)els.stationList.innerHTML='<div class="loading">Iščem preverjene cene dizla …</div>';
  const start=performance.now();let priced=[],osmRows=[],err=null;
  try{priced=normalize(await fetchStationsFast())}catch(e){err=e;console.warn(e)}
  if(seq!==state.requestSeq){state.isLoading=false;return}
  try{osmRows=await fetchOsmQuick()}catch(e){console.warn('OSM preverjanje ni uspelo',e)}
  if(seq!==state.requestSeq){state.isLoading=false;return}

  let rows=[];
  let siUsed=false;
  // Slovenija: za lokacijo + ceno ne zaupamo agregatorju. Uporabimo dataset, ki je neposredno zrcalo goriva.si.
  if(areaTouchesSlovenia(priced)){
    try{
      const siRaw=await fetchSloveniaOfficialMirror();
      const siRows=sloveniaRowsInRadius(siRaw);
      if(siRows.length){
        siUsed=true;
        const nonSI=priced.filter(s=>s.country!=='SI');
        let other=nonSI.length?applyConfidence(nonSI,osmRows):[];
        if(!osmRows.length) other=nonSI.map(s=>({...s,confidence:(ageHours(s.updated)<=36&&((s.name&&s.name!=='Bencinska črpalka')||s.brand))?'likely':'low'})).filter(s=>s.confidence!=='low');
        rows=[...siRows,...other];
      }
    }catch(e){console.warn('Slovenski uradni mirror ni dosegljiv',e)}
  }
  if(!siUsed && priced.length){
    rows=applyConfidence(priced,osmRows);
    if(!osmRows.length) rows=priced.map(s=>({...s,confidence:(ageHours(s.updated)<=36&&((s.name&&s.name!=='Bencinska črpalka')||s.brand))?'likely':'low'})).filter(s=>s.confidence!=='low');
  }
  // OSM-only lokacij brez cene namenoma ne prikazujemo.
  if(rows.length||!keepExisting||!state.stations.length){state.stations=dedupe(rows);render()}
  const hidden=Math.max(0,priced.filter(s=>s.country!=='SI').length-state.stations.filter(s=>s.country!=='SI').length);
  const ms=Math.round(performance.now()-start),pc=state.stations.filter(s=>s.price!=null).length;
  els.updated.textContent='Posodobljeno pravkar';
  els.status.textContent=`${state.stations.length} preverjenih črpalk · ${pc} s ceno · ${ms} ms${siUsed?' · SI: goriva.si':''}${hidden?` · ${hidden} skritih`:''}${err?' · rezervni način':''}`;
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
    const m=L.marker([s.lat,s.lon],{icon:markerIcon(s)});
    m.on('click',()=>selectStationCard(s.id));
    state.markerLayer.addLayer(m);
    const age=timeAgo(s.updated),flag=EURO[s.country]||'',conf=(s.confidence==='verified'||s.confidence==='verified-official')?'✓ preverjeno':'● aktualen vir';
    const art=document.createElement('article');art.className='station-card';art.dataset.stationId=s.id;
    art.innerHTML=`<div class="station-top"><div class="brand-icon">${escapeHtml(brandLetters(s.name,s.brand))}</div><div class="station-main"><div class="station-name">${flag} ${escapeHtml(s.name)}</div><div class="station-address">${escapeHtml(s.address||s.brand||'')}</div></div></div><div class="station-price-row"><div class="price-block"><div class="price-line">Cena ${s.price!=null?`<strong>${escapeHtml(nativePrice(s))}</strong>`:'<strong style="color:#a0aaa7">—</strong>'}</div><div class="price-sub"><span class="confidence ${(s.confidence==='verified'||s.confidence==='verified-official')?'verified':'likely'}">${escapeHtml(conf)}</span>${age?` · ${escapeHtml(age)}`:''}</div></div><div class="right-actions"><div class="distance">${age?`<span class="fresh">✓ ${escapeHtml(age)}</span>`:''}→ ${s.distance.toFixed(1)} km</div><a class="nav-btn" href="${googleNav(s)}" target="_blank" rel="noopener">Navigiraj</a></div></div>`;
    els.stationList.appendChild(art);
  }
}


function selectStationCard(id){
  setSheetState(true);
  requestAnimationFrame(()=>{
    const card=els.stationList.querySelector(`[data-station-id="${CSS.escape(String(id))}"]`);
    if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function setSheetState(expanded){
  state.sheetState=expanded?1:0;
  state.sheet.style.height='';
  state.sheet.classList.toggle('sheet-half',expanded);
  state.sheet.classList.toggle('sheet-low',!expanded);
  els.sheetToggle.textContent=expanded?'Spusti ↓':'Povleci ↑';
}
function toggleSheet(){setSheetState(!state.sheetState)}
// Bottom sheet: tap na glavo je primarni, zanesljiv način. Vlečenje je dodatno samo na ročaju.
const handleWrap=els.dragZone.querySelector('.sheet-handle-wrap');
let touchDrag={active:false,startY:0,startH:0,moved:false};
function beginHandleDrag(y){
  touchDrag={active:true,startY:y,startH:state.sheet.getBoundingClientRect().height,moved:false};
  state.sheet.style.transition='none';
}
function moveHandleDrag(y){
  if(!touchDrag.active)return;
  const dy=touchDrag.startY-y;
  if(Math.abs(dy)>6)touchDrag.moved=true;
  const minH=Math.max(176,innerHeight*.22),maxH=innerHeight*.50;
  state.sheet.style.height=Math.max(minH,Math.min(maxH,touchDrag.startH+dy))+'px';
}
function endHandleDrag(){
  if(!touchDrag.active)return;
  const ratio=state.sheet.getBoundingClientRect().height/innerHeight;
  state.sheet.style.transition='';touchDrag.active=false;
  setSheetState(ratio>.32);
}
handleWrap.addEventListener('touchstart',e=>{if(e.touches.length===1)beginHandleDrag(e.touches[0].clientY)},{passive:true});
handleWrap.addEventListener('touchmove',e=>{if(touchDrag.active){moveHandleDrag(e.touches[0].clientY);e.preventDefault()}},{passive:false});
handleWrap.addEventListener('touchend',()=>endHandleDrag(),{passive:true});
handleWrap.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){beginHandleDrag(e.clientY);handleWrap.setPointerCapture?.(e.pointerId)}});
handleWrap.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&touchDrag.active)moveHandleDrag(e.clientY)});
handleWrap.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')endHandleDrag()});

// Tap anywhere in header (except direct button target is fine too) opens/closes.
els.sheetToggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleSheet()});
els.dragZone.addEventListener('click',e=>{
  if(e.target===els.sheetToggle)return;
  if(handleWrap.contains(e.target)&&touchDrag.moved){touchDrag.moved=false;return;}
  toggleSheet();
});

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
initMap();locate(true);
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
console.info("Manni Fuel UI 2.8.0 — clusters, auto-search, stable filters, draggable sheet");
