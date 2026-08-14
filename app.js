// Manni Fuel 3.16 — stable map + verified smart recommendation.
window.addEventListener('DOMContentLoaded',()=>{
  const w=document.getElementById('welcomeScreen');
  if(!w)return;
  const close=()=>{w.classList.add('is-hidden');setTimeout(()=>w.remove(),650)};
  w.addEventListener('click',close,{once:true});
  setTimeout(close,5000);
});

const state={
  map:null,gps:null,center:null,
  radiusKm:Number(localStorage.getItem('radiusKm')||20),
  fuel:localStorage.getItem('fuel')||'B7',
  apiBase:(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,''),
  stations:[],rawStations:[],hiddenPriceStations:[],fx:{EUR:1},markerLayer:null,userMarker:null,stationMarkers:new Map(),hoursCache:new Map(),
  autoTimer:null,programmaticUntil:0,requestSeq:0,controller:null
};
const $=id=>document.getElementById(id);
const els={
  radius:$('radiusSelect'),fuel:$('fuelSelect'),
  api:$('apiBaseInput'),settings:$('settingsDialog'),refresh:$('refreshBtn'),locate:$('locateBtn')
};
const FLAG={AT:'🇦🇹',BE:'🇧🇪',BA:'🇧🇦',BG:'🇧🇬',CH:'🇨🇭',CZ:'🇨🇿',DE:'🇩🇪',DK:'🇩🇰',EE:'🇪🇪',ES:'🇪🇸',FI:'🇫🇮',FR:'🇫🇷',GB:'🇬🇧',GR:'🇬🇷',HR:'🇭🇷',HU:'🇭🇺',IE:'🇮🇪',IT:'🇮🇹',LT:'🇱🇹',LU:'🇱🇺',LV:'🇱🇻',MK:'🇲🇰',NL:'🇳🇱',NO:'🇳🇴',PL:'🇵🇱',PT:'🇵🇹',RO:'🇷🇴',RS:'🇷🇸',SE:'🇸🇪',SI:'🇸🇮',SK:'🇸🇰',TR:'🇹🇷',MD:'🇲🇩'};

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function km(a,b,c,d){const R=6371,p=Math.PI/180,da=(c-a)*p,dl=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function ago(iso){if(!iso)return'';const t=new Date(iso).getTime();if(!Number.isFinite(t))return'';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<2)return'pravkar';if(m<60)return`${m} min`;const h=Math.round(m/60);if(h<48)return`${h} h`;return`${Math.round(h/24)} d`}
function slNum(v,d=2){return new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v))}
function price(s){if(s.price==null)return null;const native=`${slNum(s.price,2)} ${s.currency==='EUR'?'€/l':(s.currency||'EUR')+'/l'}`;if(s.currency!=='EUR'&&Number.isFinite(s.priceEur))return `${native} · ≈ ${slNum(s.priceEur,2)} €/l`;return native}
function markerPrice(s){if(s.price==null)return null;return `${slNum(s.price,2)} ${s.currency==='EUR'?'€':(s.currency||'EUR')}`}
function nav(s){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+','+s.lon)}&travelmode=driving`}

function normText(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function nameScore(a,b){
  const A=new Set(normText(a).split(/\s+/).filter(x=>x.length>1)),B=new Set(normText(b).split(/\s+/).filter(x=>x.length>1));
  if(!A.size||!B.size)return 0;
  let hit=0;A.forEach(x=>{if(B.has(x))hit++});return hit/Math.max(A.size,B.size)
}
function fmtTime(d){return d.toLocaleTimeString((window.ManniI18n?.locale?.()||'sl-SI'),{hour:'2-digit',minute:'2-digit'})}
const DAY={Su:0,Mo:1,Tu:2,We:3,Th:4,Fr:5,Sa:6};
function daySet(spec){
  const out=new Set();
  for(const part of spec.split(',')){
    const t=part.trim(); if(!t)continue;
    const m=t.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/); if(!m)continue;
    const a=DAY[m[1]],b=m[2]?DAY[m[2]]:a; let d=a; out.add(d); while(d!==b){d=(d+1)%7;out.add(d)}
  }
  return out;
}
function minutes(hm){const m=hm.match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function evaluateOpeningHours(raw,now=new Date()){
  if(!raw)return {known:false,label:'Odpiralni čas ni znan'};
  const v=raw.trim();
  if(/^24\/7$/i.test(v))return {known:true,open:true,label:'Odprto 24/7'};
  // Conservative parser for common OSM weekly forms. Complex/holiday rules are shown as unknown, never guessed.
  if(/PH|SH|sunrise|sunset|week|\+|"|unknown|off\s*$/i.test(v) && !/^(?:Mo|Tu|We|Th|Fr|Sa|Su)/.test(v))return {known:false,label:'Odpiralni čas: '+v};
  const rules=[];
  for(const rawRule of v.split(';')){
    const rule=rawRule.trim(); if(!rule)continue;
    let m=rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*))\s+(off|closed)$/i);
    if(m){rules.push({days:daySet(m[1]),closed:true});continue}
    m=rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*))\s+(.+)$/);
    let days,times;
    if(m){days=daySet(m[1]);times=m[2]}else if(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\d{1,2}:\d{2}-\d{1,2}:\d{2})*$/.test(rule)){days=new Set([0,1,2,3,4,5,6]);times=rule}else continue;
    const spans=[];
    for(const sp of times.split(',')){const x=sp.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);if(x){const a=minutes(x[1]),b=minutes(x[2]);if(a!=null&&b!=null)spans.push([a,b])}}
    if(spans.length)rules.push({days,spans});
  }
  if(!rules.length)return {known:false,label:'Odpiralni čas: '+v};
  const day=now.getDay(),cur=now.getHours()*60+now.getMinutes();
  for(const r of rules){
    if(!r.days.has(day)||r.closed)continue;
    for(const [a,b] of r.spans){
      if(a<=b && cur>=a && cur<b){const close=new Date(now);close.setHours(Math.floor(b/60),b%60,0,0);return {known:true,open:true,label:'Odprto do '+fmtTime(close)} }
      if(a>b && (cur>=a||cur<b)){const close=new Date(now);if(cur>=a)close.setDate(close.getDate()+1);close.setHours(Math.floor(b/60),b%60,0,0);return {known:true,open:true,label:'Odprto do '+fmtTime(close)} }
    }
  }
  // Find the next opening within 8 days.
  for(let add=0;add<8;add++){
    const d=new Date(now);d.setDate(now.getDate()+add);const wd=d.getDay();
    for(const r of rules){if(!r.days.has(wd)||r.closed||!r.spans)continue;for(const [a] of r.spans){const cand=new Date(d);cand.setHours(Math.floor(a/60),a%60,0,0);if(cand>now){const dayText=add===0?'danes':add===1?'jutri':cand.toLocaleDateString((window.ManniI18n?.locale?.()||'sl-SI'),{weekday:'short'});return {known:true,open:false,label:'Zaprto · odpre '+dayText+' ob '+fmtTime(cand)}}}}
  }
  return {known:true,open:false,label:'Zaprto'};
}
async function getOpeningInfo(s){
  const cached=state.hoursCache.get(s.id);if(cached&&Date.now()-cached.at<15*60*1000)return cached.value;
  const q=`[out:json][timeout:8];(node(around:350,${s.lat},${s.lon})[amenity=fuel];way(around:350,${s.lat},${s.lon})[amenity=fuel];relation(around:350,${s.lat},${s.lon})[amenity=fuel];);out center tags;`;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),7000);
  try{
    const r=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{signal:ctl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw 0;
    const j=await r.json();const cand=[];
    for(const e of j.elements||[]){const lat=Number(e.lat??e.center?.lat),lon=Number(e.lon??e.center?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const tags=e.tags||{};const d=km(s.lat,s.lon,lat,lon);const score=Math.max(nameScore(s.name,tags.name),nameScore(s.brand,tags.brand),nameScore(s.name,tags.brand));cand.push({tags,d,score})}
    cand.sort((a,b)=>(b.score-a.score)||(a.d-b.d));
    let hit=cand.find(x=>x.score>=.34&&x.d<=.35)||cand.find(x=>x.d<=.08);
    const raw=hit?.tags?.opening_hours||'';
    const value=raw?{...evaluateOpeningHours(raw),raw,matched:true}:{known:false,label:'Odpiralni čas ni znan',matched:!!hit};
    state.hoursCache.set(s.id,{at:Date.now(),value});return value;
  }catch{return {known:false,label:'Odpiralni čas ni znan'}}finally{clearTimeout(timer)}
}

function initMap(){
  state.map=L.map('map',{zoomControl:false,attributionControl:true}).setView([46.15,14.99],8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);
  state.markerLayer=L.markerClusterGroup({maxClusterRadius:58,disableClusteringAtZoom:14,showCoverageOnHover:false,spiderfyOnMaxZoom:true,iconCreateFunction(c){return L.divIcon({className:'',html:`<div class="manni-cluster">${c.getChildCount()}</div>`,iconSize:[42,42],iconAnchor:[21,21]})}});
  state.map.addLayer(state.markerLayer);
  state.map.on('dragend zoomend',()=>{
    if(Date.now()<state.programmaticUntil)return;
    clearTimeout(state.autoTimer);
    state.autoTimer=setTimeout(()=>{const c=state.map.getCenter();setSearchCenter(c.lat,c.lng,false);loadStations();},600);
  });
}

// Search centre is an internal coordinate only. It has NO visible marker or orange circle.
function setSearchCenter(lat,lon,fit=false){
  state.center={lat,lon};
  if(fit){
    state.programmaticUntil=Date.now()+1200;
    const bounds=L.latLng(lat,lon).toBounds(state.radiusKm*2000);
    state.map.fitBounds(bounds,{padding:[26,26]});
  }
}

function locate({load=true,recenter=false,startup=false}={}){
  navigator.geolocation?.getCurrentPosition(p=>{
    const {latitude:lat,longitude:lon,accuracy}=p.coords;
    state.gps={lat,lon,accuracy};
    if(state.userMarker)state.map.removeLayer(state.userMarker);
    state.userMarker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(state.map).bindPopup('Tvoja lokacija');

    // Startup and the dedicated location button may move the map.
    // Refresh must NEVER change the user's current centre or zoom.
    if(startup || recenter){
      state.programmaticUntil=Date.now()+1200;
      state.map.setView([lat,lon],14,{animate:!startup});
      setSearchCenter(lat,lon,false);
    }
    if(load)loadStations();
  },()=>{}, {enableHighAccuracy:true,timeout:10000,maximumAge:30000});
}

async function fetchStations(){
  if(!state.center)return [];
  if(state.controller)state.controller.abort();
  state.controller=new AbortController();
  const u=new URL(state.apiBase+'/stations');
  u.searchParams.set('lat',state.center.lat);u.searchParams.set('lon',state.center.lon);u.searchParams.set('radius',state.radiusKm);u.searchParams.set('fuel',state.fuel);
  const timer=setTimeout(()=>state.controller.abort(),7000);
  try{const r=await fetch(u,{cache:'no-store',headers:{Accept:'application/json'},signal:state.controller.signal});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();return j.features||j.data?.features||[]}
  finally{clearTimeout(timer)}
}

function normalize(features){
  const out=[];
  for(const f of features){
    const c=f.geometry?.coordinates,p=f.properties||{};if(!Array.isArray(c)||c.length<2)continue;
    const lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const searchDistance=km(state.center.lat,state.center.lon,lat,lon);if(searchDistance>state.radiusKm+.3)continue;
    const origin=state.gps||state.center;
    const distance=km(origin.lat,origin.lon,lat,lon);
    let pr=p.price==null?null:Number(p.price);if(!Number.isFinite(pr)||pr<=0)pr=null;
    out.push({id:String(p.id||p.externalId||`${lat}-${lon}`),name:p.name||p.brand||'Bencinska črpalka',brand:p.brand||'',address:[p.address,p.city].filter(Boolean).join(', '),lat,lon,country:String(p.country||'').toUpperCase(),price:pr,currency:p.currency||'EUR',updated:p.reportedAt||p.updatedAt||null,distance,searchDistance,source:'Pumperly'});
  }
  return out;
}
function dedupe(rows){const sorted=[...rows].sort((a,b)=>(a.price==null)-(b.price==null)),out=[];for(const s of sorted){if(!out.some(x=>km(s.lat,s.lon,x.lat,x.lon)<.04))out.push(s)}return out}

async function loadStations(){
  if(!state.center)return;
  const seq=++state.requestSeq;
  try{
    const features=await fetchStations();if(seq!==state.requestSeq)return;
    const rows=dedupe(normalize(features));state.rawStations=rows;
    if(window.ManniPriceSanity){
      const sanity=await window.ManniPriceSanity.sanitizeForMap(rows);if(seq!==state.requestSeq)return;
      state.fx=sanity.fx||{EUR:1};state.hiddenPriceStations=sanity.hidden||[];state.stations=sanity.visible||rows;
      // Preserve normalized EUR values returned by the sanity layer.
    }else{state.stations=rows;state.hiddenPriceStations=[]}
    render();
  }catch(e){if(e.name==='AbortError')return;console.warn(e);if(seq!==state.requestSeq)return;state.stations=[];state.hiddenPriceStations=[];render()}
}
function markerIcon(s){const t=markerPrice(s)||'⛽';return L.divIcon({className:'',html:`<div class="price-marker">${esc(t)}</div>`,iconSize:[76,28],iconAnchor:[38,14]})}

async function getRoadDistance(s){
  if(!state.gps)return null;
  const u=`https://router.project-osrm.org/route/v1/driving/${state.gps.lon},${state.gps.lat};${s.lon},${s.lat}?overview=false&steps=false`;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),5000);
  try{const r=await fetch(u,{signal:ctl.signal});if(!r.ok)return null;const j=await r.json();const m=j?.routes?.[0]?.distance;return Number.isFinite(m)?m/1000:null}catch{return null}finally{clearTimeout(timer)}
}

function popupHtml(s,roadKm=null,loadingRoad=false,hours=null,loadingHours=false){
  const a=ago(s.updated);
  const dist=roadKm!=null?`<strong>${slNum(roadKm,1)} km po cesti</strong>`:(loadingRoad?'Računam cestno razdaljo …':`≈ ${slNum(s.distance,1)} km zračno`);
  let hoursHtml='';
  if(loadingHours)hoursHtml='<div class="popup-hours unknown"><span>⚪</span> Preverjam odpiralni čas …</div>';
  else if(hours){const cls=hours.known?(hours.open?'open':'closed'):'unknown',dot=hours.known?(hours.open?'🟢':'🔴'):'⚪';hoursHtml=`<div class="popup-hours ${cls}"><span>${dot}</span> ${esc(hours.label)}</div>`}
  return `<div class="manni-popup"><div class="popup-title">${FLAG[s.country]||''} ${esc(s.name)}</div>${s.address?`<div class="popup-address">${esc(s.address)}</div>`:''}<div class="popup-price">${esc(price(s)||'Cena ni na voljo')}</div><div class="popup-distance">${dist}</div>${hoursHtml}${a?`<div class="popup-source">Vir cene: Pumperly · ${esc(a)}</div>`:'<div class="popup-source">Vir cene: Pumperly</div>'}${hours?.matched?'<div class="popup-source">Odpiralni čas: OpenStreetMap</div>':''}<a class="popup-nav-btn" href="${nav(s)}" target="_blank" rel="noopener">Navigiraj</a></div>`;
}

function render(){
  state.markerLayer.clearLayers();state.stationMarkers.clear();
  const arr=[...state.stations];
  arr.forEach(s=>{
    const m=L.marker([s.lat,s.lon],{icon:markerIcon(s)});
    m.bindPopup(popupHtml(s,null,!!state.gps,null,true),{closeButton:true,autoPan:true,maxWidth:290});
    m.on('click',async()=>{
      m.setPopupContent(popupHtml(s,null,!!state.gps,null,true));
      const [roadKm,hours]=await Promise.all([getRoadDistance(s),getOpeningInfo(s)]);
      if(m.isPopupOpen())m.setPopupContent(popupHtml(s,roadKm,false,hours,false));
    });
    state.stationMarkers.set(s.id,m);state.markerLayer.addLayer(m);
  });
}
async function focusStation(s){
  if(!s)return;
  state.programmaticUntil=Date.now()+1200;
  state.map.setView([s.lat,s.lon],Math.max(state.map.getZoom(),14),{animate:true});
  const m=state.stationMarkers.get(s.id);if(!m)return;
  setTimeout(()=>{m.openPopup();m.fire('click')},350);
}
async function applyStationAction(mode){
  if(!state.stations.length)return;
  if(mode==='price'){
    const priced=state.stations.filter(s=>s.price!=null&&Number.isFinite(s.priceEur));if(!priced.length)return;
    const min=Math.min(...priced.map(s=>s.priceEur));const tied=priced.filter(s=>Math.abs(s.priceEur-min)<1e-9).sort((a,b)=>a.distance-b.distance);
    await focusStation(tied[0]);return;
  }
  if(mode==='distance'){
    const base=[...state.stations].sort((a,b)=>a.distance-b.distance).slice(0,Math.min(5,state.stations.length));
    if(!state.gps){await focusStation(base[0]);return}
    const tested=await Promise.all(base.map(async s=>({s,road:await getRoadDistance(s)})));
    tested.sort((a,b)=>(a.road??Infinity)-(b.road??Infinity));
    await focusStation(tested[0]?.road!=null?tested[0].s:base[0]);
  }
}

$('settingsBtn').addEventListener('click',()=>{els.radius.value=state.radiusKm;els.fuel.value=state.fuel;els.api.value=state.apiBase;els.settings.showModal()});
$('saveSettingsBtn').addEventListener('click',e=>{e.preventDefault();state.radiusKm=Number(els.radius.value);state.fuel=els.fuel.value;state.apiBase=(els.api.value||'').trim().replace(/\/$/,'');localStorage.setItem('radiusKm',state.radiusKm);localStorage.setItem('fuel',state.fuel);localStorage.setItem('manniApiBase',state.apiBase);els.settings.close();if(state.center){loadStations()}});
els.refresh.addEventListener('click',()=>{
  // Keep the exact map position/zoom. Update GPS marker and data only.
  locate({load:false,recenter:false});
  loadStations();
  window.dispatchEvent(new CustomEvent('manni:checkpoint-request'));
});
els.locate.addEventListener('click',()=>locate({load:true,recenter:true}));
initMap();locate({load:true,startup:true});
console.info('Manni Fuel 3.36 — cleaner map controls');

// 3.31: recommendation focus — direct, immediate popup without reloading the station area.
window.addEventListener('manni:show-station',async e=>{
  const s=e.detail;
  if(!s||!Number.isFinite(Number(s.lat))||!Number.isFinite(Number(s.lon)))return;
  const lat=Number(s.lat),lon=Number(s.lon);

  // Stop any pending map animation and suppress automatic area reload while focusing.
  state.programmaticUntil=Date.now()+1800;
  clearTimeout(state.autoTimer);
  try{state.map.stop()}catch{}
  state.map.invalidateSize();

  // Jump immediately. Do NOT change search centre here: the purpose is to inspect one recommendation,
  // not to trigger a fresh search and redraw all map stations.
  state.map.setView([lat,lon],17,{animate:false});

  if(state.recommendationFocusMarker){
    try{state.map.removeLayer(state.recommendationFocusMarker)}catch{}
    state.recommendationFocusMarker=null;
  }
  if(state.recommendationFocusPopup){
    try{state.map.closePopup(state.recommendationFocusPopup)}catch{}
    state.recommendationFocusPopup=null;
  }

  const temp=Object.assign({},s,{lat,lon,distance:state.gps?km(state.gps.lat,state.gps.lon,lat,lon):null});
  const icon=L.divIcon({className:'',html:`<div class="price-marker recommendation-focus">${esc(markerPrice(temp)||'⛽')}</div>`,iconSize:[96,38],iconAnchor:[48,19]});
  state.recommendationFocusMarker=L.marker([lat,lon],{icon,zIndexOffset:3000}).addTo(state.map);

  // Open a standalone popup immediately. This does not depend on marker-cluster rendering.
  const pop=L.popup({closeButton:true,autoPan:true,maxWidth:310,autoPanPadding:[28,28],offset:[0,-18]})
    .setLatLng([lat,lon])
    .setContent(popupHtml(temp,null,!!state.gps,null,true))
    .openOn(state.map);
  state.recommendationFocusPopup=pop;

  // Enrich after it is already visible. Network delays can no longer prevent the popup from opening.
  try{
    const [roadKm,hours]=await Promise.all([getRoadDistance(temp),getOpeningInfo(temp)]);
    if(state.recommendationFocusPopup===pop){
      pop.setContent(popupHtml(temp,roadKm,false,hours,false));
      pop.update();
    }
  }catch{
    if(state.recommendationFocusPopup===pop){
      pop.setContent(popupHtml(temp,null,false,{known:false,label:'Odpiralni čas ni znan'},false));
      pop.update();
    }
  }
});

// 3.39 — standalone/PWA cache hygiene. No UI or algorithm changes.
(async function manniPwaCacheHygiene(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches?.keys){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(e){ console.warn('Manni cache cleanup skipped', e); }
})();
