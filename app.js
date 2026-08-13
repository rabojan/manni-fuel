// Manni Fuel 3.1 — stable Europe core
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
  stations:[],markerLayer:null,userMarker:null,circle:null,
  autoTimer:null,programmaticUntil:0,requestSeq:0,controller:null,sheetOpen:false
};
const $=id=>document.getElementById(id);
const els={
  list:$('stationList'),status:$('statusBar'),updated:$('updatedText'),best:$('bestPrice'),sort:$('sortSelect'),
  sheet:$('sheet'),toggle:$('sheetToggle'),handle:$('sheetDragZone'),radius:$('radiusSelect'),fuel:$('fuelSelect'),
  api:$('apiBaseInput'),settings:$('settingsDialog'),refresh:$('refreshBtn'),locate:$('locateBtn')
};
const FLAG={AT:'🇦🇹',BE:'🇧🇪',BA:'🇧🇦',BG:'🇧🇬',CH:'🇨🇭',CZ:'🇨🇿',DE:'🇩🇪',DK:'🇩🇰',EE:'🇪🇪',ES:'🇪🇸',FI:'🇫🇮',FR:'🇫🇷',GB:'🇬🇧',GR:'🇬🇷',HR:'🇭🇷',HU:'🇭🇺',IE:'🇮🇪',IT:'🇮🇹',LT:'🇱🇹',LU:'🇱🇺',LV:'🇱🇻',MK:'🇲🇰',NL:'🇳🇱',NO:'🇳🇴',PL:'🇵🇱',PT:'🇵🇹',RO:'🇷🇴',RS:'🇷🇸',SE:'🇸🇪',SI:'🇸🇮',SK:'🇸🇰',TR:'🇹🇷',MD:'🇲🇩'};

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function km(a,b,c,d){const R=6371,p=Math.PI/180,da=(c-a)*p,dl=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function ago(iso){if(!iso)return'';const t=new Date(iso).getTime();if(!Number.isFinite(t))return'';const m=Math.max(0,Math.round((Date.now()-t)/60000));if(m<2)return'pravkar';if(m<60)return`${m} min`;const h=Math.round(m/60);if(h<48)return`${h} h`;return`${Math.round(h/24)} d`}
function price(s){if(s.price==null)return null;const d=['HUF','RSD'].includes(s.currency)?1:3;return `${Number(s.price).toFixed(d)} ${s.currency||'EUR'}`}
function nav(s){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+','+s.lon)}&travelmode=driving`}
function letters(s){const x=(s.brand||s.name||'FS').trim().split(/\s+/).filter(Boolean);return (x.length>1?x.slice(0,2).map(v=>v[0]).join(''):(x[0]||'FS').slice(0,2)).toUpperCase()}

function initMap(){
  state.map=L.map('map',{zoomControl:false,attributionControl:true}).setView([46.15,14.99],8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);
  state.markerLayer=L.markerClusterGroup({maxClusterRadius:58,disableClusteringAtZoom:14,showCoverageOnHover:false,spiderfyOnMaxZoom:true,iconCreateFunction(c){return L.divIcon({className:'',html:`<div class="manni-cluster">${c.getChildCount()}</div>`,iconSize:[42,42],iconAnchor:[21,21]})}});
  state.map.addLayer(state.markerLayer);
  state.map.on('dragend zoomend',()=>{
    if(Date.now()<state.programmaticUntil)return;
    clearTimeout(state.autoTimer);
    state.autoTimer=setTimeout(()=>{const c=state.map.getCenter();setCenter(c.lat,c.lng,'map',false);loadStations();},600);
  });
}
function setCenter(lat,lon,mode='gps',fit=false){
  state.center={lat,lon};
  if(state.circle)state.map.removeLayer(state.circle);
  state.circle=L.circle([lat,lon],{radius:state.radiusKm*1000,color:mode==='gps'?'#42d889':'#ffab3d',weight:1,fillOpacity:.04}).addTo(state.map);
  if(fit){state.programmaticUntil=Date.now()+1200;state.map.fitBounds(state.circle.getBounds(),{padding:[26,26]})}
}
function locate(load=true){
  els.status.textContent='Pridobivam tvojo lokacijo …';
  navigator.geolocation?.getCurrentPosition(p=>{
    const {latitude:lat,longitude:lon,accuracy}=p.coords;state.gps={lat,lon,accuracy};
    if(state.userMarker)state.map.removeLayer(state.userMarker);
    state.userMarker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(state.map).bindPopup('Tvoja lokacija');
    setCenter(lat,lon,'gps',true);if(load)loadStations();
  },()=>{els.status.textContent='Lokacije ni bilo mogoče pridobiti. Dovoli GPS v brskalniku.'},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}
async function fetchStations(){
  if(state.controller)state.controller.abort();
  state.controller=new AbortController();
  const u=new URL(state.apiBase+'/stations');u.searchParams.set('lat',state.center.lat);u.searchParams.set('lon',state.center.lon);u.searchParams.set('radius',state.radiusKm);u.searchParams.set('fuel',state.fuel);
  const timer=setTimeout(()=>state.controller.abort(),7000);
  try{const r=await fetch(u,{cache:'no-store',headers:{Accept:'application/json'},signal:state.controller.signal});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();return j.features||j.data?.features||[]}
  finally{clearTimeout(timer)}
}
function normalize(features){
  const out=[];
  for(const f of features){
    const c=f.geometry?.coordinates,p=f.properties||{};if(!Array.isArray(c)||c.length<2)continue;
    const lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    // Search radius is always based on the visible map centre. The distance shown
    // to the user, however, is always from the real GPS position when available.
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
  const seq=++state.requestSeq;els.status.textContent='Posodabljam cene …';els.updated.textContent='Posodabljam …';
  try{
    const features=await fetchStations();if(seq!==state.requestSeq)return;
    state.stations=dedupe(normalize(features));render();
    const withPrice=state.stations.filter(s=>s.price!=null).length;
    els.updated.textContent='Posodobljeno pravkar';els.status.textContent=`${state.stations.length} črpalk · ${withPrice} s ceno · vir: Pumperly`;
  }catch(e){if(e.name==='AbortError')return;console.warn(e);if(seq!==state.requestSeq)return;state.stations=[];render();els.updated.textContent='Napaka pri podatkih';els.status.textContent='Podatkov trenutno ni bilo mogoče naložiti.'}
}
function markerIcon(s){const t=price(s)||'⛽';return L.divIcon({className:'',html:`<div class="price-marker">${esc(t)}</div>`,iconSize:[76,28],iconAnchor:[38,14]})}
function openSheet(){state.sheetOpen=true;els.sheet.classList.add('sheet-open');els.sheet.classList.remove('sheet-low');els.toggle.textContent='Skrij seznam ↓';setTimeout(()=>state.map.invalidateSize(),280)}
function closeSheet(){state.sheetOpen=false;els.sheet.classList.remove('sheet-open');els.sheet.classList.add('sheet-low');els.toggle.textContent='Prikaži seznam ↑';setTimeout(()=>state.map.invalidateSize(),280)}
function toggleSheet(){state.sheetOpen?closeSheet():openSheet()}
window.manniToggleSheet=toggleSheet;
function render(){
  state.markerLayer.clearLayers();
  const arr=[...state.stations].sort((a,b)=>els.sort.value==='distance'?a.distance-b.distance:(a.price==null)-(b.price==null)||(a.price??9999)-(b.price??9999)||a.distance-b.distance);
  els.best.textContent=price(arr.find(s=>s.price!=null))||'—';
  if(!arr.length){els.list.innerHTML='<div class="empty">Na tem območju ni rezultatov. Premakni zemljevid ali povečaj radij.</div>';return}
  els.list.innerHTML='';
  arr.forEach((s,i)=>{
    const popup=`<div class="manni-popup"><b>${esc(s.name)}</b>${s.address?`<br>${esc(s.address)}`:''}<br><strong>${esc(price(s)||'Cena ni na voljo')}</strong><br>${s.distance.toFixed(1)} km</div>`;
    const m=L.marker([s.lat,s.lon],{icon:markerIcon(s)}).bindPopup(popup,{closeButton:true,autoPan:true});
    m.on('click',()=>{openSheet();setTimeout(()=>document.getElementById(`station-${i}`)?.scrollIntoView({block:'nearest',behavior:'smooth'}),180)});
    state.markerLayer.addLayer(m);
    const a=ago(s.updated),art=document.createElement('article');art.className='station-card';art.id=`station-${i}`;
    art.innerHTML=`<div class="station-top"><div class="brand-icon">${esc(letters(s))}</div><div class="station-main"><div class="station-name">${FLAG[s.country]||''} ${esc(s.name)}</div><div class="station-address">${esc(s.address||s.brand||'')}</div></div></div><div class="station-price-row"><div class="price-block"><div class="price-line">Cena ${s.price!=null?`<strong>${esc(price(s))}</strong>`:'<strong style="color:#a0aaa7">—</strong>'}</div><div class="price-sub">Vir: Pumperly${a?` · ${esc(a)}`:''}</div></div><div class="right-actions"><div class="distance">→ ${s.distance.toFixed(1)} km</div><a class="nav-btn" href="${nav(s)}" target="_blank" rel="noopener">Navigiraj</a></div></div>`;
    els.list.appendChild(art);
  });
}

// Reliable bottom sheet: tap is primary, swipe is optional.
els.toggle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleSheet()});
els.handle.addEventListener('click',e=>{if(e.target===els.toggle)return;toggleSheet()});
let sy=null;
els.handle.addEventListener('touchstart',e=>{if(e.touches?.length===1)sy=e.touches[0].clientY},{passive:true});
els.handle.addEventListener('touchend',e=>{if(sy==null)return;const y=e.changedTouches?.[0]?.clientY??sy,d=sy-y;sy=null;if(Math.abs(d)>35){d>0?openSheet():closeSheet();e.preventDefault()}},{passive:false});

$('settingsBtn').addEventListener('click',()=>{els.radius.value=state.radiusKm;els.fuel.value=state.fuel;els.api.value=state.apiBase;els.settings.showModal()});
$('saveSettingsBtn').addEventListener('click',e=>{e.preventDefault();state.radiusKm=Number(els.radius.value);state.fuel=els.fuel.value;state.apiBase=(els.api.value||'').trim().replace(/\/$/,'');localStorage.setItem('radiusKm',state.radiusKm);localStorage.setItem('fuel',state.fuel);localStorage.setItem('manniApiBase',state.apiBase);els.settings.close();if(state.center){setCenter(state.center.lat,state.center.lon,state.gps?'gps':'map',true);loadStations()}});
els.refresh.addEventListener('click',()=>{loadStations();window.dispatchEvent(new CustomEvent('manni:checkpoint-request'))});els.locate.addEventListener('click',()=>locate(true));els.sort.addEventListener('change',render);
initMap();closeSheet();locate(true);
console.info("Manni Fuel 3.6 GPS-checkpoint beta — stable Pumperly core unchanged");
