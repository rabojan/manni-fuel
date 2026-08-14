// Manni's World 3.4 trips/archive beta
// Trips are isolated from map core. Vehicle settings survive trip completion/deletion.
(function(){
  function $(id){return document.getElementById(id)}
  const ui={
    open:$('tripArchiveBtn'), dialog:$('tripDialog'), close:$('tripCloseBtn'),
    active:$('activeTripPanel'), name:$('tripNameInput'), start:$('startTripBtn'), finish:$('finishTripBtn'), clearCurrent:$('clearCurrentTripBtn'),
    archive:$('tripArchiveList'), clearArchive:$('clearTripArchiveBtn'), detail:$('tripDetail')
  };
  if(!ui.open || !ui.dialog || !window.ManniStorage) return;

  function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function money(v){return Number.isFinite(Number(v))?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v))+' €':'—'}
  function litres(v){return Number.isFinite(Number(v))?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v))+' l':'—'}
  function cons(v){return Number.isFinite(Number(v))?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v))+' l/100 km':'—'}
  function date(v){return v?new Date(v).toLocaleDateString((window.ManniI18n?.locale?.()||'sl-SI'),{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}
  function routeText(r){if(!r?.destination)return 'Pot ni nastavljena';return `Moja lokacija → ${r.via?.length?r.via.join(' → ')+' → ':''}${r.destination}`}
  function computeMeasuredConsumption(log){
    const asc=[...(log||[])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
    const full=[];asc.forEach((e,i)=>{if(e.fullTank&&Number.isFinite(e.odometerKm))full.push(i)});
    if(full.length<2)return null;
    const a=full[0],b=full[full.length-1],distance=asc[b].odometerKm-asc[a].odometerKm;
    if(!(distance>0))return null;
    let l=0;for(let i=a+1;i<=b;i++)if(Number.isFinite(asc[i].litres))l+=asc[i].litres;
    return l>0?l/distance*100:null;
  }
  function stats(log,startKm,endKm){
    const totalLitres=(log||[]).reduce((s,e)=>s+(Number.isFinite(e.litres)?e.litres:0),0);
    const totalCostEur=(log||[]).reduce((s,e)=>s+(Number.isFinite(e.amountEur)?e.amountEur:0),0);
    const distanceKm=Number.isFinite(startKm)&&Number.isFinite(endKm)&&endKm>=startKm?endKm-startKm:null;
    return {distanceKm,totalLitres,totalCostEur,averagePricePerLitre:totalLitres>0?totalCostEur/totalLitres:null,measuredConsumption:computeMeasuredConsumption(log)};
  }
  function suggestedName(data){
    if(data.route?.destination)return data.route.destination;
    return 'Tura '+new Date().toLocaleDateString((window.ManniI18n?.locale?.()||'sl-SI'),{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function render(){
    const d=window.ManniStorage.get(),t=d.activeTrip,log=d.fuelLog||[];
    if(t){
      const s=stats(log,t.startOdometerKm,d.vehicle.odometerKm);
      ui.active.innerHTML=`<div class="trip-active-card"><div><span class="trip-state">AKTIVNA TURA</span><strong>${esc(t.name)}</strong><small>${date(t.startedAt)} · ${esc(routeText(d.route))}</small></div><div class="trip-mini-stats"><span>${log.length} tankanj</span><span>${money(s.totalCostEur)}</span>${Number.isFinite(s.distanceKm)?`<span>${Math.round(s.distanceKm)} km</span>`:''}</div></div>`;
      ui.name.value=t.name;ui.name.disabled=true;ui.start.hidden=true;ui.finish.hidden=false;
    }else{
      ui.active.innerHTML=`<div class="trip-no-active"><strong>Ni aktivne ture</strong><span>Začni novo turo. Nastavitve Mannija ostanejo trajno shranjene.</span>${log.length?`<em>Trenutno imaš ${log.length} testnih/neuvrščenih tankanj. Če začneš turo, bodo ostala v aktivni evidenci.</em>`:''}</div>`;
      ui.name.disabled=false;if(!ui.name.value)ui.name.value=suggestedName(d);ui.start.hidden=false;ui.finish.hidden=true;
    }
    renderArchive(d.tripArchive||[]);
  }
  function renderArchive(items){
    if(!items.length){ui.archive.innerHTML='<div class="trip-empty">Arhiv je še prazen. Zaključena tura se bo prikazala tukaj.</div>';ui.clearArchive.hidden=true;return}
    ui.clearArchive.hidden=false;
    ui.archive.innerHTML=[...items].sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt)).map(t=>{
      const s=t.stats||stats(t.fuelLog,t.startOdometerKm,t.endOdometerKm);
      return `<article class="trip-archive-card"><button type="button" class="trip-open" data-open-trip="${esc(t.id)}"><span><strong>${esc(t.name)}</strong><small>${date(t.startedAt)} → ${date(t.endedAt)}</small></span><span class="trip-archive-summary">${Number.isFinite(s.distanceKm)?Math.round(s.distanceKm)+' km · ':''}${money(s.totalCostEur)}</span></button><button type="button" class="trip-delete" data-delete-trip="${esc(t.id)}" aria-label="Izbriši turo">✕</button></article>`;
    }).join('');
  }
  function startTrip(){
    const name=ui.name.value.trim();if(!name){alert('Vnesi ime ture, npr. Baltik 2027.');return}
    window.ManniStorage.update(d=>{
      d.activeTrip={id:'trip-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),name,startedAt:new Date().toISOString(),endedAt:null,startOdometerKm:Number.isFinite(d.vehicle.odometerKm)?d.vehicle.odometerKm:null,endOdometerKm:null,route:JSON.parse(JSON.stringify(d.route)),vehicleSnapshot:{tankLitres:d.vehicle.tankLitres,averageConsumption:d.vehicle.averageConsumption,reserveLitres:10},fuelLog:[],stats:null};
      return d;
    });render();
  }
  function finishTrip(){
    const d=window.ManniStorage.get();if(!d.activeTrip)return;
    if(!confirm(`Zaključim turo »${d.activeTrip.name}« in jo prestavim v arhiv?`))return;
    window.ManniStorage.update(data=>{
      const t=data.activeTrip, endKm=Number.isFinite(data.vehicle.odometerKm)?data.vehicle.odometerKm:null;
      const archived={...t,endedAt:new Date().toISOString(),endOdometerKm:endKm,route:JSON.parse(JSON.stringify(data.route)),fuelLog:JSON.parse(JSON.stringify(data.fuelLog||[]))};
      archived.stats=stats(archived.fuelLog,archived.startOdometerKm,endKm);
      data.tripArchive.push(archived);
      data.activeTrip=null;
      data.fuelLog=[];
      data.route={destination:'',via:[],updatedAt:new Date().toISOString()};
      return data;
    });
    ui.name.value='';render();
    window.dispatchEvent(new CustomEvent('manni:trip-changed'));
  }
  function clearCurrent(){
    const d=window.ManniStorage.get();
    const label=d.activeTrip?`aktivno turo »${d.activeTrip.name}« in vsa njena tankanja`:'trenutna testna tankanja in pot';
    if(!confirm(`Izbrišem ${label}? Nastavitve Mannija in arhiv ostanejo.`))return;
    window.ManniStorage.update(data=>{data.activeTrip=null;data.fuelLog=[];data.route={destination:'',via:[],updatedAt:new Date().toISOString()};return data});
    ui.name.value='';render();window.dispatchEvent(new CustomEvent('manni:trip-changed'));
  }
  function showDetail(id){
    const t=window.ManniStorage.get().tripArchive.find(x=>x.id===id);if(!t)return;
    const s=t.stats||stats(t.fuelLog,t.startOdometerKm,t.endOdometerKm);
    const rows=[...(t.fuelLog||[])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).map(e=>`<div class="trip-detail-fuel"><span>${date(e.timestamp)} · ${Number.isFinite(e.odometerKm)?Math.round(e.odometerKm).toLocaleString((window.ManniI18n?.locale?.()||'sl-SI'))+' km':'—'}</span><strong>${litres(e.litres)} · ${money(e.amountEur)}</strong><small>${Number.isFinite(e.pricePerLitre)?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:2,maximumFractionDigits:2}).format(e.pricePerLitre)+' €/l':''}${e.fullTank?' · poln tank':''}</small></div>`).join('');
    ui.detail.innerHTML=`<div class="trip-detail-head"><div><span class="eyebrow">ARHIV</span><h3>${esc(t.name)}</h3></div><button type="button" data-close-detail>✕</button></div><div class="trip-detail-route">${esc(routeText(t.route))}</div><div class="trip-detail-stats"><div><strong>${Number.isFinite(s.distanceKm)?Math.round(s.distanceKm).toLocaleString((window.ManniI18n?.locale?.()||'sl-SI'))+' km':'—'}</strong><span>prevoženo</span></div><div><strong>${litres(s.totalLitres)}</strong><span>natočeno</span></div><div><strong>${money(s.totalCostEur)}</strong><span>strošek</span></div><div><strong>${Number.isFinite(s.averagePricePerLitre)?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:2,maximumFractionDigits:2}).format(s.averagePricePerLitre)+' €/l':'—'}</strong><span>povp. cena</span></div><div><strong>${cons(s.measuredConsumption)}</strong><span>izmerjena poraba</span></div></div><h4>Tankanja</h4>${rows||'<div class="trip-empty">Na tej turi ni bilo zabeleženega tankanja.</div>'}`;
    ui.detail.hidden=false;
  }
  function deleteArchive(id){
    const t=window.ManniStorage.get().tripArchive.find(x=>x.id===id);if(!t)return;
    if(!confirm(`Za vedno izbrišem arhivirano turo »${t.name}«?`))return;
    window.ManniStorage.update(d=>{d.tripArchive=d.tripArchive.filter(x=>x.id!==id);return d});ui.detail.hidden=true;render();
  }

  ui.open.addEventListener('click',()=>{ui.detail.hidden=true;render();ui.dialog.showModal()});
  ui.close.addEventListener('click',()=>ui.dialog.close());
  ui.start.addEventListener('click',startTrip);ui.finish.addEventListener('click',finishTrip);ui.clearCurrent.addEventListener('click',clearCurrent);
  ui.archive.addEventListener('click',e=>{const o=e.target.closest('[data-open-trip]'),del=e.target.closest('[data-delete-trip]');if(o)showDetail(o.dataset.openTrip);if(del)deleteArchive(del.dataset.deleteTrip)});
  ui.detail.addEventListener('click',e=>{if(e.target.closest('[data-close-detail]'))ui.detail.hidden=true});
  ui.clearArchive.addEventListener('click',()=>{if(!confirm('Za vedno izbrišem CELOTEN arhiv vseh zaključenih tur?'))return;window.ManniStorage.update(d=>{d.tripArchive=[];return d});ui.detail.hidden=true;render()});
  window.addEventListener('manni:fuel-changed',render);
  render();
  console.info('Manni 3.4 trips/archive beta ready');
})();
