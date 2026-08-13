// Manni's World — versioned persistent storage
// Schema 2 adds vehicle state + fuel log while keeping route data intact.
(function(){
  const KEY='manni.world.data';
  const SCHEMA_VERSION=2;
  const defaults={
    schemaVersion:SCHEMA_VERSION,
    route:{ destination:'', via:[], updatedAt:null },
    vehicle:{
      tankLitres:null,
      averageConsumption:null,
      reserveLitres:10,
      currentFuelLitres:null,
      odometerKm:null,
      updatedAt:null
    },
    fuelLog:[]
  };

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function numOrNull(v){
    if(v===null || v==='' || typeof v==='undefined') return null;
    const n=Number(v); return Number.isFinite(n)?n:null;
  }
  function normalizeEntry(e){
    if(!e || typeof e!=='object') return null;
    return {
      id:String(e.id||('fuel-'+Date.now()+'-'+Math.random().toString(36).slice(2,8))),
      timestamp:e.timestamp||new Date().toISOString(),
      odometerKm:numOrNull(e.odometerKm),
      litres:numOrNull(e.litres),
      amountEur:numOrNull(e.amountEur),
      pricePerLitre:numOrNull(e.pricePerLitre),
      fullTank:Boolean(e.fullTank),
      distanceSincePrevious:numOrNull(e.distanceSincePrevious),
      consumptionSinceFull:numOrNull(e.consumptionSinceFull)
    };
  }
  function merge(base, saved){
    const out=clone(base);
    if(!saved || typeof saved!=='object') return out;
    out.schemaVersion=SCHEMA_VERSION;
    if(saved.route && typeof saved.route==='object'){
      out.route.destination=String(saved.route.destination||'');
      out.route.via=Array.isArray(saved.route.via)?saved.route.via.map(String).filter(Boolean):[];
      out.route.updatedAt=saved.route.updatedAt||null;
    }
    if(saved.vehicle && typeof saved.vehicle==='object'){
      const v=saved.vehicle;
      out.vehicle.tankLitres=numOrNull(v.tankLitres);
      out.vehicle.averageConsumption=numOrNull(v.averageConsumption);
      out.vehicle.reserveLitres=Number.isFinite(Number(v.reserveLitres))?Number(v.reserveLitres):10;
      out.vehicle.currentFuelLitres=numOrNull(v.currentFuelLitres);
      out.vehicle.odometerKm=numOrNull(v.odometerKm);
      out.vehicle.updatedAt=v.updatedAt||null;
    }
    if(Array.isArray(saved.fuelLog)) out.fuelLog=saved.fuelLog.map(normalizeEntry).filter(Boolean);
    return out;
  }
  function load(){
    try{return merge(defaults,JSON.parse(localStorage.getItem(KEY)||'null'))}
    catch(e){console.warn('Manni storage load',e);return clone(defaults)}
  }
  function save(data){
    const normalized=merge(defaults,data);
    localStorage.setItem(KEY,JSON.stringify(normalized));
    return normalized;
  }
  function get(){return load()}
  function update(mutator){
    const data=load();
    const result=mutator(data)||data;
    return save(result);
  }
  window.ManniStorage={KEY,SCHEMA_VERSION,get,save,update};
})();
