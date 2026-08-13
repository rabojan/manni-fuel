// Manni's World 3.4 route-beta
// Phase 1: persist destination + coarse route points without touching fuel-map core.
(function(){
  function $(id){return document.getElementById(id)}
  const ui={
    btn:$('routeBtn'), dialog:$('routeDialog'), close:$('routeCloseBtn'), destination:$('routeDestination'),
    viaList:$('routeViaList'), add:$('addViaBtn'), save:$('saveRouteBtn'), clear:$('clearRouteBtn'),
    summary:$('routeSummary'), badge:$('routeBadge')
  };
  if(!ui.btn || !ui.dialog || !window.ManniStorage) return;
  let draftVia=[];

  function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function current(){ return window.ManniStorage.get().route; }
  function updateBadge(){
    const r=current();
    if(r.destination){
      ui.badge.textContent=r.destination;
      ui.badge.hidden=false;
      ui.summary.textContent=`Moja lokacija → ${r.via.length?r.via.join(' → ')+' → ':''}${r.destination}`;
    }else{
      ui.badge.hidden=true;
      ui.summary.textContent='Pot še ni nastavljena.';
    }
  }
  function renderVia(){
    ui.viaList.innerHTML='';
    if(!draftVia.length){
      ui.viaList.innerHTML='<div class="route-empty">Vmesne točke niso obvezne. Dodaj jih samo tam, kjer želiš Manniju določiti grobo smer poti.</div>';
      return;
    }
    draftVia.forEach((name,i)=>{
      const row=document.createElement('div');row.className='via-row';
      row.innerHTML=`<input class="via-input" data-i="${i}" value="${esc(name)}" placeholder="npr. Dunaj"><div class="via-actions"><button type="button" data-act="up" data-i="${i}" aria-label="Premakni gor">↑</button><button type="button" data-act="down" data-i="${i}" aria-label="Premakni dol">↓</button><button type="button" data-act="remove" data-i="${i}" aria-label="Odstrani">✕</button></div>`;
      ui.viaList.appendChild(row);
    });
  }
  function open(){
    const r=current();
    ui.destination.value=r.destination||'';
    draftVia=[...(r.via||[])];
    renderVia();
    ui.dialog.showModal();
  }
  function save(){
    document.querySelectorAll('.via-input').forEach(inp=>{const i=Number(inp.dataset.i);draftVia[i]=inp.value.trim()});
    draftVia=draftVia.map(v=>v.trim()).filter(Boolean);
    const destination=ui.destination.value.trim();
    window.ManniStorage.update(data=>{
      data.route={destination,via:draftVia,updatedAt:new Date().toISOString()};
      return data;
    });
    updateBadge();ui.dialog.close();
  }
  function clear(){
    window.ManniStorage.update(data=>{data.route={destination:'',via:[],updatedAt:new Date().toISOString()};return data});
    ui.destination.value='';draftVia=[];renderVia();updateBadge();
  }

  ui.btn.addEventListener('click',open);
  ui.close.addEventListener('click',()=>ui.dialog.close());
  ui.add.addEventListener('click',()=>{draftVia.push('');renderVia();setTimeout(()=>ui.viaList.querySelector('.via-input:last-of-type')?.focus(),0)});
  ui.save.addEventListener('click',save);
  ui.clear.addEventListener('click',clear);
  ui.viaList.addEventListener('input',e=>{if(e.target.matches('.via-input'))draftVia[Number(e.target.dataset.i)]=e.target.value});
  ui.viaList.addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]');if(!b)return;
    const i=Number(b.dataset.i),act=b.dataset.act;
    document.querySelectorAll('.via-input').forEach(inp=>{draftVia[Number(inp.dataset.i)]=inp.value});
    if(act==='remove')draftVia.splice(i,1);
    if(act==='up'&&i>0)[draftVia[i-1],draftVia[i]]=[draftVia[i],draftVia[i-1]];
    if(act==='down'&&i<draftVia.length-1)[draftVia[i+1],draftVia[i]]=[draftVia[i],draftVia[i+1]];
    renderVia();
  });
  window.addEventListener('manni:trip-changed',()=>{const r=current();ui.destination.value=r.destination||'';draftVia=[...(r.via||[])];renderVia();updateBadge()});
  updateBadge();
  console.info('Manni 3.4 route-beta: persistent route module ready');
})();
