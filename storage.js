// Manni's World — versioned persistent storage
// New modules use this store so future upgrades do not need to rewrite the stable fuel core.
(function(){
  const KEY='manni.world.data';
  const SCHEMA_VERSION=1;
  const defaults={
    schemaVersion:SCHEMA_VERSION,
    route:{ destination:'', via:[], updatedAt:null },
    vehicle:{ tankLitres:null, averageConsumption:null, reserveLitres:10 },
    fuelLog:[]
  };

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
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
      if(Number.isFinite(Number(saved.vehicle.tankLitres))) out.vehicle.tankLitres=Number(saved.vehicle.tankLitres);
      if(Number.isFinite(Number(saved.vehicle.averageConsumption))) out.vehicle.averageConsumption=Number(saved.vehicle.averageConsumption);
      if(Number.isFinite(Number(saved.vehicle.reserveLitres))) out.vehicle.reserveLitres=Number(saved.vehicle.reserveLitres);
    }
    if(Array.isArray(saved.fuelLog)) out.fuelLog=saved.fuelLog;
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
