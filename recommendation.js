// Manni's World 3.26 — resilient verification retry (positive cache only)
// IMPORTANT: the map may show all Pumperly stations. This module is deliberately stricter:
// it recommends only stations whose physical location is independently confirmed in OSM.
(function(){
  const $=id=>document.getElementById(id);
  const ui={panel:$('recommendPanel'),status:$('recommendStatus'),main:$('recommendMain'),alts:$('recommendAlternatives'),reason:$('recommendReason')};
  if(!ui.panel||!window.ManniStorage)return;

  const API=(localStorage.getItem('manniApiBase')||'https://manni-fuel-api.ratejbojan.workers.dev').replace(/\/$/,'');
  const OSRM='https://router.project-osrm.org/route/v1/driving/';
  const OVERPASS_ENDPOINTS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  const VERIFY_CACHE_KEY='manni.smartFuel.osmVerify.v1';
  const VERIFY_CACHE_DAYS=30;
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
  const BORDER_MIN_DIFF_EUR=0.06;       // only react to a meaningful cross-border price gap
  const BORDER_MIN_DIFF_FRACTION=0.04;  // or at least 4% between comparable country medians
  const BORDER_ZONE_KM=180;             // stations considered around a border decision
  const BORDER_MIN_FILL_FRACTION=0.35;  // do not stop very early just because a border is cheaper
  const BORDER_MIN_SAVING_EUR=5;        // estimated real saving required for an early border stop
  const VERIFY_RADIUS_M=300;
  let busy=false;
  let rerunRequested=false;

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

  // Verification is intentionally strict, but requests are split into small batches.
  // Successful evidence is cached locally so a temporary Overpass outage does not erase Smart Fuel.
  function verifyCache(){
    try{return JSON.parse(localStorage.getItem(VERIFY_CACHE_KEY)||'{}')||{}}catch(e){return {}}
  }
  function verifyKey(s){return `${Number(s.lat).toFixed(4)},${Number(s.lon).toFixed(4)}|${normText(s.name)}|${normText(s.brand)}`}
  function cachedEvidence(stations){
    const c=verifyCache(),out=new Map(),maxAge=VERIFY_CACHE_DAYS*864e5,now=Date.now();
    for(const s of stations){
      const x=c[verifyKey(s)];
      if(x&&Number.isFinite(x.savedAt)&&now-x.savedAt<=maxAge)out.set(s.id,{status:x.status,distanceKm:x.distanceKm??null,score:x.score||0,motorway:x.motorway??null,osm:x.osm||null,cached:true});
    }
    return out;
  }
  function saveEvidence(stations,map){
    const c=verifyCache(),now=Date.now();
    for(const s of stations){const x=map.get(s.id);if(!x||x.status!=='verified')continue;c[verifyKey(s)]={...x,savedAt:now,cached:undefined}}
    try{localStorage.setItem(VERIFY_CACHE_KEY,JSON.stringify(c))}catch(e){}
  }
  async function queryEvidenceBatch(stations){
    const out=new Map(stations.map(s=>[s.id,{status:'unverified',distanceKm:null,score:0,motorway:null,osm:null}]));
    if(!stations.length)return {out,ok:true};
    const clauses=[];
    for(const s of stations){
      clauses.push(`nwr(around:${VERIFY_RADIUS_M},${s.lat},${s.lon})[amenity=fuel];`);
      clauses.push(`nwr(around:550,${s.lat},${s.lon})[highway=services];`);
      clauses.push(`nwr(around:550,${s.lat},${s.lon})[highway=rest_area];`);
    }
    const q=`[out:json][timeout:12];(${clauses.join('')});out center tags;`;
    let payload=null;
    for(const endpoint of OVERPASS_ENDPOINTS){
      const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),12000);
      try{
        const r=await fetch(endpoint+'?data='+encodeURIComponent(q),{signal:ctl.signal,headers:{Accept:'application/json'}});
        if(!r.ok)throw new Error('overpass');
        payload=await r.json();clearTimeout(tm);break;
      }catch(e){clearTimeout(tm)}
    }
    if(!payload)return {out,ok:false};
    const fuels=[],services=[];
    for(const e of payload.elements||[]){const lat=Number(e.lat??e.center?.lat),lon=Number(e.lon??e.center?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const tags=e.tags||{},x={lat,lon,tags};if(tags.amenity==='fuel')fuels.push(x);if(tags.highway==='services'||tags.highway==='rest_area')services.push(x)}
    // An HTTP 200 with no nearby fuel objects is not strong enough evidence that all candidates are false.
    // Treat the batch as indeterminate so we can retry the important candidates individually.
    if(!fuels.length)return {out,ok:false};
    for(const s of stations){
      let best=null;
      for(const f of fuels){const d=hav(s,f),score=Math.max(nameScore(s.name,f.tags.name),nameScore(s.brand,f.tags.brand),nameScore(s.name,f.tags.brand),nameScore(s.brand,f.tags.name));if(!best||d<best.d||(Math.abs(d-best.d)<.03&&score>best.score))best={f,d,score}}
      const motorway=services.some(x=>hav(s,x)<=.55);
      if(!best){out.set(s.id,{status:'mismatch',distanceKm:null,score:0,motorway,osm:null});continue}
      const verified=(best.d<=.055)||(best.d<=.18&&best.score>=.25);
      const status=verified?'verified':(best.d<=.30?'unverified':'mismatch');
      out.set(s.id,{status,distanceKm:best.d,score:best.score,motorway,osm:best.f});
    }
    return {out,ok:true};
  }
  async function osmEvidence(stations){
    const final=new Map(stations.map(s=>[s.id,{status:'unverified',distanceKm:null,score:0,motorway:null,osm:null}]));
    if(!stations.length)return final;
    const cache=cachedEvidence(stations);
    for(const [id,x] of cache)final.set(id,x);
    const need=stations.filter(s=>!cache.has(s.id));
    let liveOk=0;
    // Small batches are much more reliable on mobile than one giant Overpass request.
    for(let i=0;i<need.length;i+=6){
      const batch=need.slice(i,i+6),res=await queryEvidenceBatch(batch);
      if(res.ok){liveOk++;for(const [id,x] of res.out)final.set(id,x);saveEvidence(batch,res.out)}
    }
    final._meta={cached:cache.size,liveBatches:liveOk,totalBatches:Math.ceil(need.length/6)};
    return final;
  }


  async function retryImportantStations(stations,existing){
    // Retry a small shortlist one-by-one with a wider radius. This avoids a temporary/partial
    // Overpass batch response removing Smart Fuel entirely.
    const out=new Map(existing||[]);
    const candidates=stations.filter(s=>(out.get(s.id)?.status||'unverified')!=='verified').slice(0,10);
    for(const s of candidates){
      const q=`[out:json][timeout:10];(nwr(around:450,${s.lat},${s.lon})[amenity=fuel];nwr(around:700,${s.lat},${s.lon})[highway=services];nwr(around:700,${s.lat},${s.lon})[highway=rest_area];);out center tags;`;
      let payload=null;
      for(const endpoint of OVERPASS_ENDPOINTS){
        const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),10000);
        try{const r=await fetch(endpoint+'?data='+encodeURIComponent(q),{signal:ctl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw new Error('overpass');payload=await r.json();clearTimeout(tm);break}catch(e){clearTimeout(tm)}
      }
      if(!payload)continue;
      const fuels=[],services=[];
      for(const e of payload.elements||[]){const lat=Number(e.lat??e.center?.lat),lon=Number(e.lon??e.center?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const tags=e.tags||{},x={lat,lon,tags};if(tags.amenity==='fuel')fuels.push(x);if(tags.highway==='services'||tags.highway==='rest_area')services.push(x)}
      if(!fuels.length)continue;
      let best=null;
      for(const f of fuels){const d=hav(s,f),score=Math.max(nameScore(s.name,f.tags.name),nameScore(s.brand,f.tags.brand),nameScore(s.name,f.tags.brand),nameScore(s.brand,f.tags.name));if(!best||d<best.d||(Math.abs(d-best.d)<.03&&score>best.score))best={f,d,score}}
      const motorway=services.some(x=>hav(s,x)<=.7);
      if(best){
        // Wider retry threshold, but still require a plausible physical fuel POI nearby.
        const verified=(best.d<=.12)||(best.d<=.30&&best.score>=.25);
        if(verified){const ev={status:'verified',distanceKm:best.d,score:best.score,motorway,osm:best.f};out.set(s.id,ev);saveEvidence([s],new Map([[s.id,ev]]))}
      }
    }
    return out;
  }


  const COUNTRY_NAMES={
    SI:'Slovenija',AT:'Avstrija',CZ:'Češka',PL:'Poljska',SK:'Slovaška',HU:'Madžarska',HR:'Hrvaška',
    IT:'Italija',DE:'Nemčija',FR:'Francija',CH:'Švica',NL:'Nizozemska',BE:'Belgija',LU:'Luksemburg',
    DK:'Danska',SE:'Švedska',NO:'Norveška',FI:'Finska',EE:'Estonija',LV:'Latvija',LT:'Litva',
    RO:'Romunija',BG:'Bolgarija',RS:'Srbija',BA:'BiH',GR:'Grčija',ES:'Španija',PT:'Portugalska'
  };
  function median(v){const a=v.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
  function countryName(c){return COUNTRY_NAMES[String(c||'').toUpperCase()]||String(c||'').toUpperCase()}
  function countryGroups(stations){
    const m=new Map();
    for(const s of stations){
      const c=String(s.country||'').toUpperCase();
      if(!c)continue;
      if(!m.has(c))m.set(c,[]);
      m.get(c).push(s);
    }
    const groups=[];
    for(const [country,items] of m){
      const sorted=[...items].sort((a,b)=>a.along-b.along);
      const off=sorted.filter(x=>x.motorway===false&&Number.isFinite(x.priceEur));
      const priced=(off.length>=2?off:sorted.filter(x=>Number.isFinite(x.priceEur)));
      const med=median(priced.map(x=>x.priceEur));
      if(!Number.isFinite(med)||!sorted.length)continue;
      groups.push({country,items:sorted,minAlong:sorted[0].along,maxAlong:sorted[sorted.length-1].along,medianEur:med,peerCount:priced.length});
    }
    return groups.sort((a,b)=>a.minAlong-b.minAlong);
  }
  function borderTransitions(stations,extendedKm){
    const groups=countryGroups(stations).filter(g=>g.minAlong<=extendedKm+80);
    const out=[];
    for(let i=0;i<groups.length-1;i++){
      const a=groups[i],b=groups[i+1];
      if(a.country===b.country)continue;
      // If groups overlap around the border, use the first station of the next country; otherwise midpoint the gap.
      const borderKm=a.maxAlong<b.minAlong?(a.maxAlong+b.minAlong)/2:b.minAlong;
      if(borderKm<0||borderKm>extendedKm+80)continue;
      out.push({from:a,to:b,borderKm,diff:b.medianEur-a.medianEur,absDiff:Math.abs(b.medianEur-a.medianEur)});
    }
    return out;
  }
  function borderStrategy(stations,ctx){
    if(!Number.isFinite(ctx.tank)||ctx.tank<=0)return null;
    const transitions=borderTransitions(stations,ctx.extendedKm);
    for(const t of transitions){
      const rel=t.absDiff/Math.max(.01,Math.min(t.from.medianEur,t.to.medianEur));
      if(t.absDiff<BORDER_MIN_DIFF_EUR&&rel<BORDER_MIN_DIFF_FRACTION)continue;
      const cheaperBefore=t.diff>0;
      let pool;
      if(cheaperBefore){
        pool=stations.filter(x=>x.country===t.from.country&&x.along<=Math.min(t.borderKm,ctx.extendedKm)&&x.along>=Math.max(0,t.borderKm-BORDER_ZONE_KM));
      }else{
        pool=stations.filter(x=>x.country===t.to.country&&x.along>=Math.max(0,t.borderKm)&&x.along<=Math.min(ctx.extendedKm,t.borderKm+BORDER_ZONE_KM));
      }
      pool=pool.filter(x=>x.verified&&Number.isFinite(x.priceEur));
      if(!pool.length)continue;
      // Border logic must not force a silly top-up while the tank is still nearly full.
      const viable=pool.filter(x=>{
        const fill=plannedFillLitres(ctx.tank,ctx.fuel,ctx.avg,x.along);
        const saving=t.absDiff*fill;
        const enoughFill=fill>=ctx.tank*BORDER_MIN_FILL_FRACTION;
        return enoughFill||saving>=BORDER_MIN_SAVING_EUR;
      });
      if(!viable.length)continue;
      const main=bestByScore(viable);
      if(!main)continue;
      return {main,transition:t,direction:cheaperBefore?'before':'after',pool:viable};
    }
    return null;
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
    // Alternatives have explicit roles. Never relabel a later station as an earlier one (or vice versa).
    // If a meaningful station does not exist on one side of the main recommendation, show fewer cards.
    const earlier=verified.filter(x=>x.id!==main.id&&x.along<=main.along-ALT_MIN_GAP_KM&&x.along>=Math.max(0,main.along-300));
    const later=verified.filter(x=>x.id!==main.id&&x.along>=main.along+ALT_MIN_GAP_KM&&x.along<=ctx.extendedKm);
    let earlierPick=null,laterPick=null;
    if(earlier.length){
      // Prefer a useful later part of the earlier window, then price/off-route score.
      const latest=Math.max(...earlier.map(x=>x.along));
      earlierPick=bestByScore(earlier.filter(x=>x.along>=latest-90));
    }
    if(later.length){
      // Prefer a genuinely later option, but never below the absolute 8 l boundary already encoded in extendedKm.
      const latest=Math.max(...later.map(x=>x.along));
      laterPick=bestByScore(later.filter(x=>x.along>=latest-90));
    }
    const out=[];
    if(earlierPick)out.push(Object.assign({},earlierPick,{_altRole:'earlier'}));
    if(laterPick)out.push(Object.assign({},laterPick,{_altRole:'later'}));
    return out;
  }
  function pickRecommendations(stations,ctx){
    const verified=stations.filter(x=>x.verified&&x.along<=ctx.extendedKm&&Number.isFinite(x.priceEur));
    if(!verified.length)return {main:null,alts:[],reasonType:'none'};
    const safeKm=ctx.safeKm,extendedKm=ctx.extendedKm;
    const normalStart=Math.max(0,safeKm-NORMAL_ZONE_KM);

    // 0) BORDER-FIRST strategy: compare comparable verified prices in the country before/after a border.
    // Only if the price gap is meaningful and the real amount we can fill makes the stop worthwhile.
    const border=borderStrategy(verified,ctx);
    if(border){
      return {main:border.main,alts:chooseAlternatives(verified,border.main,ctx),reasonType:border.direction==='before'?'border-before':'border-after',border};
    }

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
    const inReserve=arrival < (RESERVE_L-0.05);
    const warn=inReserve?`<div class="rec-warning">⚠ Posega v 10-litrsko varnostno rezervo.</div>`:'';
    const badge=label?`<div class="rec-badge${inReserve?' danger':''}">${esc(label)}</div>`:'';
    return `<div class="recommend-card${main?' main':''}">${badge}<div class="rec-name">${esc(s.name)}</div><div class="rec-price">${esc(fmtPrice(s))}</div><div class="rec-verify">${verify}</div><div class="rec-meta"><span class="rec-route">čez približno ${slKm(s.along)} · ${slNum(s.off,1)} km s poti · ${road}</span><br><span>ob prihodu približno ${slL(arrival)} goriva</span>${s.address?`<br>${esc(s.address)}`:''}</div>${warn}<button type="button" data-show-rec="${esc(s.id)}">Pokaži na zemljevidu</button></div>`
  }

  async function refresh(){
    if(busy){rerunRequested=true;ui.panel.hidden=false;ui.status.textContent='Preračunavam …';return;}
    busy=true;rerunRequested=false;ui.panel.hidden=false;ui.status.textContent='Preračunavam …';ui.main.innerHTML='<div class="recommend-empty">Preverjam pot, doseg, cene in črpalke …</div>';ui.alts.innerHTML='';ui.reason.textContent='';
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
      let evidence=await osmEvidence(verifySet);
      const verifyMeta=evidence._meta||{cached:0,liveBatches:0,totalBatches:0};
      verifySet.forEach(s=>{const e=evidence.get(s.id)||{};s.verifyStatus=e.status||'unverified';s.verified=s.verifyStatus==='verified';s.motorway=e.motorway;s.osmDistanceKm=e.distanceKm;s.verifyScore=e.score||0});

      let verifiedCount=verifySet.filter(x=>x.verified).length;
      if(!verifiedCount){
        ui.status.textContent='Prvi pregled ni potrdil dovolj lokacij — preverjam najboljše kandidate še enkrat …';
        evidence=await retryImportantStations(verifySet,evidence);
        verifySet.forEach(s=>{const e=evidence.get(s.id)||{};s.verifyStatus=e.status||'unverified';s.verified=s.verifyStatus==='verified';s.motorway=e.motorway;s.osmDistanceKm=e.distanceKm;s.verifyScore=e.score||0});
        verifiedCount=verifySet.filter(x=>x.verified).length;
      }
      if(!verifiedCount){const extra=verifyMeta.totalBatches&&verifyMeta.liveBatches===0&&verifyMeta.cached===0?' OSM trenutno ni vrnil dovolj podatkov; poskusi Osveži čez nekaj sekund.':'';throw new Error('V dosegu sem našel črpalke, vendar trenutno nobene ne morem dovolj zanesljivo potrditi za avtomatsko priporočilo.'+extra)}

      const verifiedStations=verifySet.filter(x=>x.verified);
      const currencies=[...new Set(verifiedStations.map(x=>x.currency))];
      const fx=await fxTable(currencies);
      verifiedStations.forEach(x=>{x.priceEur=eurPrice(x,fx)});
      let rankingPool=verifiedStations.filter(x=>Number.isFinite(x.priceEur));
      if(window.ManniPriceSanity){
        const sane=window.ManniPriceSanity.sanitizeVerifiedCandidates(rankingPool);
        rankingPool=sane.visible||rankingPool;
        if(sane.hidden?.length)console.info('Smart Fuel: izločene sumljive cene',sane.hidden.map(x=>({name:x.name,price:x.price,currency:x.currency,deviation:x.priceDeviation})));
      }
      const missingFx=currencies.filter(c=>c!=='EUR'&&!Number.isFinite(fx[c]));
      const picked=pickRecommendations(rankingPool,{tank,fuel,avg,safeKm,extendedKm});
      if(!picked.main)throw new Error('Nisem našel dovolj zanesljive črpalke za priporočilo.');
      const main=picked.main,alts=picked.alts;
      window.__manniRecommendations=[main,...alts];
      ui.main.innerHTML=card(main,true,{fuel,avg},'PRIPOROČENO');
      ui.alts.innerHTML=alts.map(x=>{const a=fuelAtArrival(fuel,avg,x.along);let label=x._altRole==='earlier'?'PREJŠNJA MOŽNOST':'KASNEJŠA MOŽNOST';if(x._altRole==='later'&&a<(RESERVE_L-0.05))label='SKRAJNA MOŽNOST';return card(x,false,{fuel,avg},label)}).join('');

      const arrival=fuelAtArrival(fuel,avg,main.along),marginL=arrival-reserve;
      let reason='';
      if((picked.reasonType==='border-before'||picked.reasonType==='border-after')&&picked.border){
        const t=picked.border.transition;
        const from=countryName(t.from.country),to=countryName(t.to.country);
        const gap=slNum(t.absDiff,2);
        if(picked.reasonType==='border-before'){
          reason=`Strategija pred mejo: preverjene primerljive črpalke v ${from} so pred vstopom v ${to} trenutno približno ${gap} €/l cenejše. Zato Manni najprej izbere smiselno preverjeno črpalko pred mejo, če lahko natočiš dovolj goriva in ostaneš znotraj varnega dosega.`;
        }else{
          reason=`Strategija po meji: preverjene primerljive črpalke v ${to} so trenutno približno ${gap} €/l cenejše kot v ${from}. Ker imaš dovolj dosega, Manni priporoča, da z glavnim tankanjem počakaš do ${to}.`;
        }
      }else if(picked.reasonType==='early'&&picked.opportunity){
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
      const priceRejected=Math.max(0,verifiedStations.filter(x=>Number.isFinite(x.priceEur)).length-rankingPool.length);
      const borderStatus=picked.border?` · meja ${countryName(picked.border.transition.from.country)} → ${countryName(picked.border.transition.to.country)} upoštevana`:'';
      ui.status.textContent=`✓ ${rankingPool.length} preverjenih kandidatov z verodostojno ceno · OSM ${verifyMeta.cached?'cache '+verifyMeta.cached:'v živo'}${priceRejected?` · ${priceRejected} sumljivih cen izločenih`:''}${borderStatus} · normalno okno tankanja približno ${Math.round(Math.max(0,safeKm-NORMAL_ZONE_KM))}–${Math.round(safeKm)} km${changed?' · priporočilo se je po osvežitvi spremenilo':''}`;
    }catch(e){const msg=e.message||'Priporočila ni bilo mogoče izračunati.';ui.main.innerHTML=`<div class="recommend-empty">${esc(msg)}</div>`;ui.alts.innerHTML='';ui.reason.textContent='';ui.status.textContent=`Priporočilo ni na voljo · ${msg}`}
    finally{
      busy=false;
      if(rerunRequested){rerunRequested=false;setTimeout(refresh,80)}
    }
  }

  ui.panel.addEventListener('click',e=>{const b=e.target.closest('[data-show-rec]');if(!b)return;const s=(window.__manniRecommendations||[]).find(x=>x.id===b.dataset.showRec);if(!s)return;const dlg=b.closest('dialog');if(dlg&&dlg.open)dlg.close();setTimeout(()=>window.dispatchEvent(new CustomEvent('manni:show-station',{detail:s})),120)});
  // Recommendation must run only AFTER journey/checkpoint recalculation is complete.
  window.addEventListener('manni:route-opened',()=>{
    ui.panel.hidden=false;
    ui.status.textContent='Preračunavam …';
    setTimeout(refresh,40);
  });
  window.addEventListener('manni:route-changed',()=>setTimeout(refresh,1200));
  window.addEventListener('manni:fuel-changed',()=>setTimeout(refresh,600));
  window.addEventListener('manni:route-validated',e=>{if(e.detail?.valid)setTimeout(refresh,350);else{ui.panel.hidden=false;ui.status.textContent='Priporočilo čaka na potrjeno pot.';ui.main.innerHTML='<div class="recommend-empty">Najprej popravi označeni odsek poti.</div>';ui.alts.innerHTML='';ui.reason.textContent=''}});
  setTimeout(()=>{const d=window.ManniStorage.get();if(d.route?.destination)refresh()},2800);
  console.info('Manni 3.24 Smart Fuel refresh-on-open ready');
})();
