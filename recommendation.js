// Manni's World 3.14 — verified smart fuel recommendation
// IMPORTANT: the map may show all Pumperly stations. This module is deliberately stricter:
// it recommends only stations whose physical location is independently confirmed in OSM.
(function(){
  const $=id=>document.getElementById(id);
  const ui={panel:$('recommendPanel'),status:$('recommendStatus'),main:$('recommendMain'),alts:$('recommendAlternatives'),reason:$('recommendReason')};
  if(!ui.panel||!window.ManniStorage)return;

  const API=(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,'');
  const OSRM='https://router.project-osrm.org/route/v1/driving/';
  const OVERPASS='https://overpass-api.de/api/interpreter';
  const RESERVE_L=10;              // hard reserve — never recommend arrival below this
  const MAX_OFF_ROUTE_KM=5;        // agreed corridor
  const NORMAL_ZONE_KM=100;        // normally start looking seriously in the last 100 km before reserve
  const EARLY_LOOKAHEAD_KM=250;    // compare an early opportunity with the next part of the route
  const EARLY_MIN_DIFF_EUR=0.08;   // meaningful price difference
  const EARLY_MIN_SAVING_EUR=5;    // meaningful expected saving
  const VERIFY_RADIUS_M=300;
  let busy=false;

  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const rad=x=>x*Math.PI/180;
  const slNum=(v,d=2)=>new Intl.NumberFormat('sl-SI',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v));
  const slKm=v=>`${new Intl.NumberFormat('sl-SI',{minimumFractionDigits:v<10?1:0,maximumFractionDigits:v<10?1:0}).format(Number(v))} km`;
  const slL=v=>`${slNum(v,1)} l`;
  const slEur=v=>`${slNum(v,2)} €`;

  function hav(a,b){const R=6371,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon),x=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  function normText(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
  function tokens(v){return new Set(normText(v).split(/\s+/).filter(x=>x.length>1))}
  function nameScore(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;A.forEach(x=>{if(B.has(x))hit++});return hit/Math.max(A.size,B.size)}
  function fmtPrice(s){return `${slNum(s.price,2)} ${s.currency==='EUR'?'€/l':s.currency+'/l'}`}
  function pos(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),()=>rej(new Error('GPS lokacije ni bilo mogoče dobiti.')),{enableHighAccuracy:true,timeout:12000,maximumAge:15000}):rej(new Error('GPS ni na voljo.')))}
  async function routeGeometry(points){const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');const u=new URL(OSRM+coords);u.searchParams.set('overview','full');u.searchParams.set('geometries','geojson');u.searchParams.set('steps','false');const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('Poti ni mogoče izračunati.');const j=await r.json(),rt=j.routes?.[0];if(!rt)throw new Error('Poti ni mogoče izračunati.');return {km:rt.distance/1000,line:rt.geometry.coordinates.map(c=>({lon:+c[0],lat:+c[1]}))}}
  function cumulative(line){const c=[0];for(let i=1;i<line.length;i++)c[i]=c[i-1]+hav(line[i-1],line[i]);return c}
  function project(st,line,cum){let best={off:Infinity,along:0};for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];const lat0=rad((a.lat+b.lat+st.lat)/3),sx=(st.lon-a.lon)*111.32*Math.cos(lat0),sy=(st.lat-a.lat)*110.57,bx=(b.lon-a.lon)*111.32*Math.cos(lat0),by=(b.lat-a.lat)*110.57,den=bx*bx+by*by,t=den?Math.max(0,Math.min(1,(sx*bx+sy*by)/den)):0,dx=sx-t*bx,dy=sy-t*by,off=Math.hypot(dx,dy);if(off<best.off)best={off,along:cum[i-1]+t*(cum[i]-cum[i-1])}}return best}
  async function fetchAt(p,radius=20){const u=new URL(API+'/stations');u.searchParams.set('lat',p.lat);u.searchParams.set('lon',p.lon);u.searchParams.set('radius',radius);u.searchParams.set('fuel','B7');const r=await fetch(u,{cache:'no-store'});if(!r.ok)return [];const j=await r.json();return j.features||j.data?.features||[]}
  function norm(fs){const out=[];for(const f of fs){const c=f.geometry?.coordinates,p=f.properties||{};if(!c)continue;const lon=+c[0],lat=+c[1],price=+p.price;if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(price)||price<=0)continue;out.push({id:String(p.id||p.externalId||lat+'-'+lon),name:p.name||p.brand||'Bencinska črpalka',brand:p.brand||'',address:[p.address,p.city].filter(Boolean).join(', '),country:String(p.country||'').toUpperCase(),lat,lon,price,currency:p.currency||'EUR'})}return out}
  function dedupe(a){const out=[];for(const s of a)if(!out.some(x=>hav(s,x)<.08))out.push(s);return out}
  function sample(line,cum,maxKm){const pts=[line[0]],step=55,limit=Math.min(maxKm,cum[cum.length-1]);let target=step;for(let i=1;i<line.length&&target<=limit;i++){while(cum[i]>=target&&target<=limit){pts.push(line[i]);target+=step}}if(limit>20){let idx=cum.findIndex(x=>x>=limit);if(idx<0)idx=line.length-1;pts.push(line[idx])}return pts.slice(0,16)}
  function liveFuel(d){const j=d.journey||{},base=Number(d.vehicle?.currentFuelLitres),avg=Number(d.vehicle?.averageConsumption),tracked=Number(j.trackedKm||0);if(!Number.isFinite(base))return null;return Number.isFinite(avg)&&avg>0?Math.max(0,base-tracked*avg/100):base}

  // One Overpass request verifies several strongest candidates at once. This avoids the old failure mode
  // where an aggressive global filter removed whole countries from the map.
  async function osmEvidence(stations){
    const out=new Map(stations.map(s=>[s.id,{status:'unverified',distanceKm:null,score:0,motorway:null,osm:null}]));
    if(!stations.length)return out;
    const clauses=[];
    stations.forEach(s=>{
      clauses.push(`nwr(around:${VERIFY_RADIUS_M},${s.lat},${s.lon})[amenity=fuel];`);
      clauses.push(`nwr(around:550,${s.lat},${s.lon})[highway=services];`);
      clauses.push(`nwr(around:550,${s.lat},${s.lon})[highway=rest_area];`);
    });
    const q=`[out:json][timeout:18];(${clauses.join('')});out center tags;`;
    const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),15000);
    try{
      const r=await fetch(OVERPASS+'?data='+encodeURIComponent(q),{signal:ctl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw 0;
      const j=await r.json();
      const fuels=[],services=[];
      for(const e of j.elements||[]){const lat=Number(e.lat??e.center?.lat),lon=Number(e.lon??e.center?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const tags=e.tags||{},x={lat,lon,tags};if(tags.amenity==='fuel')fuels.push(x);if(tags.highway==='services'||tags.highway==='rest_area')services.push(x)}
      for(const s of stations){
        let best=null;
        for(const f of fuels){const d=hav(s,f),score=Math.max(nameScore(s.name,f.tags.name),nameScore(s.brand,f.tags.brand),nameScore(s.name,f.tags.brand),nameScore(s.brand,f.tags.name));if(!best||d<best.d||(Math.abs(d-best.d)<.03&&score>best.score))best={f,d,score}}
        const motorway=services.some(x=>hav(s,x)<=.55);
        if(!best){out.set(s.id,{status:'mismatch',distanceKm:null,score:0,motorway,osm:null});continue}
        // Conservative verification for automatic recommendations:
        // very close geometry is enough; otherwise require a name/brand agreement as well.
        const verified=(best.d<=.055)||(best.d<=.18&&best.score>=.25);
        const status=verified?'verified':(best.d<=.30?'unverified':'mismatch');
        out.set(s.id,{status,distanceKm:best.d,score:best.score,motorway,osm:best.f});
      }
      return out;
    }catch(e){
      // If OSM cannot be reached, do NOT silently trust candidates for automatic navigation.
      return out;
    }finally{clearTimeout(tm)}
  }

  function fuelAtArrival(current,avg,along){return Math.max(0,current-along*avg/100)}
  function plannedFillLitres(tank,current,avg,along){const arrival=fuelAtArrival(current,avg,along);return Number.isFinite(tank)&&tank>0?Math.max(0,tank-arrival):Math.max(0,current-arrival)}
  function baseScore(x){
    // Reliability has already been enforced. Here prefer off-motorway, lower price and less deviation.
    const motorwayPenalty=x.motorway===true?0.12:0;
    return x.price+motorwayPenalty+x.off*0.006;
  }
  function sameCurrency(a,b){return a.currency===b.currency}
  function earlyOpportunity(s,all,{tank,fuel,avg}){
    if(s.currency!=='EUR')return null; // no raw cross-currency comparisons
    const future=all.filter(x=>x.id!==s.id&&x.verified&&sameCurrency(s,x)&&x.along>=s.along+25&&x.along<=s.along+EARLY_LOOKAHEAD_KM);
    if(!future.length)return null;
    const futureMin=Math.min(...future.map(x=>x.price));
    const diff=futureMin-s.price;
    const fill=plannedFillLitres(tank,fuel,avg,s.along);
    const saving=diff*fill;
    if(diff>=EARLY_MIN_DIFF_EUR&&saving>=EARLY_MIN_SAVING_EUR)return {saving,diff,fill,futureMin};
    return null;
  }
  function pickRecommendations(stations,ctx){
    const verified=stations.filter(x=>x.verified);
    if(!verified.length)return {main:null,alts:[],reasonType:'none'};
    const safeKm=ctx.safeKm;
    const normalStart=Math.max(0,safeKm-NORMAL_ZONE_KM);

    // 1) A genuinely cheaper early stop may override waiting until the reserve zone.
    const early=verified.filter(x=>x.along<normalStart).map(x=>({x,opp:earlyOpportunity(x,verified,ctx)})).filter(z=>z.opp).sort((a,b)=>(b.opp.saving-a.opp.saving)||(baseScore(a.x)-baseScore(b.x)));
    let main,reasonType='normal',opportunity=null;
    if(early.length){main=early[0].x;opportunity=early[0].opp;reasonType='early'}
    else{
      // 2) Normal refuel: choose among the final ~100 km before the hard reserve.
      let zone=verified.filter(x=>x.along>=normalStart&&x.along<=safeKm);
      // If there is no verified station that late, take the last safe verified group rather than risk the reserve.
      if(!zone.length){const furthest=Math.max(...verified.map(x=>x.along));zone=verified.filter(x=>x.along>=Math.max(0,furthest-45))}
      zone.sort((a,b)=>baseScore(a)-baseScore(b)||(b.along-a.along));
      main=zone[0]||verified[0];
    }
    // Alternatives are verified and genuinely reachable; keep one nearby in route distance and one price-oriented where possible.
    const altPool=verified.filter(x=>x.id!==main.id).sort((a,b)=>baseScore(a)-baseScore(b)||Math.abs(a.along-main.along)-Math.abs(b.along-main.along));
    return {main,alts:altPool.slice(0,2),reasonType,opportunity};
  }

  function card(s,main=false,ctx={}){
    const arrival=fuelAtArrival(ctx.fuel,ctx.avg,s.along);
    const verify=`<span class="rec-verified">✓ preverjena lokacija</span>`;
    const road=s.motorway===true?'avtocestna':s.motorway===false?'izven avtoceste':'tip ceste ni potrjen';
    return `<div class="recommend-card${main?' main':''}"><div class="rec-name">${esc(s.name)}</div><div class="rec-price">${esc(fmtPrice(s))}</div><div class="rec-verify">${verify}</div><div class="rec-meta"><span class="rec-route">čez približno ${slKm(s.along)} · ${slNum(s.off,1)} km s poti · ${road}</span><br><span>ob prihodu približno ${slL(arrival)} goriva</span>${s.address?`<br>${esc(s.address)}`:''}</div><button type="button" data-show-rec="${esc(s.id)}">Pokaži na zemljevidu</button></div>`
  }

  async function refresh(){
    if(busy)return;busy=true;ui.panel.hidden=false;ui.status.textContent='Iščem in preverjam črpalke ob poti …';ui.main.innerHTML='';ui.alts.innerHTML='';ui.reason.textContent='';
    try{
      const d=window.ManniStorage.get(),route=d.route||{},avg=Number(d.vehicle?.averageConsumption),fuel=liveFuel(d),tank=Number(d.vehicle?.tankCapacityLitres),reserve=RESERVE_L;
      if(!route.destination)throw new Error('Najprej nastavi cilj poti.');
      if(!Number.isFinite(avg)||avg<=0||!Number.isFinite(fuel))throw new Error('Vnesi trenutno gorivo in povprečno porabo.');
      if(!route.destinationPoint || (route.via||[]).length!==(route.viaPoints||[]).length)throw new Error('Pot vsebuje nepotrjene točke. Odpri Pot in jih izberi iz predlogov.');
      if(d.journey?.routeValid===false)throw new Error('Pot ni potrjena. Najprej popravi označeni odsek poti.');
      const safeKm=Math.max(0,(fuel-reserve)/avg*100);if(safeKm<15)throw new Error('Doseg do 10-litrske rezerve je zelo majhen — izberi najbližjo preverjeno črpalko.');

      const start=await pos();
      let pts=(d.journey?.resolvedPoints||[]).slice(d.journey?.nextIndex||0).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(!pts.length)pts=[...(route.viaPoints||[]),route.destinationPoint].map(p=>({lat:Number(p.lat),lon:Number(p.lon),name:p.label||p.name})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      const rt=await routeGeometry([start,...pts]),cum=cumulative(rt.line),samples=sample(rt.line,cum,Math.min(rt.km,safeKm+80));
      ui.status.textContent=`Pregledujem naslednjih približno ${Math.round(Math.min(safeKm,rt.km))} km …`;

      const batches=[];for(let i=0;i<samples.length;i+=4){const part=await Promise.all(samples.slice(i,i+4).map(x=>fetchAt(x,20)));batches.push(...part)}
      let stations=dedupe(norm(batches.flat())).map(s=>Object.assign(s,project(s,rt.line,cum))).filter(s=>s.off<=MAX_OFF_ROUTE_KM&&s.along>=0&&s.along<=safeKm);
      if(!stations.length)throw new Error('V dosegu do 10-litrske rezerve nisem našel črpalke največ 5 km od poti.');

      // First limit verification work to the strongest realistic set, but include stations from the normal refuel zone.
      const normalStart=Math.max(0,safeKm-NORMAL_ZONE_KM);
      const strongest=[...stations].sort((a,b)=>(a.price-b.price)||(a.off-b.off)).slice(0,16);
      const late=[...stations].filter(x=>x.along>=normalStart).sort((a,b)=>b.along-a.along).slice(0,8);
      const verifySet=dedupe([...strongest,...late]).slice(0,22);
      ui.status.textContent='Preverjam, ali priporočene lokacije res obstajajo …';
      const evidence=await osmEvidence(verifySet);
      verifySet.forEach(s=>{const e=evidence.get(s.id)||{};s.verifyStatus=e.status||'unverified';s.verified=s.verifyStatus==='verified';s.motorway=e.motorway;s.osmDistanceKm=e.distanceKm;s.verifyScore=e.score||0});

      const verifiedCount=verifySet.filter(x=>x.verified).length;
      if(!verifiedCount)throw new Error('V varnem dosegu ni dovolj zanesljivo preverjene črpalke za avtomatsko priporočilo. Postaje lahko še vedno pregledaš na zemljevidu.');

      const currencies=new Set(verifySet.filter(x=>x.verified).map(x=>x.currency));
      // Never compare numeric prices across currencies. Ranking works within the route; cross-border savings wait for FX normalization.
      let rankingPool=verifySet.filter(x=>x.verified);
      if(currencies.size>1){
        // Prefer the current route's first currency group for a safe automatic recommendation, unless only another group is reachable late.
        const first=rankingPool.sort((a,b)=>a.along-b.along)[0]?.currency;
        const same=rankingPool.filter(x=>x.currency===first);if(same.length)rankingPool=same;
      }
      const picked=pickRecommendations(rankingPool,{tank,fuel,avg,safeKm});
      if(!picked.main)throw new Error('Nisem našel dovolj zanesljive črpalke za priporočilo.');
      const main=picked.main,alts=picked.alts;
      window.__manniRecommendations=[main,...alts];
      ui.main.innerHTML=card(main,true,{fuel,avg});ui.alts.innerHTML=alts.map(x=>card(x,false,{fuel,avg})).join('');

      const arrival=fuelAtArrival(fuel,avg,main.along),marginL=arrival-reserve;
      let reason='';
      if(picked.reasonType==='early'&&picked.opportunity){
        reason=`Zgodnejše ekonomično tankanje: ocenjeni prihranek je približno ${slEur(picked.opportunity.saving)} (${slNum(picked.opportunity.diff,2)} €/l manj kot najcenejša preverjena možnost v naslednjih približno ${EARLY_LOOKAHEAD_KM} km).`;
      }else{
        reason=`Tankanje je izbrano v varnem območju pred 10-litrsko rezervo. Ob prihodu ostane približno ${slL(arrival)} oziroma ${slL(Math.max(0,marginL))} nad rezervo.`;
      }
      if(main.motorway===false)reason+=' Prednost ima preverjena črpalka izven avtocestnega servisnega območja.';
      else if(main.motorway===true)reason+=' Gre za avtocestno črpalko; izbrana je bila, ker preverjena varnejša oziroma smiselnejša možnost izven avtoceste ni bila boljša.';
      if(currencies.size>1)reason+=' Kandidatov v različnih valutah še ne primerjam neposredno med seboj.';
      ui.reason.textContent=reason;
      ui.status.textContent=`✓ ${verifiedCount} preverjenih kandidatov · varen doseg približno ${Math.round(safeKm)} km`;
    }catch(e){ui.main.innerHTML=`<div class="recommend-empty">${esc(e.message||'Priporočila ni bilo mogoče izračunati.')}</div>`;ui.alts.innerHTML='';ui.reason.textContent='';ui.status.textContent='Priporočilo ni na voljo.'}
    finally{busy=false}
  }

  ui.panel.addEventListener('click',e=>{const b=e.target.closest('[data-show-rec]');if(!b)return;const s=(window.__manniRecommendations||[]).find(x=>x.id===b.dataset.showRec);if(s)window.dispatchEvent(new CustomEvent('manni:show-station',{detail:s}))});
  window.addEventListener('manni:checkpoint-request',()=>setTimeout(refresh,700));
  window.addEventListener('manni:route-changed',()=>setTimeout(refresh,1200));
  window.addEventListener('manni:fuel-changed',()=>setTimeout(refresh,600));
  window.addEventListener('manni:route-validated',e=>{if(e.detail?.valid)setTimeout(refresh,350);else{ui.panel.hidden=false;ui.status.textContent='Priporočilo čaka na potrjeno pot.';ui.main.innerHTML='<div class="recommend-empty">Najprej popravi označeni odsek poti.</div>';ui.alts.innerHTML='';ui.reason.textContent=''}});
  setTimeout(()=>{const d=window.ManniStorage.get();if(d.route?.destination)refresh()},2800);
  console.info('Manni 3.14 verified recommendation ready');
})();
