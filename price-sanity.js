// Manni's World 3.20 — dual price sanity: local peer group + national diesel benchmark.
// National reference: European Commission Weekly Oil Bulletin, prices with taxes, week of 10 Aug 2026.
// Safety philosophy:
// 1) Motorway and off-motorway stations are compared separately for LOCAL outliers.
// 2) A clearly implausibly LOW price can also be rejected against the NATIONAL benchmark.
//    We deliberately do NOT reject a high price from the national benchmark alone, because motorway
//    stations can legitimately carry a substantial premium.
// 3) When a national reference becomes old, the national gate switches itself off automatically;
//    local peer sanity keeps working. This avoids hiding legitimate stations on stale benchmarks.
(function(){
  const OVERPASS='https://overpass-api.de/api/interpreter';
  const FX_API='https://api.frankfurter.dev/v2/rates';
  const MATCH_FUEL_KM=0.30;
  const MOTORWAY_NEAR_KM=0.70;
  const PEER_RADIUS_KM=45;
  const MIN_PEERS=5; // including candidate
  const LOCAL_LOW_FACTOR=0.75;   // >25% below same-road local median => local outlier
  const LOCAL_HIGH_FACTOR=1.45;  // >45% above same-road local median => local outlier
  const NATIONAL_LOW_FACTOR=0.80; // >20% below weekly country average => implausibly low
  const NATIONAL_MAX_AGE_DAYS=35; // after this, national gate disables itself instead of using stale data
  const NATIONAL_REFERENCE_DATE='2026-08-10';

  // EUR/l, diesel, taxes included. European Commission Weekly Oil Bulletin, week 10 Aug 2026.
  const NATIONAL_DIESEL_EUR={
    AT:1.9650, BE:2.1568, BG:1.7426, HR:1.9030, CY:1.7833, CZ:1.8132,
    DK:2.1429, EE:1.8250, FI:2.3342, FR:2.1690, DE:2.1490, GR:1.9860,
    HU:1.8121, IE:1.9006, IT:2.0808, LV:1.8980, LT:1.9960, LU:1.7980,
    MT:1.2100, NL:2.3227, PL:1.8638, PT:1.9750, RO:2.0128, SK:1.8330,
    SI:1.8776, ES:1.8216, SE:1.6802
  };
  const COUNTRY_ALIASES={
    AUSTRIA:'AT',BELGIUM:'BE',BULGARIA:'BG',CROATIA:'HR',CYPRUS:'CY',CZECHIA:'CZ','CZECH REPUBLIC':'CZ',
    DENMARK:'DK',ESTONIA:'EE',FINLAND:'FI',FRANCE:'FR',GERMANY:'DE',GREECE:'GR',HUNGARY:'HU',IRELAND:'IE',
    ITALY:'IT',LATVIA:'LV',LITHUANIA:'LT',LUXEMBOURG:'LU',MALTA:'MT',NETHERLANDS:'NL',POLAND:'PL',PORTUGAL:'PT',
    ROMANIA:'RO',SLOVAKIA:'SK',SLOVENIA:'SI',SPAIN:'ES',SWEDEN:'SE',POLSKA:'PL'
  };

  const rad=x=>x*Math.PI/180;
  function hav(a,b){const R=6371,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon),x=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  function median(v){const a=v.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
  function countryCode(v){const s=String(v||'').trim().toUpperCase();return s.length===2?s:(COUNTRY_ALIASES[s]||s)}
  function nationalReferenceFresh(){
    const ref=new Date(NATIONAL_REFERENCE_DATE+'T12:00:00Z').getTime();
    if(!Number.isFinite(ref))return false;
    return (Date.now()-ref)/(864e5) <= NATIONAL_MAX_AGE_DAYS;
  }
  function nationalAvg(v){return NATIONAL_DIESEL_EUR[countryCode(v)]??null}

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
    }catch(e){/* no classification => national low gate may still protect us */}
    finally{clearTimeout(timer)}
    return out;
  }

  function nationalLowOutlier(s){
    if(!nationalReferenceFresh()||!Number.isFinite(s.priceEur))return false;
    const avg=nationalAvg(s.country);if(!Number.isFinite(avg)||avg<=0)return false;
    s.nationalAverageEur=avg;
    s.nationalDeviation=(s.priceEur-avg)/avg;
    return s.priceEur < avg*NATIONAL_LOW_FACTOR;
  }

  function applyLocalSanity(stations,fx,classes){
    const enriched=(stations||[]).map(s=>{
      const meta=classes?.get(s.id)||{roadClass:'unknown',osmMatched:false};
      return {...s,country:countryCode(s.country),priceEur:eurPrice(s,fx),roadClass:meta.roadClass,osmMatched:meta.osmMatched,priceSanity:'unchecked',priceMedianEur:null,priceDeviation:null,nationalAverageEur:null,nationalDeviation:null};
    });
    const visible=[],hidden=[];
    for(const s of enriched){
      // Strong safety net: implausibly LOW against current national weekly average.
      // This catches a whole bad local cluster that would otherwise validate itself via its own median.
      if(nationalLowOutlier(s)){
        s.priceSanity='national-low-outlier';hidden.push(s);continue;
      }
      if(!Number.isFinite(s.priceEur)||s.roadClass==='unknown'){visible.push(s);continue}
      const peers=enriched.filter(p=>p.country===s.country&&p.roadClass===s.roadClass&&Number.isFinite(p.priceEur)&&hav(s,p)<=PEER_RADIUS_KM);
      if(peers.length<MIN_PEERS){s.priceSanity='insufficient-peers';visible.push(s);continue}
      const med=median(peers.map(p=>p.priceEur));
      if(!Number.isFinite(med)||med<=0){visible.push(s);continue}
      s.priceMedianEur=med;s.priceDeviation=(s.priceEur-med)/med;
      const suspicious=s.priceEur<med*LOCAL_LOW_FACTOR||s.priceEur>med*LOCAL_HIGH_FACTOR;
      if(suspicious){s.priceSanity='local-outlier';hidden.push(s)} else {s.priceSanity='ok';visible.push(s)}
    }
    return {visible,hidden,enriched};
  }

  async function sanitizeForMap(stations){
    const fx=await fxTable(stations||[]);
    const classes=await roadClasses((stations||[]).filter(s=>s.price!=null));
    const result=applyLocalSanity(stations||[],fx,classes);
    return {...result,fx,classes,nationalReferenceDate:NATIONAL_REFERENCE_DATE,nationalReferenceFresh:nationalReferenceFresh()};
  }

  // Recommendation candidates already have verified location and motorway/off-motorway classification.
  function sanitizeVerifiedCandidates(stations){
    const enriched=(stations||[]).map(s=>({...s,country:countryCode(s.country),roadClass:s.motorway===true?'motorway':s.motorway===false?'offmotorway':'unknown',osmMatched:!!s.verified,priceSanity:'unchecked',priceMedianEur:null,priceDeviation:null,nationalAverageEur:null,nationalDeviation:null}));
    const visible=[],hidden=[];
    for(const s of enriched){
      if(nationalLowOutlier(s)){s.priceSanity='national-low-outlier';hidden.push(s);continue}
      if(!Number.isFinite(s.priceEur)||s.roadClass==='unknown'){visible.push(s);continue}
      const peers=enriched.filter(p=>p.country===s.country&&p.roadClass===s.roadClass&&Number.isFinite(p.priceEur)&&Math.abs((p.along??0)-(s.along??0))<=120);
      if(peers.length<MIN_PEERS){s.priceSanity='insufficient-peers';visible.push(s);continue}
      const med=median(peers.map(p=>p.priceEur));if(!Number.isFinite(med)||med<=0){visible.push(s);continue}
      s.priceMedianEur=med;s.priceDeviation=(s.priceEur-med)/med;
      if(s.priceEur<med*LOCAL_LOW_FACTOR||s.priceEur>med*LOCAL_HIGH_FACTOR){s.priceSanity='local-outlier';hidden.push(s)} else {s.priceSanity='ok';visible.push(s)}
    }
    return {visible,hidden,enriched,nationalReferenceDate:NATIONAL_REFERENCE_DATE,nationalReferenceFresh:nationalReferenceFresh()};
  }

  window.ManniPriceSanity={
    fxTable,eurPrice,sanitizeForMap,sanitizeVerifiedCandidates,nationalAvg,countryCode,
    nationalReferenceDate:NATIONAL_REFERENCE_DATE,nationalReferenceFresh,
    constants:{PEER_RADIUS_KM,MIN_PEERS,LOCAL_LOW_FACTOR,LOCAL_HIGH_FACTOR,NATIONAL_LOW_FACTOR,NATIONAL_MAX_AGE_DAYS}
  };
})();
