// Manni's World 3.32 — Trip Cost dashboard.
// Read-only module: it does not alter route, fuel, Smart Fuel or map logic.
(function(){
  const $=id=>document.getElementById(id);
  const ui={
    panel:$('tripCostPanel'),status:$('tripCostStatus'),distance:$('tripCostDistance'),total:$('tripCostTotal'),litres:$('tripCostLitres'),
    paid:$('tripCostPaid'),remaining:$('tripCostRemaining'),per100:$('tripCostPer100'),measured:$('tripCostMeasured'),saving:$('tripCostSaving'),note:$('tripCostNote')
  };
  if(!ui.panel||!window.ManniStorage)return;
  const RESERVE_L=10;
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)):'—';
  const eur=v=>Number.isFinite(Number(v))?`${fmt(v,2)} €`:'—';
  const km=v=>Number.isFinite(Number(v))?`${new Intl.NumberFormat((window.ManniI18n?.locale?.()||'sl-SI'),{maximumFractionDigits:0}).format(Number(v))} km`:'—';
  const l=v=>Number.isFinite(Number(v))?`${fmt(v,1)} l`:'—';
  const cons=v=>Number.isFinite(Number(v))?`${fmt(v,1)} l/100 km`:'—';

  function currentFuel(d){
    const x=Number(d.journey?.estimatedFuelLitres);
    if(Number.isFinite(x))return Math.max(0,x);
    const y=Number(d.vehicle?.currentFuelLitres);
    return Number.isFinite(y)?Math.max(0,y):null;
  }
  function activeLog(d){
    const log=[...(d.fuelLog||[])];
    if(!d.activeTrip?.startedAt)return log;
    const t=new Date(d.activeTrip.startedAt).getTime();
    return log.filter(x=>new Date(x.timestamp).getTime()>=t);
  }
  function measuredConsumption(log){
    const asc=[...(log||[])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
    const full=[];asc.forEach((e,i)=>{if(e.fullTank&&Number.isFinite(Number(e.odometerKm)))full.push(i)});
    if(full.length<2)return null;
    const a=full[full.length-2],b=full[full.length-1],dist=Number(asc[b].odometerKm)-Number(asc[a].odometerKm);
    if(!(dist>0))return null;
    let litres=0;for(let i=a+1;i<=b;i++)if(Number.isFinite(Number(asc[i].litres)))litres+=Number(asc[i].litres);
    return litres>0?litres/dist*100:null;
  }
  function paidSoFar(log){return (log||[]).reduce((s,e)=>s+(Number.isFinite(Number(e.amountEur))?Number(e.amountEur):0),0)}
  function distanceDone(d){
    const start=Number(d.activeTrip?.startOdometerKm),now=Number(d.vehicle?.odometerKm);
    if(Number.isFinite(start)&&Number.isFinite(now)&&now>=start)return now-start;
    const tracked=Number(d.journey?.trackedKm);
    return Number.isFinite(tracked)?Math.max(0,tracked):0;
  }
  function routeBenchmark(d){
    // Approximate the remaining route price from EC national diesel references, weighted by route segments.
    const segs=d.journey?.routeSegments||[],pts=(d.journey?.resolvedPoints||[]).slice(d.journey?.nextIndex||0);
    let weighted=0,weight=0;
    if(window.ManniPriceSanity?.nationalAvg){
      for(let i=0;i<segs.length;i++){
        const seg=segs[i],point=pts[i],p=window.ManniPriceSanity.nationalAvg(point?.country||point?.countryCode);
        if(Number.isFinite(Number(seg?.km))&&Number.isFinite(Number(p))){weighted+=Number(seg.km)*Number(p);weight+=Number(seg.km)}
      }
    }
    if(weight>0)return weighted/weight;
    const smart=window.__manniSmartFuelState,prices=[smart?.main,...(smart?.alts||[])].map(x=>Number(x?.priceEur)).filter(Number.isFinite);
    if(prices.length){prices.sort((a,b)=>a-b);return prices[Math.floor(prices.length/2)]}
    return null;
  }
  function smartSaving(d){
    const s=window.__manniSmartFuelState;if(!s?.main)return null;
    if(Number.isFinite(Number(s.opportunity?.saving)))return Math.max(0,Number(s.opportunity.saving));
    const main=Number(s.main.priceEur),alts=(s.alts||[]).map(x=>Number(x.priceEur)).filter(Number.isFinite);
    const tank=Number(d.vehicle?.tankLitres),fuel=currentFuel(d),avg=Number(d.vehicle?.averageConsumption),along=Number(s.main.along);
    if(!Number.isFinite(main)||!alts.length||!Number.isFinite(tank)||!Number.isFinite(fuel)||!Number.isFinite(avg)||!Number.isFinite(along))return null;
    const arrival=Math.max(0,fuel-along*avg/100),fill=Math.max(0,tank-arrival);
    const higher=alts.filter(x=>x>main).sort((a,b)=>a-b)[0];
    return Number.isFinite(higher)?Math.max(0,(higher-main)*fill):0;
  }
  function render(){
    const d=window.ManniStorage.get(),remainingKm=Number(d.journey?.lastRouteKm),avg=Number(d.vehicle?.averageConsumption),fuel=currentFuel(d);
    if(!d.route?.destination){ui.panel.hidden=true;return}
    ui.panel.hidden=false;
    if(!Number.isFinite(remainingKm)||remainingKm<=0||!Number.isFinite(avg)||avg<=0||!Number.isFinite(fuel)){
      ui.status.textContent='Čakam na veljavno pot in podatke o Manniju.';
      [ui.distance,ui.total,ui.litres,ui.paid,ui.remaining,ui.per100,ui.measured,ui.saving].forEach(x=>x.textContent='—');
      ui.note.textContent='Ko je Pot preračunana in sta vnesena gorivo ter povprečna poraba, se stroški izračunajo samodejno.';return;
    }
    const log=activeLog(d),paid=paidSoFar(log),done=distanceDone(d),totalKm=done+remainingKm;
    const measured=measuredConsumption(log),usedAvg=Number.isFinite(measured)?measured:avg;
    const remainingLitres=remainingKm*usedAvg/100,totalLitres=totalKm*usedAvg/100;
    const benchmark=routeBenchmark(d);
    const futureBuyLitres=Math.max(0,remainingLitres+RESERVE_L-fuel); // preserve agreed 10 l at arrival
    const futureCash=Number.isFinite(benchmark)?futureBuyLitres*benchmark:null;
    const totalEconomic=Number.isFinite(benchmark)?totalLitres*benchmark:null;
    const low=Number.isFinite(totalEconomic)?totalEconomic*.96:null,high=Number.isFinite(totalEconomic)?totalEconomic*1.04:null;
    const per100=Number.isFinite(benchmark)?usedAvg*benchmark:null;
    const saving=smartSaving(d);

    ui.distance.textContent=km(totalKm);
    ui.total.textContent=Number.isFinite(low)&&Number.isFinite(high)?`${eur(low)}–${eur(high)}`:'—';
    ui.litres.textContent=l(totalLitres);
    ui.paid.textContent=eur(paid);
    ui.remaining.textContent=Number.isFinite(futureCash)?`≈ ${eur(futureCash)}`:'—';
    ui.per100.textContent=Number.isFinite(per100)?`${eur(per100)} / 100 km`:'—';
    ui.measured.textContent=Number.isFinite(measured)?cons(measured):`${cons(avg)} (nast.)`;
    ui.saving.textContent=Number.isFinite(saving)&&saving>0?`≈ ${eur(saving)}`:'—';
    ui.saving.classList.toggle('trip-cost-positive',Number.isFinite(saving)&&saving>0);
    const source=Number.isFinite(benchmark)?`ocenjena povprečna cena po preostali poti ${fmt(benchmark,2)} €/l`:'cena po poti še ni dovolj znana';
    ui.status.textContent=`Dinamična ocena · ${source}`;
    const paidText=d.activeTrip?'»Do zdaj plačano« šteje tankanja od začetka aktivne ture.':'»Do zdaj plačano« trenutno šteje vsa ne-arhivirana tankanja.';
    ui.note.textContent=`Predvideni strošek je razpon ±4 %, ker se cene med potjo spreminjajo. »Še do cilja« upošteva trenutno gorivo in 10 l rezerve ob prihodu. ${paidText} Smart Fuel prihranek je trenutno ocenjen za naslednje priporočeno tankanje in se po Osveži lahko spremeni.`;
  }
  ['manni:route-opened','manni:route-validated','manni:fuel-changed','manni:trip-changed','manni:recommendation-updated'].forEach(ev=>window.addEventListener(ev,()=>setTimeout(render,80)));
  render();
  console.info('Manni 3.32 trip-cost dashboard ready');
})();
