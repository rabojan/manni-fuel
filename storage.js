// Manni's World — versioned persistent storage
// Schema 3 adds active trip + trip archive while preserving route, vehicle and fuel data.
(function(){
  const KEY='manni.world.data';
  const SCHEMA_VERSION=3;
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
    fuelLog:[],
    activeTrip:null,
    tripArchive:[]
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
  function normalizeRoute(r){
    return {
      destination:String(r?.destination||''),
      via:Array.isArray(r?.via)?r.via.map(String).filter(Boolean):[],
      updatedAt:r?.updatedAt||null
    };
  }
  function normalizeTrip(t){
    if(!t || typeof t!=='object') return null;
    return {
      id:String(t.id||('trip-'+Date.now()+'-'+Math.random().toString(36).slice(2,8))),
      name:String(t.name||'Tura'),
      startedAt:t.startedAt||new Date().toISOString(),
      endedAt:t.endedAt||null,
      startOdometerKm:numOrNull(t.startOdometerKm),
      endOdometerKm:numOrNull(t.endOdometerKm),
      route:normalizeRoute(t.route||{}),
      vehicleSnapshot:t.vehicleSnapshot&&typeof t.vehicleSnapshot==='object'?{
        tankLitres:numOrNull(t.vehicleSnapshot.tankLitres),
        averageConsumption:numOrNull(t.vehicleSnapshot.averageConsumption),
        reserveLitres:10
      }:null,
      fuelLog:Array.isArray(t.fuelLog)?t.fuelLog.map(normalizeEntry).filter(Boolean):[],
      stats:t.stats&&typeof t.stats==='object'?{
        distanceKm:numOrNull(t.stats.distanceKm),
        totalLitres:numOrNull(t.stats.totalLitres),
        totalCostEur:numOrNull(t.stats.totalCostEur),
        averagePricePerLitre:numOrNull(t.stats.averagePricePerLitre),
        measuredConsumption:numOrNull(t.stats.measuredConsumption)
      }:null
    };
  }
  function merge(base, saved){
    const out=clone(base);
    if(!saved || typeof saved!=='object') return out;
    out.schemaVersion=SCHEMA_VERSION;
    out.route=normalizeRoute(saved.route||{});
    if(saved.vehicle && typeof saved.vehicle==='object'){
      const v=saved.vehicle;
      out.vehicle.tankLitres=numOrNull(v.tankLitres);
      out.vehicle.averageConsumption=numOrNull(v.averageConsumption);
      out.vehicle.reserveLitres=10;
      out.vehicle.currentFuelLitres=numOrNull(v.currentFuelLitres);
      out.vehicle.odometerKm=numOrNull(v.odometerKm);
      out.vehicle.updatedAt=v.updatedAt||null;
    }
    if(Array.isArray(saved.fuelLog)) out.fuelLog=saved.fuelLog.map(normalizeEntry).filter(Boolean);
    out.activeTrip=normalizeTrip(saved.activeTrip);
    if(Array.isArray(saved.tripArchive)) out.tripArchive=saved.tripArchive.map(normalizeTrip).filter(Boolean);
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
