// Manni's World 3.4 fuel-log-beta
// Vehicle settings and refuelling history are isolated from map and route modules.
(function(){
  function $(id){return document.getElementById(id)}
  const ui={
    btn:$('fuelLogBtn'), dialog:$('fuelDialog'), close:$('fuelCloseBtn'),
    tank:$('vehicleTank'), avg:$('vehicleConsumption'), current:$('vehicleCurrentFuel'), odometer:$('vehicleOdometer'),
    saveVehicle:$('saveVehicleBtn'), reserve:$('vehicleReserve'),
    litres:$('refuelLitres'), amount:$('refuelAmount'), km:$('refuelOdometer'), time:$('refuelTime'), full:$('refuelFull'),
    add:$('addRefuelBtn'), history:$('fuelHistory'), stats:$('fuelStats'), vehicleSummary:$('vehicleSummary'),
    clear:$('clearFuelLogBtn'), tripArchive:$('tripArchiveBtn')
  };
  if(!ui.btn || !ui.dialog || !window.ManniStorage) return;

  function money(v){return Number.isFinite(Number(v))?Number(v).toFixed(2).replace('.',',')+' €':'—'}
  function litres(v){return Number.isFinite(Number(v))?Number(v).toFixed(1).replace('.',',')+' l':'—'}
  function cons(v){return Number.isFinite(Number(v))?Number(v).toFixed(2).replace('.',',')+' l/100 km':'—'}
  function n(v){const x=Number(String(v??'').replace(',','.'));return Number.isFinite(x)?x:null}
  function localDateInput(iso){
    const d=iso?new Date(iso):new Date();
    const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return z.toISOString().slice(0,16);
  }
  function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

  function computeExactConsumption(log){
    // Exact consumption is only defensible between two known full-tank points.
    const fullIndices=[]; log.forEach((e,i)=>{if(e.fullTank && Number.isFinite(e.odometerKm))fullIndices.push(i)});
    if(fullIndices.length<2) return null;
    const endI=fullIndices[fullIndices.length-1], startI=fullIndices[fullIndices.length-2];
    const start=log[startI], end=log[endI];
    const distance=end.odometerKm-start.odometerKm;
    if(!(distance>0)) return null;
    let added=0;
    for(let i=startI+1;i<=endI;i++) if(Number.isFinite(log[i].litres)) added+=log[i].litres;
    if(!(added>0)) return null;
    return {value:added/distance*100,distance,litres:added,startI,endI};
  }

  function recalc(data){
    const log=[...(data.fuelLog||[])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
    for(let i=0;i<log.length;i++){
      const prev=i?log[i-1]:null;
      log[i].distanceSincePrevious=(prev && Number.isFinite(log[i].odometerKm) && Number.isFinite(prev.odometerKm) && log[i].odometerKm>=prev.odometerKm)?log[i].odometerKm-prev.odometerKm:null;
      log[i].pricePerLitre=(Number.isFinite(log[i].amountEur)&&Number.isFinite(log[i].litres)&&log[i].litres>0)?log[i].amountEur/log[i].litres:null;
      log[i].consumptionSinceFull=null;
    }
    const exact=computeExactConsumption(log);
    if(exact) log[exact.endI].consumptionSinceFull=exact.value;
    data.fuelLog=log;
    return data;
  }

  function render(){
    const data=window.ManniStorage.get(),v=data.vehicle,log=[...(data.fuelLog||[])].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    ui.tank.value=v.tankLitres??''; ui.avg.value=v.averageConsumption??''; ui.current.value=v.currentFuelLitres??''; ui.odometer.value=v.odometerKm??''; ui.reserve.textContent='10 l';
    const capacity=Number(v.tankLitres),avg=Number(v.averageConsumption),fuel=Number(v.currentFuelLitres);
    const usable=Number.isFinite(fuel)&&fuel>10?fuel-10:0;
    const range=Number.isFinite(avg)&&avg>0&&usable>0?usable/avg*100:null;
    ui.vehicleSummary.innerHTML=`<strong>Manni</strong><span>Rezervoar: ${litres(capacity)} · Povprečna poraba: ${cons(avg)}</span><span>Varnostna rezerva: 10 l${Number.isFinite(range)?` · ocenjen varen doseg: <b>${Math.round(range)} km</b>`:''}</span>`;

    const totalCost=log.reduce((s,e)=>s+(Number.isFinite(e.amountEur)?e.amountEur:0),0);
    const totalLitres=log.reduce((s,e)=>s+(Number.isFinite(e.litres)?e.litres:0),0);
    const exact=[...log].find(e=>Number.isFinite(e.consumptionSinceFull));
    ui.stats.innerHTML=`<div><strong>${money(totalCost)}</strong><span>skupaj za dizel</span></div><div><strong>${litres(totalLitres)}</strong><span>skupaj natočeno</span></div><div><strong>${exact?cons(exact.consumptionSinceFull):'—'}</strong><span>zadnja izmerjena poraba</span></div>`;

    if(!log.length){ui.history.innerHTML='<div class="fuel-empty">Tankanj še ni. Prvo tankanje dodaj spodaj.</div>';return}
    ui.history.innerHTML=log.map(e=>{
      const d=new Date(e.timestamp),date=d.toLocaleDateString('sl-SI',{day:'2-digit',month:'2-digit',year:'numeric'}),time=d.toLocaleTimeString('sl-SI',{hour:'2-digit',minute:'2-digit'});
      return `<article class="fuel-entry"><div class="fuel-entry-main"><strong>${date} · ${time}</strong><span>${litres(e.litres)} · ${money(e.amountEur)}${Number.isFinite(e.pricePerLitre)?` · ${e.pricePerLitre.toFixed(3).replace('.',',')} €/l`:''}</span><small>${Number.isFinite(e.odometerKm)?Math.round(e.odometerKm).toLocaleString('sl-SI')+' km':''}${Number.isFinite(e.distanceSincePrevious)?` · +${Math.round(e.distanceSincePrevious)} km`:''}${e.fullTank?' · poln tank':''}</small>${Number.isFinite(e.consumptionSinceFull)?`<em>Izmerjena poraba: ${cons(e.consumptionSinceFull)}</em>`:''}</div><button type="button" class="fuel-delete" data-delete="${esc(e.id)}" aria-label="Izbriši tankanje">✕</button></article>`;
    }).join('');
  }

  function open(){ui.time.value=localDateInput(); const d=window.ManniStorage.get(); if(Number.isFinite(d.vehicle.odometerKm))ui.km.value=d.vehicle.odometerKm; render(); ui.dialog.showModal()}
  function saveVehicle(){
    const tank=n(ui.tank.value),avg=n(ui.avg.value),current=n(ui.current.value),odo=n(ui.odometer.value);
    if(tank!==null && tank<=10){alert('Rezervoar mora biti večji od varnostne rezerve 10 l.');return}
    if(current!==null && tank!==null && current>tank){alert('Trenutno gorivo ne more biti večje od velikosti rezervoarja.');return}
    window.ManniStorage.update(data=>{data.vehicle.tankLitres=tank;data.vehicle.averageConsumption=avg;data.vehicle.currentFuelLitres=current;data.vehicle.odometerKm=odo;data.vehicle.reserveLitres=10;data.vehicle.updatedAt=new Date().toISOString();return data});
    render();window.dispatchEvent(new CustomEvent('manni:fuel-changed'));
  }
  function addRefuel(){
    const l=n(ui.litres.value),a=n(ui.amount.value),odo=n(ui.km.value);
    if(!(l>0)){alert('Vnesi količino natočenega goriva v litrih.');return}
    if(!(a>=0)){alert('Vnesi skupni znesek tankanja.');return}
    if(!(odo>=0)){alert('Vnesi stanje kilometrov na števcu.');return}
    const timestamp=ui.time.value?new Date(ui.time.value).toISOString():new Date().toISOString();
    window.ManniStorage.update(data=>{
      const prevOdo=Number(data.vehicle.odometerKm), prevFuel=Number(data.vehicle.currentFuelLitres), avg=Number(data.vehicle.averageConsumption), cap=Number(data.vehicle.tankLitres);
      let estimatedAfter=null;
      if(ui.full.checked && Number.isFinite(cap)) estimatedAfter=cap;
      else if(Number.isFinite(prevOdo)&&Number.isFinite(prevFuel)&&Number.isFinite(avg)&&avg>0&&odo>=prevOdo){
        const consumed=(odo-prevOdo)*avg/100;
        estimatedAfter=Math.max(0,prevFuel-consumed)+l;
        if(Number.isFinite(cap)) estimatedAfter=Math.min(cap,estimatedAfter);
      }
      data.fuelLog.push({id:'fuel-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),timestamp,odometerKm:odo,litres:l,amountEur:a,pricePerLitre:a/l,fullTank:Boolean(ui.full.checked)});
      data.vehicle.odometerKm=odo;
      if(Number.isFinite(estimatedAfter)) data.vehicle.currentFuelLitres=estimatedAfter;
      data.vehicle.updatedAt=new Date().toISOString();
      return recalc(data);
    });
    ui.litres.value='';ui.amount.value='';ui.full.checked=false;ui.time.value=localDateInput();render();
    window.dispatchEvent(new CustomEvent('manni:fuel-changed'));
  }

  ui.btn.addEventListener('click',open);
  ui.close.addEventListener('click',()=>ui.dialog.close());
  ui.saveVehicle.addEventListener('click',saveVehicle);
  ui.add.addEventListener('click',addRefuel);
  ui.history.addEventListener('click',e=>{const b=e.target.closest('[data-delete]');if(!b)return;if(!confirm('Izbrišem to tankanje?'))return;window.ManniStorage.update(data=>{data.fuelLog=data.fuelLog.filter(x=>x.id!==b.dataset.delete);return recalc(data)});render();window.dispatchEvent(new CustomEvent('manni:fuel-changed'))});
  ui.clear.addEventListener('click',()=>{if(!confirm('Izbrišem celotno zgodovino tankanj? Nastavitve Mannija ostanejo.'))return;window.ManniStorage.update(data=>{data.fuelLog=[];return data});render();window.dispatchEvent(new CustomEvent('manni:fuel-changed'))});
  render();
  window.addEventListener('manni:trip-changed',render);
  console.info('Manni 3.6: vehicle + refuelling module ready');
})();
