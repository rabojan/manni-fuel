// Manni's World 3.6 — GPS checkpoints + route + safe range beta
// Each launch/refresh stores a GPS checkpoint. Road distance from the previous
// checkpoint is accumulated and used only as a live fuel estimate. Odometer at
// refuelling remains the authoritative source for trip statistics/consumption.
(function(){
  function $(id){return document.getElementById(id)}
  const ui={
    panel:$('journeyPanel'), refresh:$('journeyRefreshBtn'), status:$('journeyStatus'),
    next:$('journeyNext'), nextKm:$('journeyNextKm'), remaining:$('journeyRemaining'),
    fuel:$('journeyFuel'), safe:$('journeySafeRange'), note:$('journeyNote'),
    segment:$('journeySegmentKm'), tracked:$('journeyTrackedKm')
  };
  if(!ui.panel || !window.ManniStorage) return;

  const GEO_CACHE_KEY='manni.world.geocode.v1';
  const PHOTON='https://photon.komoot.io/api/';
  const OSRM='https://router.project-osrm.org/route/v1/driving/';
  let busy=false;

  function fmtKm(v){return Number.isFinite(v)?`${v<10?v.toFixed(1).replace('.',','):Math.round(v).toLocaleString('sl-SI')} km`:'—'}
  function fmtL(v){return Number.isFinite(v)?`${v.toFixed(1).replace('.',',')} l`:'—'}
  function getCache(){try{return JSON.parse(localStorage.getItem(GEO_CACHE_KEY)||'{}')}catch{return {}}}
  function setCache(c){try{localStorage.setItem(GEO_CACHE_KEY,JSON.stringify(c))}catch{}}
  function key(v){return String(v||'').trim().toLocaleLowerCase('sl-SI')}
  function hav(a,b){const R=6371,p=Math.PI/180,da=(b.lat-a.lat)*p,dl=(b.lon-a.lon)*p,x=Math.sin(da/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(x))}

  async function geocode(name){
    const k=key(name),cache=getCache();
    if(cache[k] && Number.isFinite(cache[k].lat) && Number.isFinite(cache[k].lon)) return cache[k];
    const u=new URL(PHOTON);u.searchParams.set('q',name);u.searchParams.set('limit','1');u.searchParams.set('lang','en');
    const r=await fetch(u,{headers:{Accept:'application/json'},cache:'no-store'});
    if(!r.ok) throw new Error('Geocoding '+r.status);
    const j=await r.json(),f=j.features?.[0],c=f?.geometry?.coordinates;
    if(!Array.isArray(c)||c.length<2) throw new Error('Kraja ni bilo mogoče najti: '+name);
    const out={name,lat:Number(c[1]),lon:Number(c[0])};cache[k]=out;setCache(cache);return out;
  }

  function currentPosition(){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error('GPS ni na voljo.'));
      navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}),()=>reject(new Error('Lokacije ni bilo mogoče pridobiti. Dovoli GPS.')),{enableHighAccuracy:true,timeout:12000,maximumAge:15000});
    });
  }

  async function roadRoute(points){
    if(points.length<2) return null;
    const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');
    const u=new URL(OSRM+coords);u.searchParams.set('overview','false');u.searchParams.set('steps','false');
    const r=await fetch(u,{headers:{Accept:'application/json'},cache:'no-store'});
    if(!r.ok)throw new Error('Routing '+r.status);
    const j=await r.json();if(j.code!=='Ok'||!j.routes?.length) throw new Error('Cestne poti ni bilo mogoče izračunati.');
    return {km:j.routes[0].distance/1000,min:j.routes[0].duration/60,legs:j.routes[0].legs||[]};
  }

  function liveFuel(data){
    const base=Number(data.vehicle?.currentFuelLitres),avg=Number(data.vehicle?.averageConsumption),tracked=Number(data.journey?.trackedKm||0);
    if(!Number.isFinite(base)) return null;
    if(!Number.isFinite(avg)||avg<=0) return base;
    return Math.max(0,base-tracked*avg/100);
  }
  function safeRange(data){
    const f=liveFuel(data),avg=Number(data.vehicle?.averageConsumption),reserve=10;
    if(!Number.isFinite(f)||!Number.isFinite(avg)||avg<=0)return null;
    return Math.max(0,f-reserve)/avg*100;
  }

  function resetRouteProgressIfChanged(data,names){
    const old=(data.journey?.resolvedPoints||[]).map(x=>x.name);
    const same=old.length===names.length&&old.every((x,i)=>key(x)===key(names[i]));
    if(!same){
      // Route planning resets, GPS/fuel checkpoint history deliberately survives.
      data.journey.nextIndex=0;data.journey.startCoord=null;data.journey.resolvedPoints=[];
      data.journey.lastRouteKm=null;data.journey.lastNextKm=null;
    }
  }

  function passedWaypoint(prev,wp,pos){
    if(hav(pos,wp)<=25)return true;if(!prev)return false;
    const x=wp.lon-prev.lon,y=wp.lat-prev.lat,den=x*x+y*y;if(den<1e-9)return false;
    const t=((pos.lon-prev.lon)*x+(pos.lat-prev.lat)*y)/den,corridor=hav(pos,wp);
    return t>1.03 && corridor<120;
  }

  async function resolvePoints(names){
    const out=[];for(let i=0;i<names.length;i++){ui.status.textContent=`Iščem točko ${i+1}/${names.length}: ${names[i]} …`;const g=await geocode(names[i]);out.push({...g,kind:i===names.length-1?'destination':'via'})}return out;
  }

  function renderFromStored(){
    const d=window.ManniStorage.get(),j=d.journey||{},r=d.route||{},sr=safeRange(d),fuel=liveFuel(d);
    ui.panel.hidden=!r.destination;if(!r.destination)return;
    ui.fuel.textContent=fmtL(fuel);ui.safe.textContent=fmtKm(sr);
    if(ui.segment)ui.segment.textContent=fmtKm(j.lastSegmentKm);
    if(ui.tracked)ui.tracked.textContent=fmtKm(Number(j.trackedKm||0));
    const pts=j.resolvedPoints||[],idx=Math.min(j.nextIndex||0,Math.max(0,pts.length-1));
    ui.next.textContent=pts[idx]?.name||((r.via||[])[idx]||r.destination||'—');
    ui.nextKm.textContent=fmtKm(j.lastNextKm);ui.remaining.textContent=fmtKm(j.lastRouteKm);
    if(j.updatedAt){const t=new Date(j.updatedAt).toLocaleTimeString('sl-SI',{hour:'2-digit',minute:'2-digit'});ui.status.textContent=`Nazadnje osveženo ob ${t}`}
    else ui.status.textContent='Pot še ni preračunana.';
    if(!Number.isFinite(sr))ui.note.textContent='Za doseg najprej vnesi trenutno gorivo in povprečno porabo v ⛽ Manni & tankanja.';
    else if(Number.isFinite(j.lastNextKm)&&j.lastNextKm>sr)ui.note.textContent='Naslednja točka je izven varnega dosega. Pred njo bo potrebno tankanje.';
    else ui.note.textContent='GPS kontrolne točke ocenjujejo sproti prevožene kilometre. Za natančno statistiko ostane merodajen števec kilometrov ob tankanju.';
  }

  async function refresh(){
    if(busy)return;busy=true;if(ui.refresh)ui.refresh.disabled=true;ui.status.textContent='Osvežujem GPS, kilometre in pot …';
    try{
      let data=window.ManniStorage.get(),r=data.route||{};
      if(!r.destination)throw new Error('Najprej nastavi cilj v razdelku Pot.');
      const names=[...(r.via||[]),r.destination].map(x=>String(x).trim()).filter(Boolean);if(!names.length)throw new Error('Pot nima cilja.');
      window.ManniStorage.update(d=>{resetRouteProgressIfChanged(d,names);return d});data=window.ManniStorage.get();
      const pos=await currentPosition();

      // GPS checkpoint: calculate the ROAD distance from the previous checkpoint.
      let segmentKm=0;
      const prev=data.journey?.lastPosition;
      if(prev && hav(prev,pos)>0.08){
        try{const seg=await roadRoute([prev,pos]);if(seg && Number.isFinite(seg.km) && seg.km<500)segmentKm=seg.km}catch(e){console.warn('Checkpoint routing',e)}
      }
      window.ManniStorage.update(d=>{
        const j=d.journey||(d.journey={});
        const tracked=Math.max(0,Number(j.trackedKm||0)+(Number.isFinite(segmentKm)?segmentKm:0));
        j.lastSegmentKm=segmentKm;j.trackedKm=tracked;j.lastPosition={lat:pos.lat,lon:pos.lon};j.lastCheckpointAt=new Date().toISOString();
        j.checkpoints=[...(j.checkpoints||[]),{lat:pos.lat,lon:pos.lon,timestamp:j.lastCheckpointAt,segmentKm}].slice(-100);
        const base=Number(d.vehicle?.currentFuelLitres),avg=Number(d.vehicle?.averageConsumption);
        j.estimatedFuelLitres=Number.isFinite(base)&&Number.isFinite(avg)&&avg>0?Math.max(0,base-tracked*avg/100):(Number.isFinite(base)?base:null);
        return d;
      });
      data=window.ManniStorage.get();

      let pts=(data.journey?.resolvedPoints||[]);
      if(pts.length!==names.length || !pts.every((p,i)=>key(p.name)===key(names[i]))) pts=await resolvePoints(names);
      let idx=Math.min(data.journey?.nextIndex||0,pts.length-1),start=data.journey?.startCoord;
      if(!start)start={lat:pos.lat,lon:pos.lon};
      while(idx<pts.length-1){const previous=idx===0?start:pts[idx-1];if(passedWaypoint(previous,pts[idx],pos))idx++;else break}
      const remainingPts=[pos,...pts.slice(idx)],route=await roadRoute(remainingPts),nextRoute=await roadRoute([pos,pts[idx]]);
      window.ManniStorage.update(d=>{d.journey={...d.journey,startCoord:start,nextIndex:idx,resolvedPoints:pts,lastRouteKm:route?.km??null,lastNextKm:nextRoute?.km??null,lastDurationMin:route?.min??null,updatedAt:new Date().toISOString()};return d});
      renderFromStored();
    }catch(e){console.warn('Journey refresh',e);ui.status.textContent=e.message||'Poti ni bilo mogoče preračunati.'}
    finally{busy=false;if(ui.refresh)ui.refresh.disabled=false}
  }

  function resetFuelTracking(){
    // A saved fuel change/refuel becomes the new fuel anchor. Keep the current GPS
    // position as the next segment start, but do not count prior tracked km twice.
    window.ManniStorage.update(d=>{d.journey.trackedKm=0;d.journey.lastSegmentKm=0;d.journey.estimatedFuelLitres=d.vehicle.currentFuelLitres;d.journey.checkpoints=[];return d});
    renderFromStored();
  }

  if(ui.refresh)ui.refresh.addEventListener('click',refresh);
  window.addEventListener('manni:checkpoint-request',refresh);
  window.addEventListener('manni:fuel-changed',resetFuelTracking);
  window.addEventListener('manni:trip-changed',renderFromStored);
  window.addEventListener('manni:route-changed',()=>{window.ManniStorage.update(d=>{d.journey.nextIndex=0;d.journey.startCoord=null;d.journey.resolvedPoints=[];d.journey.updatedAt=null;return d});renderFromStored();setTimeout(refresh,150)});
  renderFromStored();
  // Opening the app creates a checkpoint automatically when an active destination exists.
  setTimeout(()=>{if(window.ManniStorage.get().route?.destination)refresh()},1000);
  console.info('Manni 3.7 GPS checkpoint module ready');
})();
