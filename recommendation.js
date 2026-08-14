// Manni's World 3.16 — smart refuel window + route-spread alternatives
// IMPORTANT: the map may show all Pumperly stations. This module is deliberately stricter:
// it recommends only stations whose physical location is independently confirmed in OSM.
(function(){
  const $=id=>document.getElementById(id);
  const ui={panel:$('recommendPanel'),status:$('recommendStatus'),main:$('recommendMain'),alts:$('recommendAlternatives'),reason:$('recommendReason')};
  if(!ui.panel||!window.ManniStorage)return;

  const API=(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,'');
  const OSRM='https://router.project-osrm.org/route/v1/driving/';
  const OVERPASS='https://overpass-api.de/api/interpreter';
  const FX_API='https://api.frankfurter.dev/v2/rates';
  const RESERVE_L=10;              // normal reserve
  const RESERVE_FLEX=0.20;          // may use at most 20% of the reserve when it clearly improves the plan
  const ABSOLUTE_MIN_L=RESERVE_L*(1-RESERVE_FLEX); // 8 l — never recommend arrival below this
  const MAX_OFF_ROUTE_KM=5;        // agreed corridor
  const NORMAL_ZONE_KM=120;        // normal refuel window: final ~120 km before 10 l reserve
  const EARLY_LOOKAHEAD_KM=250;    // compare an early opportunity with the next part of the route
  const EARLY_MIN_DIFF_EUR=0.08;   // meaningful price difference
  const EARLY_MIN_SAVING_EUR=5;    // meaningful expected saving
  const EARLY_MAX_TANK_FRACTION=0.50; // normal economical stop only when <= half a tank remains
  const MIN_NORMAL_FILL_FRACTION=0.45; // normal stop should allow filling roughly >=45% of tank
  const ALT_MIN_GAP_KM=60;             // alternatives must be meaningfully separated along route
  const EXCEPTIONAL_DIFF_EUR=0.15;    // exceptional opportunity may override the half-tank rule
  const EXCEPTIONAL_SAVING_EUR=10;
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
  function fmtPrice(s){
    const native=`${slNum(s.price,2)} ${s.currency==='EUR'?'€/l':s.currency+'/l'}`;
    if(s.currency!=='EUR'&&Number.isFinite(s.priceEur))return `${native} · ~${slNum(s.priceEur,2)} €/l`;
    return native;
  }
  function pos(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),()=>rej(new Error('GPS lokacije ni bilo mogoče dobiti.')),{enableHighAccuracy:true,timeout:12000,maximumAge:15000}):rej(new Error('GPS ni na voljo.')))}
  async function routeGeometry(points){const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');const u=new URL(OSRM+coords);u.searchParams.set('overview','full');u.searchParams.set('geometries','geojson');u.searchParams.set('steps','false');const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('Poti ni mogoče izračunati.');const j=await r.json(),rt=j.routes?.[0];if(!rt)throw new Error('Poti ni mogoče izračunati.');return {km:rt.distance/1000,line:rt.geometry.coordinates.map(c=>({lon:+c[0],lat:+c[1]}))}}
  function cumulative(line){const c=[0];for(let i=1;i<line.length;i++)c[i]=c[i-1]+hav(line[i-1],line[i]);return c}
  function project(st,line,cum){let best={off:Infinity,along:0};for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];const lat0=rad((a.lat+b.lat+st.lat)/3),sx=(st.lon-a.lon)*111.32*Math.cos(lat0),sy=(st.lat-a.lat)*110.57,bx=(b.lon-a.lon)*111.32*Math.cos(lat0),by=(b.lat-a.lat)*110.57,den=bx*bx+by*by,t=den?Math.max(0,Math.min(1,(sx*bx+sy*by)/den)):0,dx=sx-t*bx,dy=sy-t*by,off=Math.hypot(dx,dy);if(off<best.off)best={off,along:cum[i-1]+t*(cum[i]-cum[i-1])}}return best}
  async function fetchAt(p,radius=20){const u=new URL(API+'/stations');u.searchParams.set('lat',p.lat);u.searchParams.set('lon',p.lon);u.searchParams.set('radius',radius);u.searchParams.set('fuel','B7');const r=await fetch(u,{cache:'no-store'});if(!r.ok)return [];const j=await r.json();return j.features||j.data?.features||[]}
  function norm(fs){const out=[];for(const f of fs){const c=f.geometry?.coordinates,p=f.properties||{};if(!c)continue;const lon=+c[0],lat=+c[1],price=+p.price;if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(price)||price<=0)continue;out.push({id:String(p.id||p.externalId||lat+'-'+lon),name:p.name||p.brand||'Bencinska črpalka',brand:p.brand||'',address:[p.address,p.city].filter(Boolean).join(', '),country:String(p.country||'').toUpperCase(),lat,lon,price,currency:p.currency||'EUR'})}return out}
  function dedupe(a){const out=[];for(const s of a)if(!out.some(x=>hav(s,x)<.08))out.push(s);return out}
  function sample(line,cum,maxKm){const pts=[line[0]],step=55,limit=Math.min(maxKm,cum[cum.length-1]);let target=step;for(let i=1;i<line.length&&target<=limit;i++){while(cum[i]>=target&&target<=limit){pts.push(line[i]);target+=step}}if(limit>20){let idx=cum.findIndex(x=>x>=limit);if(idx<0)idx=line.length-1;pts.push(line[idx])}return pts.slice(0,16)}
  async function fxTable(currencies){
    const out={EUR:1};
    const needed=[...new Set(currencies.filter(c=>c&&c!=='EUR'))];
    if(!needed.length)return out;
    try{
      const u=new URL(FX_API);u.searchParams.set('base','EUR');u.searchParams.set('quotes',needed.join(','));
      const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw 0;
      const rows=await r.json();
      for(const row of Array.isArray(rows)?rows:[]){const q=String(row.quote||'').toUpperCase(),rate=Number(row.rate);if(q&&Number.isFinite(rate)&&rate>0)out[q]=rate}
    }catch(e){}
    return out;
  }
  function eurPrice(s,fx){
    if(s.currency==='EUR')return s.price;
    const rate=fx[s.currency];
    return Number.isFinite(rate)&&rate>0?s.price/rate:null;
  }
  function liveFuel(d){const j=d.journey||{},base=Number(d.vehicle?.currentFuelLitres),avg=Number(d.vehicle?.averageConsumption),tracked=Number(j.trackedKm||0);if(Number.isFinite(j.estimatedFuelLitres))return Math.max(0,Number(j.estimatedFuelLitres));if(!Number.isFinite(base))return null;return Number.isFinite(avg)&&avg>0?Math.max(0,base-tracked*avg/100):base}

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
    // Reliability has already been enforced. Compare normalized EUR prices, then road type and deviation.
    const p=Number.isFinite(x.priceEur)?x.priceEur:Infinity;
    const motorwayPenalty=x.motorway===true?0.12:0;
    return p+motorwayPenalty+x.off*0.006;
  }
  function earlyOpportunity(s,all,{tank,fuel,avg}){
    if(!Number.isFinite(s.priceEur)||!Number.isFinite(tank)||tank<=0)return null;
    const arrival=fuelAtArrival(fuel,avg,s.along);
    const fill=plannedFillLitres(tank,fuel,avg,s.along);
    if(fill<=0)return null;
    const future=all.filter(x=>x.id!==s.id&&x.verified&&Number.isFinite(x.priceEur)&&x.along>=s.along+25&&x.along<=s.along+EARLY_LOOKAHEAD_KM);
    if(!future.length)return null;
    const futureMin=Math.min(...future.map(x=>x.priceEur));
    const diff=futureMin-s.priceEur;
    const saving=diff*fill;
    const halfTankRule=arrival<=tank*EARLY_MAX_TANK_FRACTION;
    const exceptional=diff>=EXCEPTIONAL_DIFF_EUR&&saving>=EXCEPTIONAL_SAVING_EUR;
    if((halfTankRule||exceptional)&&diff>=EARLY_MIN_DIFF_EUR&&saving>=EARLY_MIN_SAVING_EUR)return {saving,diff,fill,futureMin,arrival,exceptional};
    return null;
  }
  function bestByScore(list){return [...list].sort((a,b)=>baseScore(a)-baseScore(b)||(b.along-a.along))[0]||null}
  function chooseAlternatives(verified,main,ctx){
    const earlier=verified.filter(x=>x.id!==main.id&&x.along<=main.along-ALT_MIN_GAP_KM&&x.along>=Math.max(0,main.along-220));
    const later=verified.filter(x=>x.id!==main.id&&x.along>=main.along+ALT_MIN_GAP_KM&&x.along<=ctx.extendedKm);
    const a=bestByScore(earlier);
    // For later alternative, favor the latest safely reachable group, then price.
    let b=null;
    if(later.length){
      const far=Math.max(...later.map(x=>x.along));
      b=bestByScore(later.filter(x=>x.along>=far-80));
    }
    const out=[];if(a)out.push(a);if(b&&(!a||b.id!==a.id))out.push(b);
    if(out.length<2){
      const fallback=verified.filter(x=>x.id!==main.id&&!out.some(y=>y.id===x.id)&&Math.abs(x.along-main.along)>=ALT_MIN_GAP_KM)
        .sort((a,b)=>Math.abs(a.along-main.along)-Math.abs(b.along-main.along)||baseScore(a)-baseScore(b));
      while(out.length<2&&fallback.length)out.push(fallback.shift());
    }
    return out;
  }
  function pickRecommendations(stations,ctx){
    const verified=stations.filter(x=>x.verified&&x.along<=ctx.extendedKm&&Number.isFinite(x.priceEur));
    if(!verified.length)return {main:null,alts:[],reasonType:'none'};
    const safeKm=ctx.safeKm,extendedKm=ctx.extendedKm;
    const normalStart=Math.max(0,safeKm-NORMAL_ZONE_KM);

    // 1) Early economical stop: allowed only if <= half tank remains, unless saving is exceptional.
    const early=verified.filter(x=>x.along<normalStart&&x.along<=safeKm)
      .map(x=>({x,opp:earlyOpportunity(x,verified,ctx)})).filter(z=>z.opp)
      .sort((a,b)=>(b.opp.saving-a.opp.saving)||(baseScore(a.x)-baseScore(b.x)));
    let main,reasonType='normal',opportunity=null;
    if(early.length){main=early[0].x;opportunity=early[0].opp;reasonType='early'}
    else{
      // 2) Normal window near the reserve. Require a meaningful fill when tank size is known.
      let zone=verified.filter(x=>x.along>=normalStart&&x.along<=safeKm);
      if(Number.isFinite(ctx.tank)&&ctx.tank>0){
        const meaningful=zone.filter(x=>plannedFillLitres(ctx.tank,ctx.fuel,ctx.avg,x.along)>=ctx.tank*MIN_NORMAL_FILL_FRACTION);
        if(meaningful.length)zone=meaningful;
      }
      if(zone.length){
        // Within the window, choose economical + off-motorway, but prefer later if score is very similar.
        zone.sort((a,b)=>{const ds=baseScore(a)-baseScore(b);return Math.abs(ds)<0.015?(b.along-a.along):ds});
        main=zone[0];
      } else {
        // 3) Controlled reserve flex only if there is no good verified station before 10 l.
        let flex=verified.filter(x=>x.along>safeKm&&x.along<=extendedKm);
        if(flex.length){
          flex.sort((a,b)=>baseScore(a)-baseScore(b)||(a.along-b.along));
          main=flex[0]; reasonType='reserve-flex';
        } else {
          // 4) Last safely reachable verified group — do not fall back to an arbitrary early cheap station.
          const before=verified.filter(x=>x.along<=safeKm);
          if(!before.length)return {main:null,alts:[],reasonType:'none'};
          const furthest=Math.max(...before.map(x=>x.along));
          const late=before.filter(x=>x.along>=Math.max(0,furthest-80));
          main=bestByScore(late)||before.sort((a,b)=>b.along-a.along)[0];
          reasonType='late-safe';
        }
      }
    }
    return {main,alts:chooseAlternatives(verified,main,ctx),reasonType,opportunity};
  }

  function card(s,main=false,ctx={},label=''){
    const arrival=fuelAtArrival(ctx.fuel,ctx.avg,s.along);
    const verify=`<span class="rec-verified">✓ preverjena lokacija</span>`;
    const road=s.motorway===true?'avtocestna':s.motorway===false?'izven avtoceste':'tip ceste ni potrjen';
    const warn=arrival<RESERVE_L?`<div class="rec-warning">⚠ Posega v 10-litrsko varnostno rezervo.</div>`:'';
    const badge=label?`<div class="rec-badge${arrival<RESERVE_L?' danger':''}">${esc(label)}</div>`:'';
    return `<div class="recommend-card${main?' main':''}">${badge}<div class="rec-name">${esc(s.name)}</div><div class="rec-price">${esc(fmtPrice(s))}</div><div class="rec-verify">${verify}</div><div class="rec-meta"><span class="rec-route">čez približno ${slKm(s.along)} · ${slNum(s.off,1)} km s poti · ${road}</span><br><span>ob prihodu približno ${slL(arrival)} goriva</span>${s.address?`<br>${esc(s.address)}`:''}</div>${warn}<button type="button" data-show-rec="${esc(s.id)}">Pokaži na zemljevidu</button></div>`
  }

  async function refresh(){
    if(busy)return;busy=true;ui.panel.hidden=false;ui.status.textContent='Iščem in preverjam črpalke ob poti …';ui.main.innerHTML='';ui.alts.innerHTML='';ui.reason.textContent='';
    try{
      const d=window.ManniStorage.get(),route=d.route||{},avg=Number(d.vehicle?.averageConsumption),fuel=liveFuel(d),tank=Number(d.vehicle?.tankLitres),reserve=RESERVE_L;
      if(!route.destination)throw new Error('Najprej nastavi cilj poti.');
      if(!Number.isFinite(avg)||avg<=0||!Number.isFinite(fuel))throw new Error('Vnesi trenutno gorivo in povprečno porabo.');
      if(!route.destinationPoint || (route.via||[]).length!==(route.viaPoints||[]).length)throw new Error('Pot vsebuje nepotrjene točke. Odpri Pot in jih izberi iz predlogov.');
      if(d.journey?.routeValid===false)throw new Error('Pot ni potrjena. Najprej popravi označeni odsek poti.');
      const safeKm=Math.max(0,(fuel-reserve)/avg*100);
      const extendedKm=Math.max(safeKm,Math.max(0,(fuel-ABSOLUTE_MIN_L)/avg*100));
      if(extendedKm<15)throw new Error('Doseg do absolutne 8-litrske meje je zelo majhen — izberi najbližjo preverjeno črpalko.');

      const start=await pos();
      let pts=(d.journey?.resolvedPoints||[]).slice(d.journey?.nextIndex||0).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      if(!pts.length)pts=[...(route.viaPoints||[]),route.destinationPoint].map(p=>({lat:Number(p.lat),lon:Number(p.lon),name:p.label||p.name})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      const rt=await routeGeometry([start,...pts]),cum=cumulative(rt.line),samples=sample(rt.line,cum,Math.min(rt.km,extendedKm+80));
      ui.status.textContent=`Pregledujem naslednjih približno ${Math.round(Math.min(extendedKm,rt.km))} km …`;

      const batches=[];for(let i=0;i<samples.length;i+=4){const part=await Promise.all(samples.slice(i,i+4).map(x=>fetchAt(x,20)));batches.push(...part)}
      let stations=dedupe(norm(batches.flat())).map(s=>Object.assign(s,project(s,rt.line,cum))).filter(s=>s.off<=MAX_OFF_ROUTE_KM&&s.along>=0&&s.along<=extendedKm);
      if(!stations.length)throw new Error('V dosegu do absolutne 8-litrske meje nisem našel črpalke največ 5 km od poti.');

      // Verify candidates spread across the whole reachable route, not only the cheapest early cluster.
      const normalStart=Math.max(0,safeKm-NORMAL_ZONE_KM);
      const buckets=new Map();
      for(const x of stations){const k=Math.floor(x.along/100);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(x)}
      const spread=[];
      for(const arr of buckets.values()){
        arr.sort((a,b)=>(a.price-b.price)||(a.off-b.off));
        spread.push(...arr.slice(0,3));
      }
      const late=[...stations].filter(x=>x.along>=normalStart).sort((a,b)=>b.along-a.along).slice(0,8);
      const verifySet=dedupe([...spread,...late]).sort((a,b)=>a.along-b.along).slice(0,30);
      ui.status.textContent='Preverjam, ali priporočene lokacije res obstajajo …';
      const evidence=await osmEvidence(verifySet);
      verifySet.forEach(s=>{const e=evidence.get(s.id)||{};s.verifyStatus=e.status||'unverified';s.verified=s.verifyStatus==='verified';s.motorway=e.motorway;s.osmDistanceKm=e.distanceKm;s.verifyScore=e.score||0});

      const verifiedCount=verifySet.filter(x=>x.verified).length;
      if(!verifiedCount)throw new Error('V varnem dosegu ni dovolj zanesljivo preverjene črpalke za avtomatsko priporočilo. Postaje lahko še vedno pregledaš na zemljevidu.');

      const verifiedStations=verifySet.filter(x=>x.verified);
      const currencies=[...new Set(verifiedStations.map(x=>x.currency))];
      const fx=await fxTable(currencies);
      verifiedStations.forEach(x=>{x.priceEur=eurPrice(x,fx)});
      const rankingPool=verifiedStations.filter(x=>Number.isFinite(x.priceEur));
      const missingFx=currencies.filter(c=>c!=='EUR'&&!Number.isFinite(fx[c]));
      const picked=pickRecommendations(rankingPool,{tank,fuel,avg,safeKm,extendedKm});
      if(!picked.main)throw new Error('Nisem našel dovolj zanesljive črpalke za priporočilo.');
      const main=picked.main,alts=picked.alts;
      window.__manniRecommendations=[main,...alts];
      ui.main.innerHTML=card(main,true,{fuel,avg},'PRIPOROČENO');
      ui.alts.innerHTML=alts.map((x,i)=>{const a=fuelAtArrival(fuel,avg,x.along);const label=i===0?'PREJŠNJA MOŽNOST':(a<RESERVE_L?'SKRAJNA MOŽNOST':'KASNEJŠA MOŽNOST');return card(x,false,{fuel,avg},label)}).join('');

      const arrival=fuelAtArrival(fuel,avg,main.along),marginL=arrival-reserve;
      let reason='';
      if(picked.reasonType==='early'&&picked.opportunity){
        reason=`Zgodnejše ekonomično tankanje: ob prihodu boš lahko natočil približno ${slL(picked.opportunity.fill)}; ocenjeni prihranek je približno ${slEur(picked.opportunity.saving)} (${slNum(picked.opportunity.diff,2)} €/l manj kot najcenejša preverjena možnost v naslednjih približno ${EARLY_LOOKAHEAD_KM} km).${picked.opportunity.exceptional?' Gre za izjemno cenovno priložnost, zato je priporočilo dovoljeno tudi nekoliko prej.':''}`;
      }else if(picked.reasonType==='reserve-flex'){
        reason=`Naslednja smiselna preverjena črpalka je malo za normalno 10-litrsko rezervo. Manni uporabi del rezerve, vendar največ 20 %: ob prihodu ostane približno ${slL(arrival)}. Absolutna meja je ${slL(ABSOLUTE_MIN_L)}.`;
      }else{
        reason=`Tankanje je izbrano v varnem območju pred 10-litrsko rezervo. Ob prihodu ostane približno ${slL(arrival)} oziroma ${slL(Math.max(0,marginL))} nad rezervo.`;
      }
      if(main.motorway===false)reason+=' Prednost ima preverjena črpalka izven avtocestnega servisnega območja.';
      else if(main.motorway===true)reason+=' Gre za avtocestno črpalko; izbrana je bila, ker preverjena varnejša oziroma smiselnejša možnost izven avtoceste ni bila boljša.';
      if(currencies.length>1)reason+=' Cene različnih valut so za primerjavo preračunane v EUR po dnevnem referenčnem tečaju.';
      if(missingFx.length)reason+=` Za ${missingFx.join(', ')} menjalnega tečaja trenutno nisem dobil, zato teh kandidatov ne uporabljam v avtomatskem izboru.`;
      ui.reason.textContent=reason;
      const lastKey='manni.smartFuel.lastRecommendation';
      const previous=localStorage.getItem(lastKey);
      const changed=previous&&previous!==main.id;
      localStorage.setItem(lastKey,main.id);
      ui.status.textContent=`✓ ${verifiedCount} preverjenih kandidatov · normalno okno tankanja približno ${Math.round(Math.max(0,safeKm-NORMAL_ZONE_KM))}–${Math.round(safeKm)} km${changed?' · priporočilo se je po osvežitvi spremenilo':''}`;
    }catch(e){ui.main.innerHTML=`<div class="recommend-empty">${esc(e.message||'Priporočila ni bilo mogoče izračunati.')}</div>`;ui.alts.innerHTML='';ui.reason.textContent='';ui.status.textContent='Priporočilo ni na voljo.'}
    finally{busy=false}
  }

  ui.panel.addEventListener('click',e=>{const b=e.target.closest('[data-show-rec]');if(!b)return;const s=(window.__manniRecommendations||[]).find(x=>x.id===b.dataset.showRec);if(s)window.dispatchEvent(new CustomEvent('manni:show-station',{detail:s}))});
  // Recommendation must run only AFTER journey/checkpoint recalculation is complete.
  window.addEventListener('manni:route-changed',()=>setTimeout(refresh,1200));
  window.addEventListener('manni:fuel-changed',()=>setTimeout(refresh,600));
  window.addEventListener('manni:route-validated',e=>{if(e.detail?.valid)setTimeout(refresh,350);else{ui.panel.hidden=false;ui.status.textContent='Priporočilo čaka na potrjeno pot.';ui.main.innerHTML='<div class="recommend-empty">Najprej popravi označeni odsek poti.</div>';ui.alts.innerHTML='';ui.reason.textContent=''}});
  setTimeout(()=>{const d=window.ManniStorage.get();if(d.route?.destination)refresh()},2800);
  console.info('Manni 3.16 smart refuel window ready');
})();
