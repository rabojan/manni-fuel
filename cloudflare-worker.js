const PUMPERLY='https://pumperly.com';
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Content-Type':'application/json; charset=utf-8'
};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...cors,...extra}});
const round=(n,step)=>Math.round(n/step)*step;
function bbox(lat,lon,r){const dy=r/111.32,dx=r/Math.max(15,111.32*Math.cos(lat*Math.PI/180));return [lon-dx,lat-dy,lon+dx,lat+dy]}
async function originFetch(url,timeout=5000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'ManniFuel/2.0'},signal:c.signal,cf:{cacheEverything:true,cacheTtl:300}});if(!r.ok)throw new Error('Origin '+r.status);return await r.json()}finally{clearTimeout(t)}}
async function stations(req,ctx){
  const u=new URL(req.url),lat=Number(u.searchParams.get('lat')),lon=Number(u.searchParams.get('lon')),r=Math.max(2,Math.min(80,Number(u.searchParams.get('radius')||20))),fuel=u.searchParams.get('fuel')||'B7';
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return json({error:'lat/lon required'},400);
  // 0.05° celica (~5 km): manj različnih cache ključev med premikanjem karte.
  const qlat=round(lat,.05),qlon=round(lon,.05),bucket=r<=10?10:r<=20?20:r<=30?30:r<=50?50:80;
  const keyUrl=new URL(req.url);keyUrl.pathname='/__cache/stations';keyUrl.search=`lat=${qlat.toFixed(2)}&lon=${qlon.toFixed(2)}&radius=${bucket}&fuel=${encodeURIComponent(fuel)}`;
  const cache=await caches.open('manni-fuel-v2');
  const cacheKey=new Request(keyUrl.toString(),{method:'GET'});
  const cached=await cache.match(cacheKey);
  if(cached){const body=await cached.json();return json({...body,meta:{...(body.meta||{}),route:'Manni edge cache',cached:true} },200,{'Cache-Control':'public,max-age=60'})}
  const bb=bbox(qlat,qlon,bucket+6).map(n=>n.toFixed(6)).join(',');
  const origin=`${PUMPERLY}/api/stations?bbox=${bb}&fuel=${encodeURIComponent(fuel)}`;
  try{
    const data=await originFetch(origin,5000);
    const payload={features:data.features||[],meta:{route:'Manni Worker → Pumperly',cached:false,fetchedAt:new Date().toISOString(),cell:[qlat,qlon],radius:bucket}};
    const store=json(payload,200,{'Cache-Control':'public,max-age=300,stale-while-revalidate=1800'});
    ctx.waitUntil(cache.put(cacheKey,store.clone()));
    return store;
  }catch(e){return json({features:[],meta:{route:'Manni Worker',error:String(e.message||e)}},504,{'Cache-Control':'no-store'})}
}
export default{
  async fetch(req,env,ctx){
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const u=new URL(req.url);
    if(u.pathname==='/'||u.pathname==='/health')return json({ok:true,name:'Manni Fuel API',version:'2.0'});
    if(u.pathname==='/stations')return stations(req,ctx);
    return json({error:'Not found'},404);
  }
};
