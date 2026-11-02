const API_URL="https://script.google.com/macros/s/AKfycbwO7w7g9cGPZSjeWWvgjSdkH1Z2Tf6Jg7CSG9d21KzYyWr9Evb8niaavLO0GElqFI0bEA/exec";
let syncBusy=false;
const TKEY='lokalizator_opon_tires_v1';
const RKEY='lokalizator_opon_rims_v1';
const BACKUP_KEY='lokalizator_opon_backup_v1';

const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
let appToastTimer=null;
let appConfirmResolver=null;
function showAppToast(message='Zapisano',type='success'){
  const toast=$('#appToast');if(!toast)return;
  toast.textContent=message;
  toast.classList.remove('success','error','info');
  toast.classList.add(type,'show');
  clearTimeout(appToastTimer);
  const duration=type==='error'?4600:(type==='info'?3300:2200);
  appToastTimer=setTimeout(()=>toast.classList.remove('show'),duration);
}
function finishAppConfirm(result){
  const overlay=$('#appConfirm');
  if(overlay){overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');}
  if(appConfirmResolver){const resolve=appConfirmResolver;appConfirmResolver=null;resolve(!!result);}
}
function showAppConfirm(message,options={}){
  const overlay=$('#appConfirm');
  if(!overlay)return Promise.resolve(false);
  if(appConfirmResolver)finishAppConfirm(false);
  $('#appConfirmTitle').textContent=options.title||'Potwierdź działanie';
  $('#appConfirmMessage').textContent=message;
  const yes=$('#appConfirmYes');
  yes.textContent=options.confirmText||'Potwierdź';
  yes.classList.toggle('danger-confirm',options.danger!==false);
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  return new Promise(resolve=>{
    appConfirmResolver=resolve;
    $('#appConfirmNo').focus();
  });
}

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function normalizeTire(t){
  return {
    id:t.id||uid(),
    serial:String(t.serial||'').trim(),
    brand:String(t.brand||'').trim(),
    size:String(t.size||'').trim(),
    status:String(t.status||'Na magazynie'),
    location:String(t.location||'').trim(),
    notes:String(t.notes||'').trim(),
    createdAt:t.createdAt||new Date().toISOString(),
    updatedAt:t.updatedAt||new Date().toISOString()
  };
}
function loadLocal(){
  try{const raw=localStorage.getItem(TKEY);return raw?JSON.parse(raw).map(normalizeTire):[];}catch(e){return [];}
}
function normalizeRim(r){
  return {
    id:String(r.id||uid()),
    styling:String(r.styling||'').trim(),
    productNumber:String(r.productNumber||'').trim(),
    quantity:Math.max(0,Math.floor(Number(r.quantity)||0)),
    location:String(r.location||'').trim(),
    notes:String(r.notes||'').trim(),
    createdAt:r.createdAt||new Date().toISOString(),
    updatedAt:r.updatedAt||new Date().toISOString()
  };
}
function loadLocalRims(){
  try{const raw=localStorage.getItem(RKEY);return raw?JSON.parse(raw).map(normalizeRim):[];}catch(e){return [];}
}
let tires=loadLocal();
let rims=loadLocalRims();
let rimSyncBusy=false;

function setSyncStatus(text,ok=false){
  const el=$('#syncStatus');
  if(!el)return;
  el.textContent=text;
  el.style.color=ok?'#176b5b':'#66727f';
}
function saveLocal(){
  try{localStorage.setItem(TKEY,JSON.stringify(tires));return true;}
  catch(e){showAppToast('Nie udało się zapisać lokalnej kopii danych.','error');return false;}
}
function saveRimsLocal(){
  try{localStorage.setItem(RKEY,JSON.stringify(rims));return true;}
  catch(e){showAppToast('Nie udało się zapisać lokalnej kopii felg.','error');return false;}
}
function makeBackupObject(){return {app:'lokalizator-opon',name:'Lokalizator opon i felg',version:2,createdAt:new Date().toISOString(),tires:tires,rims:rims};}
function saveInternalBackup(){try{localStorage.setItem(BACKUP_KEY,JSON.stringify(makeBackupObject()));updateBackupInfo();}catch(e){}}
function updateBackupInfo(){
  const box=$('#backupInfo'); if(!box)return;
  try{
    const raw=localStorage.getItem(BACKUP_KEY);
    if(raw){const d=new Date(JSON.parse(raw).createdAt);box.textContent='Ostatnia lokalna kopia: '+d.toLocaleString('pl-PL')+'.';}
    else box.textContent='Lokalna kopia nie została jeszcze utworzona.';
  }catch(e){box.textContent='';}
}
function downloadBackup(){
  const blob=new Blob([JSON.stringify(makeBackupObject(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='lokalizator-opon-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);saveInternalBackup();
}

function jsonp(params, timeout=15000){
  return new Promise((resolve,reject)=>{
    const callback='__lokalizatorOpon_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
    const script=document.createElement('script');
    let finished=false;
    const cleanup=()=>{delete window[callback];script.remove();clearTimeout(timer);};
    const timer=setTimeout(()=>{if(finished)return;finished=true;cleanup();reject(new Error('Przekroczono czas połączenia z Google Sheets.'));},timeout);
    window[callback]=(data)=>{if(finished)return;finished=true;cleanup();resolve(data);};
    script.onerror=()=>{if(finished)return;finished=true;cleanup();reject(new Error('Nie udało się połączyć z Google Sheets.'));};
    const query=new URLSearchParams({...params,callback,ts:String(Date.now())});
    script.src=API_URL+'?'+query.toString();
    document.head.appendChild(script);
  });
}
async function apiGet(){
  const data=await jsonp({action:'get'});
  if(!Array.isArray(data))throw new Error('Nieprawidłowa odpowiedź bazy.');
  return data.map(normalizeTire).filter(t=>t.serial);
}
async function apiPost(payload){
  const params={action:payload.action||''};
  if(payload.tire){
    params.serial=String(payload.tire.serial||'');
    params.brand=String(payload.tire.brand||'');
    params.size=String(payload.tire.size||'');
    params.location=String(payload.tire.location||'');
    params.status=String(payload.tire.status||'');
    params.notes=String(payload.tire.notes||'');
  }
  if(payload.serial)params.serial=String(payload.serial);
  const data=await jsonp(params);
  if(!data || !data.success)throw new Error(data?.error||'Błąd operacji.');
  return data;
}

// Felgi mają osobny zestaw operacji i osobny arkusz. Wartości pól nie są unikalne.
async function apiGetRims(){
  const data=await jsonp({action:'getRims'});
  if(!Array.isArray(data))throw new Error('Nieprawidłowa odpowiedź bazy felg.');
  return data.map(normalizeRim).filter(r=>r.id&&r.styling&&r.location);
}
async function apiPostRim(payload){
  const params={action:payload.action||''};
  if(payload.rim){
    params.id=String(payload.rim.id||'');
    params.styling=String(payload.rim.styling||'');
    params.productNumber=String(payload.rim.productNumber||'');
    params.quantity=String(payload.rim.quantity||'');
    params.location=String(payload.rim.location||'');
    params.notes=String(payload.rim.notes||'');
  }
  if(payload.id)params.id=String(payload.id);
  const data=await jsonp(params);
  if(!data||!data.success)throw new Error(data?.error||'Błąd operacji na felgach.');
  return data;
}

async function syncRimsFromCloud(options={}){
  if(rimSyncBusy)return;
  rimSyncBusy=true;
  const status=$('#rimSyncStatus');
  if(status&&!options.silent)status.textContent='Pobieranie felg z Google Sheets…';
  try{
    const remote=await apiGetRims();
    rims=remote;
    saveRimsLocal();
    saveInternalBackup();
    renderRims();
    if(status){status.textContent='Połączono ze wspólną bazą felg • '+rims.length+' wpisów';status.style.color='var(--accent)';}
    return true;
  }catch(e){
    console.error(e);
    renderRims();
    if(status){status.textContent='Brak połączenia z bazą felg. Pokazuję ostatnią lokalną kopię.';status.style.color='var(--muted)';}
    return false;
  }finally{rimSyncBusy=false;}
}

async function syncFromCloud(options={}){
  if(syncBusy)return;
  syncBusy=true;
  if(!options.silent)setSyncStatus('Pobieranie danych z Google Sheets…');
  try{
    const remote=await apiGet();
    if(remote.length===0 && tires.length>0 && options.allowMigration!==false){
      setSyncStatus('Wspólna baza jest pusta. Przenoszę dane z tego urządzenia…');
      for(const t of tires)await apiPost({action:'add',tire:t});
      const migrated=await apiGet();
      tires=migrated;saveLocal();saveInternalBackup();render();
      setSyncStatus('Połączono. Dane zostały przeniesione do wspólnej bazy.',true);
      return;
    }
    tires=remote;saveLocal();saveInternalBackup();render();
    setSyncStatus('Połączono z Google Sheets • '+tires.length+' opon • synchronizacja co 60 s',true);
  }catch(e){
    console.error(e);
    render();
    setSyncStatus('Brak połączenia z Google Sheets. Pokazuję ostatnią lokalną kopię.');
  }finally{syncBusy=false;}
}

async function addRemote(tire){await apiPost({action:'add',tire});}
async function updateRemote(tire){await apiPost({action:'update',tire});}
async function deleteRemote(serial){await apiPost({action:'delete',serial});}

function locations(){return [...new Set(tires.map(t=>String(t.location||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pl'));}
function showView(name){$$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$$('.view').forEach(v=>v.classList.toggle('active',v.id===name));render();renderRims();}

function render(){
  const locs=locations();
  const selectedLocation=$('#filterLocation').value;
  const selectedStatus=$('#filterStatus').value;
  $('#statTotal').textContent=tires.length;
  $('#statStock').textContent=tires.filter(t=>t.status==='Na magazynie').length;
  $('#statLocations').textContent=locs.length;
  $('#statRecent').textContent=tires.filter(t=>Date.now()-new Date(t.createdAt).getTime()<7*864e5).length;
  $('#filterLocation').innerHTML='<option value="">Wszystkie lokalizacje</option>'+locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
  if(locs.includes(selectedLocation))$('#filterLocation').value=selectedLocation;
  if([...$('#filterStatus').options].some(o=>o.value===selectedStatus))$('#filterStatus').value=selectedStatus;
  const q=$('#search').value.trim().toLowerCase(),fl=$('#filterLocation').value,fs=$('#filterStatus').value;
  const rows=tires.filter(t=>{
    const text=[t.serial,t.brand,t.size,t.location,t.notes].join(' ').toLowerCase();
    return(!q||text.includes(q))&&(!fl||t.location===fl)&&(!fs||t.status===fs);
  });
  $('#tireRows').innerHTML=rows.length?rows.map(t=>`<tr><td class="serial">${esc(t.serial)}</td><td>${esc(t.brand||'—')}</td><td>${esc(t.size||'—')}</td><td class="loc">${esc(t.location)}</td><td><span class="badge">${esc(t.status)}</span></td><td><div class="row-actions"><button type="button" class="btn primary" data-edit="${esc(t.id)}">Edytuj</button><button type="button" class="btn danger" data-delete="${esc(t.id)}">Usuń</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Brak zapisanych opon.</td></tr>';
  const dl=$('#locationSuggestions');
  if(dl)dl.innerHTML=locs.map(l=>`<option value="${esc(l)}"></option>`).join('');
}

function rimLocations(){return [...new Set(rims.map(r=>String(r.location||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pl'));}
function renderRims(){
  const rowsEl=$('#rimRows'),filterEl=$('#rimFilterLocation'),searchEl=$('#rimSearch');
  if(!rowsEl||!filterEl||!searchEl)return;
  const locs=rimLocations(),selected=filterEl.value;
  filterEl.innerHTML='<option value="">Wszystkie lokalizacje</option>'+locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
  if(locs.includes(selected))filterEl.value=selected;
  const q=searchEl.value.trim().toLowerCase(),loc=filterEl.value;
  const filtered=rims.filter(r=>{
    const hay=[r.styling,r.productNumber,r.location,r.notes].join(' ').toLowerCase();
    return (!q||hay.includes(q))&&(!loc||r.location===loc);
  });
  rowsEl.innerHTML=filtered.length?filtered.map(r=>`<tr><td class="serial">${esc(r.styling)}</td><td>${esc(r.productNumber||'—')}</td><td><span class="badge">${esc(String(r.quantity))}</span></td><td class="loc">${esc(r.location)}</td><td>${esc(r.notes||'—')}</td><td><div class="row-actions"><button type="button" class="btn primary" data-rim-edit="${esc(r.id)}">Edytuj</button><button type="button" class="btn danger" data-rim-delete="${esc(r.id)}">Usuń</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Brak zapisanych wpisów felg.</td></tr>';
  const dl=$('#rimLocationSuggestions');
  if(dl)dl.innerHTML=locs.map(l=>`<option value="${esc(l)}"></option>`).join('');
}
function openRim(id){
  const r=rims.find(x=>x.id===id);if(!r)return;
  $('#editRimId').value=r.id;
  $('#rimStyling').value=r.styling;
  $('#rimProduct').value=r.productNumber;
  $('#rimQuantity').value=r.quantity;
  $('#rimLocation').value=r.location;
  $('#rimNotes').value=r.notes;
  $('#rimModalTitle').textContent='Edytuj wpis felg';
  $('#rimModal').classList.add('open');
}
function closeRim(){ $('#rimModal').classList.remove('open'); }

$('#quickRimForm').addEventListener('submit',async function(e){
  e.preventDefault();
  const styling=$('#quickRimStyling').value.trim();
  const productNumber=$('#quickRimProduct').value.trim();
  const quantity=Number($('#quickRimQuantity').value);
  const location=$('#quickRimLocation').value.trim();
  if(!styling||!location||!Number.isInteger(quantity)||quantity<1){showAppToast('Uzupełnij styling, ilość i lokalizację.','error');return;}
  const rim=normalizeRim({id:uid(),styling,productNumber,quantity,location,notes:$('#quickRimNotes').value.trim(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  try{
    $('#rimSyncStatus').textContent='Zapisywanie wpisu felg…';
    await apiPostRim({action:'addRim',rim});
    this.reset();$('#quickRimQuantity').value='1';
    await syncRimsFromCloud({silent:true});
    showAppToast('Zapisano');
  }catch(err){showAppToast('Nie udało się zapisać wpisu felg: '+err.message,'error');$('#rimSyncStatus').textContent='Nie udało się zapisać wpisu.';}
});

$('#rimForm').addEventListener('submit',async function(e){
  e.preventDefault();
  const id=$('#editRimId').value,existing=rims.find(x=>x.id===id);
  if(!existing){showAppToast('Nie znaleziono wpisu felg.','error');return;}
  const quantity=Number($('#rimQuantity').value),styling=$('#rimStyling').value.trim(),productNumber=$('#rimProduct').value.trim(),location=$('#rimLocation').value.trim();
  if(!styling||!location||!Number.isInteger(quantity)||quantity<1){showAppToast('Uzupełnij styling, ilość i lokalizację.','error');return;}
  const updated=normalizeRim({...existing,styling,productNumber,quantity,location,notes:$('#rimNotes').value.trim(),updatedAt:new Date().toISOString()});
  try{await apiPostRim({action:'updateRim',rim:updated});closeRim();await syncRimsFromCloud({silent:true});showAppToast('Zapisano');}
  catch(err){showAppToast('Nie udało się zapisać zmian: '+err.message,'error');}
});

$('#rimRows').addEventListener('click',async function(e){
  const edit=e.target.closest('[data-rim-edit]'),del=e.target.closest('[data-rim-delete]');
  if(edit){openRim(edit.dataset.rimEdit);return;}
  if(del){
    const r=rims.find(x=>x.id===del.dataset.rimDelete);if(!r)return;
    if(await showAppConfirm('Czy na pewno usunąć ten wpis?\n'+r.styling+' • '+(r.productNumber||'bez numeru produktu')+' • '+r.location+' • ilość: '+r.quantity,{title:'Usuń wpis felg',confirmText:'Usuń'})){
      try{await apiPostRim({action:'deleteRim',id:r.id});await syncRimsFromCloud({silent:true});showAppToast('Usunięto');}
      catch(err){showAppToast('Nie udało się usunąć wpisu felg: '+err.message,'error');}
    }
  }
});

function openTire(id=''){
  const t=tires.find(x=>x.id===id);$('#editId').value=id;$('#modalTitle').textContent=t?'Edytuj oponę':'Dodaj oponę';
  $('#serial').value=t?.serial||'';$('#brand').value=t?.brand||'';$('#size').value=t?.size||'';$('#status').value=t?.status||'Na magazynie';$('#location').value=t?.location||'';$('#notes').value=t?.notes||'';
  $('#serial').disabled=!!t;$('#modal').classList.add('open');
}
function closeTire(){$('#modal').classList.remove('open');$('#serial').disabled=false;}

$('#quickTireForm').addEventListener('submit',async function(e){
  e.preventDefault();
  const serial=$('#quickSerial').value.trim(),location=$('#quickLocation').value.trim();
  if(!serial){showAppToast('Wpisz numer seryjny.','error');return;}if(!location){showAppToast('Wpisz lokalizację.','error');return;}
  if(tires.some(t=>t.serial.toLowerCase()===serial.toLowerCase())){showAppToast('Ten numer seryjny już istnieje.','error');return;}
  const tire=normalizeTire({id:uid(),serial,brand:$('#quickBrand').value.trim(),size:$('#quickSize').value.trim(),status:$('#quickStatus').value,location,notes:$('#quickNotes').value.trim(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  try{setSyncStatus('Zapisywanie opony…');await addRemote(tire);this.reset();await syncFromCloud({allowMigration:false});showAppToast('Zapisano');}
  catch(e){showAppToast('Nie udało się zapisać opony: '+e.message,'error');setSyncStatus('Nie udało się zapisać zmian.');}
});

$('#tireForm').addEventListener('submit',async function(e){
  e.preventDefault();const id=$('#editId').value,t=tires.find(x=>x.id===id),location=$('#location').value.trim();
  if(!t){showAppToast('Nie znaleziono opony.','error');return;}if(!location){showAppToast('Lokalizacja jest wymagana.','error');return;}
  const updated={...t,brand:$('#brand').value.trim(),size:$('#size').value.trim(),status:$('#status').value,location,notes:$('#notes').value.trim(),updatedAt:new Date().toISOString()};
  try{setSyncStatus('Zapisywanie zmian…');await updateRemote(updated);closeTire();await syncFromCloud({allowMigration:false});showAppToast('Zapisano');}
  catch(e){showAppToast('Nie udało się zapisać zmian: '+e.message,'error');setSyncStatus('Nie udało się zapisać zmian.');}
});

$('#tireRows').addEventListener('click',async function(e){
  const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');
  if(edit){openTire(edit.dataset.edit);return;}
  if(del){const t=tires.find(x=>x.id===del.dataset.delete);if(!t)return;if(await showAppConfirm('Czy na pewno usunąć oponę '+t.serial+'?',{title:'Usuń oponę',confirmText:'Usuń'})){try{setSyncStatus('Usuwanie opony…');await deleteRemote(t.serial);await syncFromCloud({allowMigration:false});showAppToast('Usunięto');}catch(err){showAppToast('Nie udało się usunąć opony: '+err.message,'error');setSyncStatus('Nie udało się usunąć zmian.');}}}
});

$$('.nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
$('#addBtn')?.addEventListener('click',()=>openTire());$('#closeModal')?.addEventListener('click',closeTire);$('#cancel')?.addEventListener('click',closeTire);
$('#search').addEventListener('input',render);$('#filterLocation').addEventListener('change',render);$('#filterStatus').addEventListener('change',render);
$('#rimSearch').addEventListener('input',renderRims);$('#rimFilterLocation').addEventListener('change',renderRims);
$('#rimRefreshBtn').addEventListener('click',()=>syncRimsFromCloud());
$('#closeRimModal').addEventListener('click',closeRim);$('#cancelRim').addEventListener('click',closeRim);
$('#rimModal').addEventListener('click',e=>{if(e.target===$('#rimModal'))closeRim();});
$('#appConfirmNo').addEventListener('click',()=>finishAppConfirm(false));
$('#appConfirmYes').addEventListener('click',()=>finishAppConfirm(true));
$('#appConfirm').addEventListener('click',e=>{if(e.target===$('#appConfirm'))finishAppConfirm(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#appConfirm').classList.contains('open'))finishAppConfirm(false);});

function quickSearch(){
  const q=$('#quickSearch').value.trim().toLowerCase(),box=$('#quickResult');if(!q){box.innerHTML='';return;}
  const found=tires.filter(t=>String(t.serial||'').toLowerCase().includes(q));
  if(!found.length){box.innerHTML='<div style="background:#fff;border-radius:10px;padding:12px 14px;color:#4f5d6b">Nie znaleziono opony o takim numerze.</div>';return;}
  box.innerHTML=found.map(t=>`<div style="background:#fff;border-radius:10px;padding:14px;color:#17202a;margin-top:8px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><b>Numer: ${esc(t.serial)}</b><br><span style="color:#176b5b;font-weight:750">Lokalizacja: ${esc(t.location)}</span>${t.brand?`<br><span style="color:#4f5d6b">Marka: ${esc(t.brand)}</span>`:''}${t.size?`<br><span style="color:#4f5d6b">Rozmiar: ${esc(t.size)}</span>`:''}<br><span style="color:#4f5d6b">Status: ${esc(t.status)}</span></div><button type="button" class="btn danger" data-quick-delete="${esc(t.id)}">Usuń oponę</button></div></div>`).join('');
}
$('#quickResult').addEventListener('click',async function(e){const btn=e.target.closest('[data-quick-delete]');if(!btn)return;const t=tires.find(x=>x.id===btn.dataset.quickDelete);if(!t)return;if(await showAppConfirm('Czy na pewno usunąć oponę '+t.serial+'?',{title:'Usuń oponę',confirmText:'Usuń'})){try{setSyncStatus('Usuwanie opony…');await deleteRemote(t.serial);await syncFromCloud({allowMigration:false});quickSearch();showAppToast('Usunięto');}catch(err){showAppToast('Nie udało się usunąć opony: '+err.message,'error');}}});
$('#quickBtn')?.addEventListener('click',quickSearch);$('#quickSearch')?.addEventListener('input',quickSearch);$('#quickSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();quickSearch();}});

$('#backupBtn')?.addEventListener('click',downloadBackup);
$('#refreshBtn')?.addEventListener('click',()=>syncFromCloud({allowMigration:false}));
$('#restoreBtn')?.addEventListener('click',()=>$('#restoreFile').click());
$('#restoreFile')?.addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;e.target.value='';
  try{
    const data=JSON.parse(await file.text());
    if(!data||data.app!=='lokalizator-opon'||!Array.isArray(data.tires))throw new Error('Nieprawidłowy plik kopii.');
    if(!await showAppConfirm('Przywrócić dane z tej kopii do wspólnej bazy? Obecne dane zostaną zastąpione.',{title:'Przywracanie kopii',confirmText:'Przywróć'}))return;
    const current=await apiGet();
    setSyncStatus('Przywracanie kopii…');
    for(const t of current)await deleteRemote(t.serial);
    for(const t of data.tires.map(normalizeTire).filter(t=>t.serial))await addRemote(t);
    if(Array.isArray(data.rims)){
      const currentRims=await apiGetRims();
      for(const r of currentRims)await apiPostRim({action:'deleteRim',id:r.id});
      for(const r of data.rims.map(normalizeRim))await apiPostRim({action:'addRim',rim:r});
    }
    await syncFromCloud({allowMigration:false});
    await syncRimsFromCloud({silent:true});
    showAppToast('Kopia przywrócona');
  }catch(err){showAppToast('Nie udało się przywrócić kopii: '+err.message,'error');}
});

updateBackupInfo();render();renderRims();syncFromCloud();syncRimsFromCloud();
setInterval(()=>{syncFromCloud({silent:true,allowMigration:false});syncRimsFromCloud({silent:true});},60000);
