// Manni's World 3.18 — conservative local price sanity checks.
// Philosophy: never remove a station merely because OSM/FX is temporarily unavailable.
// Only hide a price outlier when we have enough comparable nearby peers in the same road environment.
(function(){
  const OVERPASS='https://overpass-api.de/api/interpreter';
  const FX_API='https://api.frankfurter.dev/v2/rates';
  const MATCH_FUEL_KM=0.30;
  const MOTORWAY_NEAR_KM=0.70;
  const PEER_RADIUS_KM=45;
  const MIN_PEERS=5; // including the candidate
  const LOW_FACTOR=0.75;  // >25% below local median -> implausibly low
  const HIGH_FACTOR=1.45; // >45% above local median -> implausibly high after road-type split

  const rad=x=>x*Math.PI/180;
  function hav(a,b){const R=6371,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon),x=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  function median(v){const a=v.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}

  async function fxTable(stations){
    const out={EUR:1};
    const needed=[...new Set((stations||[]).map(s=>String(s.currency||'EUR').toUpperCase()).filter(c=>c&&c!=='EUR'))];
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
    if(!Number.isFinite(Number(s.price)))return null;
    const cur=String(s.currency||'EUR').toUpperCase();
    if(cur==='EUR')return Number(s.price);
    const rate=Number(fx?.[cur]);
    return Number.isFinite(rate)&&rate>0?Number(s.price)/rate:null;
  }

  async function roadClasses(stations){
    const out=new Map((stations||[]).map(s=>[s.id,{roadClass:'unknown',osmMatched:false}]));
    if(!stations?.length)return out;
    const lats=stations.map(s=>s.lat),lons=stations.map(s=>s.lon);
    const south=Math.min(...lats)-.015,north=Math.max(...lats)+.015,west=Math.min(...lons)-.02,east=Math.max(...lons)+.02;
    const q=`[out:json][timeout:15];(nwr[amenity=fuel](${south},${west},${north},${east});nwr[highway=services](${south},${west},${north},${east});nwr[highway=rest_area](${south},${west},${north},${east}););out center tags;`;
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),13000);
    try{
      const r=await fetch(OVERPASS+'?data='+encodeURIComponent(q),{signal:ctl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw 0;
      const j=await r.json(),fuels=[],services=[];
      for(const e of j.elements||[]){const lat=Number(e.lat??e.center?.lat),lon=Number(e.lon??e.center?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const tags=e.tags||{},x={lat,lon,tags};if(tags.amenity==='fuel')fuels.push(x);if(tags.highway==='services'||tags.highway==='rest_area')services.push(x)}
      for(const s of stations){
        let nearestFuel=null;
        for(const f of fuels){const d=hav(s,f);if(!nearestFuel||d<nearestFuel.d)nearestFuel={f,d}}
        if(!nearestFuel||nearestFuel.d>MATCH_FUEL_KM)continue;
        const motorway=services.some(x=>hav(nearestFuel.f,x)<=MOTORWAY_NEAR_KM||hav(s,x)<=MOTORWAY_NEAR_KM);
        out.set(s.id,{roadClass:motorway?'motorway':'offmotorway',osmMatched:true});
      }
    }catch(e){/* no classification => no price hiding */}
    finally{clearTimeout(timer)}
    return out;
  }

  function applyLocalSanity(stations,fx,classes){
    const enriched=(stations||[]).map(s=>{
      const meta=classes?.get(s.id)||{roadClass:'unknown',osmMatched:false};
      return {...s,priceEur:eurPrice(s,fx),roadClass:meta.roadClass,osmMatched:meta.osmMatched,priceSanity:'unchecked',priceMedianEur:null,priceDeviation:null};
    });
    const visible=[],hidden=[];
    for(const s of enriched){
      if(!Number.isFinite(s.priceEur)||s.roadClass==='unknown') {visible.push(s);continue}
      const peers=enriched.filter(p=>p.id!==undefined&&p.country===s.country&&p.roadClass===s.roadClass&&Number.isFinite(p.priceEur)&&hav(s,p)<=PEER_RADIUS_KM);
      if(peers.length<MIN_PEERS){s.priceSanity='insufficient-peers';visible.push(s);continue}
      const med=median(peers.map(p=>p.priceEur));
      if(!Number.isFinite(med)||med<=0){visible.push(s);continue}
      s.priceMedianEur=med;s.priceDeviation=(s.priceEur-med)/med;
      const suspicious=s.priceEur<med*LOW_FACTOR||s.priceEur>med*HIGH_FACTOR;
      if(suspicious){s.priceSanity='outlier';hidden.push(s)} else {s.priceSanity='ok';visible.push(s)}
    }
    return {visible,hidden,enriched};
  }

  async function sanitizeForMap(stations){
    const fx=await fxTable(stations||[]);
    const classes=await roadClasses((stations||[]).filter(s=>s.price!=null));
    const result=applyLocalSanity(stations||[],fx,classes);
    return {...result,fx,classes};
  }

  // Recommendation module already knows motorway/off-motorway from its own verification pass.
  // Use that classification and the same conservative peer logic without another OSM request.
  function sanitizeVerifiedCandidates(stations){
    const classes=new Map((stations||[]).map(s=>[s.id,{roadClass:s.motorway===true?'motorway':s.motorway===false?'offmotorway':'unknown',osmMatched:!!s.verified}]));
    const fx={EUR:1}; // priceEur is already supplied by recommendation.js, so preserve it below.
    const mapped=(stations||[]).map(s=>({...s,price:s.price,priceEur:s.priceEur}));
    const enriched=mapped.map(s=>{const meta=classes.get(s.id)||{};return {...s,roadClass:meta.roadClass||'unknown',osmMatched:!!meta.osmMatched,priceSanity:'unchecked',priceMedianEur:null,priceDeviation:null}});
    const visible=[],hidden=[];
    for(const s of enriched){
      if(!Number.isFinite(s.priceEur)||s.roadClass==='unknown'){visible.push(s);continue}
      const peers=enriched.filter(p=>p.country===s.country&&p.roadClass===s.roadClass&&Number.isFinite(p.priceEur)&&Math.abs((p.along??0)-(s.along??0))<=120);
      if(peers.length<MIN_PEERS){s.priceSanity='insufficient-peers';visible.push(s);continue}
      const med=median(peers.map(p=>p.priceEur));if(!Number.isFinite(med)||med<=0){visible.push(s);continue}
      s.priceMedianEur=med;s.priceDeviation=(s.priceEur-med)/med;
      if(s.priceEur<med*LOW_FACTOR||s.priceEur>med*HIGH_FACTOR){s.priceSanity='outlier';hidden.push(s)} else {s.priceSanity='ok';visible.push(s)}
    }
    return {visible,hidden,enriched};
  }

  window.ManniPriceSanity={fxTable,eurPrice,sanitizeForMap,sanitizeVerifiedCandidates,constants:{PEER_RADIUS_KM,MIN_PEERS,LOW_FACTOR,HIGH_FACTOR}};
})();
