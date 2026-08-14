// Manni's World 3.12 — Smart Fuel Recommendation guarded by route validation
// Isolated module: reads route/vehicle data and queries the existing Worker.
(function(){
  const $=id=>document.getElementById(id);
  const ui={panel:$('recommendPanel'),status:$('recommendStatus'),main:$('recommendMain'),alts:$('recommendAlternatives'),reason:$('recommendReason')};
  if(!ui.panel||!window.ManniStorage)return;
  const API=(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,'');
  const OSRM='https://router.project-osrm.org/route/v1/driving/';
  let busy=false;
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const rad=x=>x*Math.PI/180;
  function hav(a,b){const R=6371,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon),x=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  function pos(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),()=>rej(new Error('GPS lokacije ni bilo mogoče dobiti.')),{enableHighAccuracy:true,timeout:12000,maximumAge:15000}):rej(new Error('GPS ni na voljo.')))}
  async function routeGeometry(points){const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');const u=new URL(OSRM+coords);u.searchParams.set('overview','full');u.searchParams.set('geometries','geojson');u.searchParams.set('steps','false');const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw 0;const j=await r.json(),rt=j.routes?.[0];if(!rt)throw new Error('Poti ni mogoče izračunati.');return {km:rt.distance/1000,line:rt.geometry.coordinates.map(c=>({lon:+c[0],lat:+c[1]}))}}
  function cumulative(line){const c=[0];for(let i=1;i<line.length;i++)c[i]=c[i-1]+hav(line[i-1],line[i]);return c}
  function project(st,line,cum){let best={off:Infinity,along:0};for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];const lat0=rad((a.lat+b.lat+st.lat)/3),sx=(st.lon-a.lon)*111.32*Math.cos(lat0),sy=(st.lat-a.lat)*110.57,bx=(b.lon-a.lon)*111.32*Math.cos(lat0),by=(b.lat-a.lat)*110.57,den=bx*bx+by*by,t=den?Math.max(0,Math.min(1,(sx*bx+sy*by)/den)):0,dx=sx-t*bx,dy=sy-t*by,off=Math.hypot(dx,dy);if(off<best.off){best={off,along:cum[i-1]+t*(cum[i]-cum[i-1])}}}return best}
  async function fetchAt(p,radius=20){const u=new URL(API+'/stations');u.searchParams.set('lat',p.lat);u.searchParams.set('lon',p.lon);u.searchParams.set('radius',radius);u.searchParams.set('fuel','B7');const r=await fetch(u,{cache:'no-store'});if(!r.ok)return [];const j=await r.json();return j.features||j.data?.features||[]}
  function norm(fs){const out=[];for(const f of fs){const c=f.geometry?.coordinates,p=f.properties||{};if(!c)continue;const lon=+c[0],lat=+c[1],price=+p.price;if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(price)||price<=0)continue;out.push({id:String(p.id||p.externalId||lat+'-'+lon),name:p.name||p.brand||'Bencinska črpalka',address:[p.address,p.city].filter(Boolean).join(', '),country:String(p.country||'').toUpperCase(),lat,lon,price,currency:p.currency||'EUR'})}return out}
  function dedupe(a){const out=[];for(const s of a)if(!out.some(x=>hav(s,x)<.08))out.push(s);return out}
  function sample(line,cum,maxKm){const pts=[line[0]],step=65,limit=Math.min(maxKm,cum[cum.length-1]);let target=step;for(let i=1;i<line.length&&target<=limit;i++){while(cum[i]>=target&&target<=limit){pts.push(line[i]);target+=step}}if(limit>20)pts.push(line[Math.min(line.length-1,cum.findIndex(x=>x>=limit)===-1?line.length-1:cum.findIndex(x=>x>=limit))]);return pts.slice(0,12)}
  function fmtPrice(s){const d=['HUF','RSD'].includes(s.currency)?1:3;return `${s.price.toFixed(d)} ${s.currency}`}
  function card(s,main=false){return `<div class="recommend-card${main?' main':''}"><div class="rec-name">${esc(s.name)}</div><div class="rec-price">${esc(fmtPrice(s))}</div><div class="rec-meta"><span class="rec-route">čez približno ${Math.round(s.along)} km · ${s.off.toFixed(1).replace('.',',')} km s poti</span>${s.address?`<br>${esc(s.address)}`:''}</div><button type="button" data-show-rec="${esc(s.id)}">Pokaži na zemljevidu</button></div>`}
  function liveFuel(d){const j=d.journey||{},base=Number(d.vehicle?.currentFuelLitres),avg=Number(d.vehicle?.averageConsumption),tracked=Number(j.trackedKm||0);if(!Number.isFinite(base))return null;return Number.isFinite(avg)&&avg>0?Math.max(0,base-tracked*avg/100):base}
  async function refresh(){
    if(busy)return;busy=true;ui.panel.hidden=false;ui.status.textContent='Iščem najbolj smiselno tankanje ob poti …';ui.main.innerHTML='';ui.alts.innerHTML='';ui.reason.textContent='';
    try{
      const d=window.ManniStorage.get(),route=d.route||{},avg=Number(d.vehicle?.averageConsumption),fuel=liveFuel(d),reserve=10;
      if(!route.destination)throw new Error('Najprej nastavi cilj poti.');if(!Number.isFinite(avg)||avg<=0||!Number.isFinite(fuel))throw new Error('Vnesi trenutno gorivo in povprečno porabo.');
      if(!route.destinationPoint || (route.via||[]).length!==(route.viaPoints||[]).length)throw new Error('Pot vsebuje nepotrjene točke. Odpri Pot in jih izberi iz predlogov.');
      if(d.journey?.routeValid===false)throw new Error('Pot ni potrjena. Najprej popravi označeni odsek poti.');
      const safeKm=Math.max(0,(fuel-reserve)/avg*100);if(safeKm<20)throw new Error('Doseg je že zelo majhen — izberi najbližjo odprto črpalko.');
      const start=await pos();let pts=(d.journey?.resolvedPoints||[]).slice(d.journey?.nextIndex||0).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(!pts.length){pts=[...(route.viaPoints||[]),route.destinationPoint].map(p=>({lat:Number(p.lat),lon:Number(p.lon),name:p.label||p.name})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))}
      const rt=await routeGeometry([start,...pts]),cum=cumulative(rt.line),samples=sample(rt.line,cum,safeKm+120);
      ui.status.textContent=`Pregledujem črpalke ob naslednjih ${Math.round(Math.min(safeKm,rt.km))} km …`;
      const batches=[];for(let i=0;i<samples.length;i+=3){const part=await Promise.all(samples.slice(i,i+3).map(x=>fetchAt(x,20)));batches.push(...part)}
      let stations=dedupe(norm(batches.flat()));
      stations=stations.map(s=>Object.assign(s,project(s,rt.line,cum))).filter(s=>s.off<=5 && s.along>=0 && s.along<=safeKm);
      if(!stations.length)throw new Error('V varnem dosegu nisem našel črpalke največ 5 km od poti.');
      stations.sort((a,b)=>a.along-b.along);
      const safetyCut=Math.max(30,safeKm-100);
      const safeEarly=stations.filter(s=>s.along<=safetyCut);
      const pool=safeEarly.length?safeEarly:stations;
      pool.sort((a,b)=>(a.price-b.price)||(a.off-b.off)||(a.along-b.along));
      const main=pool[0];
      const alts=stations.filter(s=>s.id!==main.id).sort((a,b)=>{
        const score=x=>x.price + x.off*0.004 + Math.max(0,x.along-safeKm*.8)*0.002;
        return score(a)-score(b)
      }).slice(0,2);
      window.__manniRecommendations=[main,...alts];
      ui.main.innerHTML=card(main,true);ui.alts.innerHTML=alts.map(x=>card(x,false)).join('');
      const margin=safeKm-main.along;
      ui.reason.textContent=`Glavno priporočilo je med najcenejšimi črpalkami največ 5 km od poti in ga dosežeš z okoli ${Math.round(margin)} km varnostnega dosega pred 10-l rezervno mejo.${safeEarly.length?' Pri izboru sem namenoma pustil vsaj približno 100 km dodatne varnostne razdalje, kadar je bilo to mogoče.':''}`;
      ui.status.textContent=`Preračunano · varen doseg približno ${Math.round(safeKm)} km`;
    }catch(e){ui.main.innerHTML=`<div class="recommend-empty">${esc(e.message||'Priporočila ni bilo mogoče izračunati.')}</div>`;ui.status.textContent='Priporočilo ni na voljo.'}
    finally{busy=false}
  }
  ui.panel.addEventListener('click',e=>{const b=e.target.closest('[data-show-rec]');if(!b)return;const s=(window.__manniRecommendations||[]).find(x=>x.id===b.dataset.showRec);if(s)window.dispatchEvent(new CustomEvent('manni:show-station',{detail:s}))});
  window.addEventListener('manni:checkpoint-request',()=>setTimeout(refresh,700));
  window.addEventListener('manni:route-changed',()=>setTimeout(refresh,1200));
  window.addEventListener('manni:fuel-changed',()=>setTimeout(refresh,600));
  window.addEventListener('manni:route-validated',e=>{if(e.detail?.valid)setTimeout(refresh,350);else{ui.panel.hidden=false;ui.status.textContent='Priporočilo čaka na potrjeno pot.';ui.main.innerHTML='<div class="recommend-empty">Najprej popravi označeni odsek poti.</div>';ui.alts.innerHTML='';ui.reason.textContent='';}});
  setTimeout(()=>{const d=window.ManniStorage.get();if(d.route?.destination)refresh()},2600);
})();
