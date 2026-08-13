// Manni Fuel 3.8 — map popup beta. Europe/Pumperly core kept intact.
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
  stations:[],markerLayer:null,userMarker:null,
  autoTimer:null,programmaticUntil:0,requestSeq:0,controller:null
};
const $=id=>document.getElementById(id);
const els={
  best:$('bestPrice'),sort:$('sortSelect'),radius:$('radiusSelect'),fuel:$('fuelSelect'),
  api:$('apiBaseInput'),settings:$('settingsDialog'),refresh:$('refreshBtn'),locate:$('locateBtn')
};
const FLAG={AT:'🇦🇹',BE:'🇧🇪',BA:'🇧🇦',BG:'🇧🇬',CH:'🇨🇭',CZ:'🇨🇿',DE:'🇩🇪',DK:'🇩🇰',EE:'🇪🇪',ES:'🇪🇸',FI:'🇫🇮',FR:'🇫🇷',GB:'🇬🇧',GR:'🇬🇷',HR:'🇭🇷',HU:'🇭🇺',IE:'🇮🇪',IT:'🇮🇹',LT:'🇱🇹',LU:'🇱🇺',LV:'🇱🇻',MK:'🇲🇰',NL:'🇳🇱',NO:'🇳🇴',PL:'🇵🇱',PT:'🇵🇹',RO:'🇷🇴',RS:'🇷🇸',SE:'🇸🇪',SI:'🇸🇮',SK:'🇸🇰',TR:'🇹🇷',MD:'🇲🇩'};

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function km(a,b,c,d){const R=6371,p=Math.PI/180,da=(c-a)*p,dl=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function ago(iso){if(!iso)return'';const t=new Date(iso).getTime();if(!Number.isFinite(t))return'';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<2)return'pravkar';if(m<60)return`${m} min`;const h=Math.round(m/60);if(h<48)return`${h} h`;return`${Math.round(h/24)} d`}
function price(s){if(s.price==null)return null;const d=['HUF','RSD'].includes(s.currency)?1:3;return `${Number(s.price).toFixed(d)} ${s.currency||'EUR'}`}
function nav(s){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+','+s.lon)}&travelmode=driving`}

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

function locate(load=true){
  navigator.geolocation?.getCurrentPosition(p=>{
    const {latitude:lat,longitude:lon,accuracy}=p.coords;
    state.gps={lat,lon,accuracy};
    if(state.userMarker)state.map.removeLayer(state.userMarker);
    state.userMarker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(state.map).bindPopup('Tvoja lokacija');
    setSearchCenter(lat,lon,true);
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
    state.stations=dedupe(normalize(features));render();
  }catch(e){if(e.name==='AbortError')return;console.warn(e);if(seq!==state.requestSeq)return;state.stations=[];render()}
}
function markerIcon(s){const t=price(s)||'⛽';return L.divIcon({className:'',html:`<div class="price-marker">${esc(t)}</div>`,iconSize:[76,28],iconAnchor:[38,14]})}

async function getRoadDistance(s){
  if(!state.gps)return null;
  const u=`https://router.project-osrm.org/route/v1/driving/${state.gps.lon},${state.gps.lat};${s.lon},${s.lat}?overview=false&steps=false`;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),5000);
  try{const r=await fetch(u,{signal:ctl.signal});if(!r.ok)return null;const j=await r.json();const m=j?.routes?.[0]?.distance;return Number.isFinite(m)?m/1000:null}catch{return null}finally{clearTimeout(timer)}
}

function popupHtml(s,roadKm=null,loadingRoad=false){
  const a=ago(s.updated);
  const dist=roadKm!=null?`<strong>${roadKm.toFixed(1)} km po cesti</strong>`:(loadingRoad?'Računam cestno razdaljo …':`≈ ${s.distance.toFixed(1)} km zračno`);
  return `<div class="manni-popup"><div class="popup-title">${FLAG[s.country]||''} ${esc(s.name)}</div>${s.address?`<div class="popup-address">${esc(s.address)}</div>`:''}<div class="popup-price">${esc(price(s)||'Cena ni na voljo')}</div><div class="popup-distance">${dist}</div>${a?`<div class="popup-source">Vir: Pumperly · ${esc(a)}</div>`:'<div class="popup-source">Vir: Pumperly</div>'}<a class="popup-nav-btn" href="${nav(s)}" target="_blank" rel="noopener">Navigiraj</a></div>`;
}

function render(){
  state.markerLayer.clearLayers();
  const arr=[...state.stations];
  const priced=arr.filter(s=>s.price!=null);
  const best=priced.length?priced.reduce((a,b)=>a.price<=b.price?a:b):null;
  els.best.textContent=best?price(best):'—';
  arr.forEach(s=>{
    const m=L.marker([s.lat,s.lon],{icon:markerIcon(s)});
    m.bindPopup(popupHtml(s,null,!!state.gps),{closeButton:true,autoPan:true,maxWidth:280});
    m.on('click',async()=>{
      if(!state.gps)return;
      const roadKm=await getRoadDistance(s);
      if(m.isPopupOpen())m.setPopupContent(popupHtml(s,roadKm,false));
    });
    state.markerLayer.addLayer(m);
  });
}

$('settingsBtn').addEventListener('click',()=>{els.radius.value=state.radiusKm;els.fuel.value=state.fuel;els.api.value=state.apiBase;els.settings.showModal()});
$('saveSettingsBtn').addEventListener('click',e=>{e.preventDefault();state.radiusKm=Number(els.radius.value);state.fuel=els.fuel.value;state.apiBase=(els.api.value||'').trim().replace(/\/$/,'');localStorage.setItem('radiusKm',state.radiusKm);localStorage.setItem('fuel',state.fuel);localStorage.setItem('manniApiBase',state.apiBase);els.settings.close();if(state.center){setSearchCenter(state.center.lat,state.center.lon,true);loadStations()}});
els.refresh.addEventListener('click',()=>{locate(false);loadStations();window.dispatchEvent(new CustomEvent('manni:checkpoint-request'))});
els.locate.addEventListener('click',()=>locate(true));
els.sort.addEventListener('change',()=>{});
initMap();locate(true);
console.info('Manni Fuel 3.8 map popup beta — bottom list removed, no search marker');
