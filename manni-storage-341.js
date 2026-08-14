// Manni's World — versioned persistent storage
// Schema 6 adds confirmed route points (label + country + coordinates) while preserving old data.
(function(){
  const KEY='manni.world.data';
  const SCHEMA_VERSION=6;
  const defaults={
    schemaVersion:SCHEMA_VERSION,
    route:{ destination:'', destinationPoint:null, via:[], viaPoints:[], updatedAt:null },
    vehicle:{tankLitres:null,averageConsumption:null,reserveLitres:10,currentFuelLitres:null,odometerKm:null,updatedAt:null},
    fuelLog:[],activeTrip:null,tripArchive:[],
    journey:{startCoord:null,nextIndex:0,resolvedPoints:[],routeValid:null,routeSegments:[],validationMessage:null,lastPosition:null,lastCheckpointAt:null,lastSegmentKm:null,trackedKm:0,estimatedFuelLitres:null,checkpoints:[],lastRouteKm:null,lastNextKm:null,lastDurationMin:null,updatedAt:null}
  };
  function clone(v){return JSON.parse(JSON.stringify(v))}
  function numOrNull(v){if(v===null||v===''||typeof v==='undefined')return null;const n=Number(v);return Number.isFinite(n)?n:null}
  function normalizePoint(p){
    if(!p||typeof p!=='object')return null;
    const lat=numOrNull(p.lat),lon=numOrNull(p.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    return {label:String(p.label||p.name||''),name:String(p.name||p.label||''),city:String(p.city||''),state:String(p.state||''),country:String(p.country||''),countryCode:String(p.countryCode||p.countrycode||'').toUpperCase(),lat,lon};
  }
  function normalizeEntry(e){if(!e||typeof e!=='object')return null;return {id:String(e.id||('fuel-'+Date.now()+'-'+Math.random().toString(36).slice(2,8))),timestamp:e.timestamp||new Date().toISOString(),odometerKm:numOrNull(e.odometerKm),litres:numOrNull(e.litres),amountEur:numOrNull(e.amountEur),pricePerLitre:numOrNull(e.pricePerLitre),fullTank:Boolean(e.fullTank),distanceSincePrevious:numOrNull(e.distanceSincePrevious),consumptionSinceFull:numOrNull(e.consumptionSinceFull)}}
  function normalizeRoute(r){
    const via=Array.isArray(r?.via)?r.via.map(String).filter(Boolean):[];
    const viaPoints=Array.isArray(r?.viaPoints)?r.viaPoints.map(normalizePoint).filter(Boolean):[];
    return {destination:String(r?.destination||''),destinationPoint:normalizePoint(r?.destinationPoint),via,viaPoints,updatedAt:r?.updatedAt||null};
  }
  function normalizeTrip(t){if(!t||typeof t!=='object')return null;return {id:String(t.id||('trip-'+Date.now()+'-'+Math.random().toString(36).slice(2,8))),name:String(t.name||'Tura'),startedAt:t.startedAt||new Date().toISOString(),endedAt:t.endedAt||null,startOdometerKm:numOrNull(t.startOdometerKm),endOdometerKm:numOrNull(t.endOdometerKm),route:normalizeRoute(t.route||{}),vehicleSnapshot:t.vehicleSnapshot&&typeof t.vehicleSnapshot==='object'?{tankLitres:numOrNull(t.vehicleSnapshot.tankLitres),averageConsumption:numOrNull(t.vehicleSnapshot.averageConsumption),reserveLitres:10}:null,fuelLog:Array.isArray(t.fuelLog)?t.fuelLog.map(normalizeEntry).filter(Boolean):[],stats:t.stats&&typeof t.stats==='object'?{distanceKm:numOrNull(t.stats.distanceKm),totalLitres:numOrNull(t.stats.totalLitres),totalCostEur:numOrNull(t.stats.totalCostEur),averagePricePerLitre:numOrNull(t.stats.averagePricePerLitre),measuredConsumption:numOrNull(t.stats.measuredConsumption)}:null}}
  function normalizeCoord(c){if(!c||typeof c!=='object')return null;const lat=numOrNull(c.lat),lon=numOrNull(c.lon);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null}
  function normalizeJourney(j){return {startCoord:normalizeCoord(j?.startCoord),nextIndex:Number.isFinite(Number(j?.nextIndex))?Math.max(0,Math.floor(Number(j.nextIndex))):0,resolvedPoints:Array.isArray(j?.resolvedPoints)?j.resolvedPoints.map(x=>({name:String(x?.name||''),label:String(x?.label||x?.name||''),country:String(x?.country||''),lat:numOrNull(x?.lat),lon:numOrNull(x?.lon),kind:String(x?.kind||'via')})).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)):[],routeValid:typeof j?.routeValid==='boolean'?j.routeValid:null,routeSegments:Array.isArray(j?.routeSegments)?j.routeSegments.map(x=>({from:String(x?.from||''),to:String(x?.to||''),km:numOrNull(x?.km),directKm:numOrNull(x?.directKm),valid:x?.valid!==false})).filter(x=>x.from&&x.to&&Number.isFinite(x.km)):[],validationMessage:j?.validationMessage?String(j.validationMessage):null,lastPosition:normalizeCoord(j?.lastPosition),lastCheckpointAt:j?.lastCheckpointAt||null,lastSegmentKm:numOrNull(j?.lastSegmentKm),trackedKm:Number.isFinite(Number(j?.trackedKm))?Math.max(0,Number(j.trackedKm)):0,estimatedFuelLitres:numOrNull(j?.estimatedFuelLitres),checkpoints:Array.isArray(j?.checkpoints)?j.checkpoints.map(x=>({lat:numOrNull(x?.lat),lon:numOrNull(x?.lon),timestamp:x?.timestamp||null,segmentKm:numOrNull(x?.segmentKm)})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).slice(-100):[],lastRouteKm:numOrNull(j?.lastRouteKm),lastNextKm:numOrNull(j?.lastNextKm),lastDurationMin:numOrNull(j?.lastDurationMin),updatedAt:j?.updatedAt||null}}
  function merge(base,saved){const out=clone(base);if(!saved||typeof saved!=='object')return out;out.schemaVersion=SCHEMA_VERSION;out.route=normalizeRoute(saved.route||{});if(saved.vehicle&&typeof saved.vehicle==='object'){const v=saved.vehicle;out.vehicle.tankLitres=numOrNull(v.tankLitres);out.vehicle.averageConsumption=numOrNull(v.averageConsumption);out.vehicle.reserveLitres=10;out.vehicle.currentFuelLitres=numOrNull(v.currentFuelLitres);out.vehicle.odometerKm=numOrNull(v.odometerKm);out.vehicle.updatedAt=v.updatedAt||null}if(Array.isArray(saved.fuelLog))out.fuelLog=saved.fuelLog.map(normalizeEntry).filter(Boolean);out.activeTrip=normalizeTrip(saved.activeTrip);if(Array.isArray(saved.tripArchive))out.tripArchive=saved.tripArchive.map(normalizeTrip).filter(Boolean);out.journey=normalizeJourney(saved.journey||{});return out}
  function load(){try{return merge(defaults,JSON.parse(localStorage.getItem(KEY)||'null'))}catch(e){console.warn('Manni storage load',e);return clone(defaults)}}
  function save(data){const normalized=merge(defaults,data);localStorage.setItem(KEY,JSON.stringify(normalized));return normalized}
  function get(){return load()}
  function update(mutator){const data=load(),result=mutator(data)||data;return save(result)}
  window.ManniStorage={KEY,SCHEMA_VERSION,get,save,update};
})();
