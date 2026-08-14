// Manni's World 3.33 — local per-device personalisation.
(function(){
  const NAME_KEY='manniProfileName',IMG_FLAG='manniCustomSplash';
  const DEFAULT_NAME="Manni's World",DEFAULT_IMG='manni-splash-341.png';
  let currentUrl=null;
  function $(id){return document.getElementById(id)}
  function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('manni-personalisation',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('assets'))r.result.createObjectStore('assets')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
  async function putImage(blob){const db=await openDb();await new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(blob,'splash');tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();localStorage.setItem(IMG_FLAG,'1')}
  async function getImage(){const db=await openDb();const v=await new Promise((res,rej)=>{const tx=db.transaction('assets','readonly'),r=tx.objectStore('assets').get('splash');r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)});db.close();return v}
  async function deleteImage(){const db=await openDb();await new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').delete('splash');tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();localStorage.removeItem(IMG_FLAG)}
  function profileName(){return (localStorage.getItem(NAME_KEY)||DEFAULT_NAME).trim()||DEFAULT_NAME}
  function applyName(){const name=profileName();const title=document.querySelector('.brand-title span:last-child');if(title)title.textContent=name;document.title=name+' — Fuel';document.querySelectorAll('.eyebrow').forEach(x=>{if(x.textContent.trim()==="Manni's World"||x.dataset.profileBrand==='1'){x.dataset.profileBrand='1';x.textContent=name}})}
  async function applySplash(){const img=$('welcomeScreen')?.querySelector('.welcome-image');if(!img)return;try{const blob=await getImage();if(blob){if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=URL.createObjectURL(blob);img.src=currentUrl;img.dataset.custom='1'}else{img.src=DEFAULT_IMG;delete img.dataset.custom}}catch(e){console.warn('Splash load',e);img.src=DEFAULT_IMG}}
  function injectSettings(){
    const form=$('settingsDialog')?.querySelector('form');if(!form||$('languageSelect'))return;
    const first=form.querySelector('.settings-head');
    const section=document.createElement('section');section.className='personal-settings';section.innerHTML=`
      <div class="personal-settings-title"><span class="eyebrow">Personalizacija</span><strong>Profil in jezik</strong></div>
      <label class="field"><span>Jezik</span><select id="languageSelect"><option value="sl">Slovenščina</option><option value="de">Deutsch</option><option value="en">English</option></select></label>
      <label class="field"><span>Ime aplikacije / vozila</span><input id="profileNameInput" type="text" maxlength="40" placeholder="Manni's World"></label>
      <div class="field"><span>Naslovna slika</span><div class="splash-settings-row"><label class="image-pick-btn" for="splashImageInput">Izberi svojo sliko</label><input id="splashImageInput" type="file" accept="image/*" hidden><button id="resetSplashBtn" type="button" class="secondary-btn compact">Ponastavi naslovnico</button></div><small>Slika je shranjena samo na tej napravi.</small></div>
      <div id="splashPreview" class="splash-preview"><img alt="Naslovna slika"></div>
      <small class="local-profile-note">Profil in jezik sta shranjena samo na tej napravi.</small>`;
    first.insertAdjacentElement('afterend',section);
    const lang=$('languageSelect'),name=$('profileNameInput'),file=$('splashImageInput'),reset=$('resetSplashBtn'),preview=$('splashPreview').querySelector('img');
    lang.value=window.ManniI18n?.lang?.()||'sl';name.value=profileName();
    const syncPreview=async()=>{try{const b=await getImage();if(b){const u=URL.createObjectURL(b);preview.src=u;preview.onload=()=>URL.revokeObjectURL(u)}else preview.src=DEFAULT_IMG}catch{preview.src=DEFAULT_IMG}};syncPreview();
    lang.addEventListener('change',()=>window.ManniI18n?.setLanguage?.(lang.value));
    name.addEventListener('change',()=>{localStorage.setItem(NAME_KEY,name.value.trim()||DEFAULT_NAME);applyName()});
    file.addEventListener('change',async()=>{const f=file.files?.[0];if(!f)return;if(!f.type.startsWith('image/')){alert('Izberi slikovno datoteko.');return}if(f.size>12*1024*1024){alert('Slika je prevelika. Izberi sliko manjšo od 12 MB.');return}await putImage(f);await applySplash();await syncPreview()});
    reset.addEventListener('click',async()=>{await deleteImage();await applySplash();await syncPreview()});
    $('saveSettingsBtn')?.addEventListener('click',()=>{localStorage.setItem(NAME_KEY,name.value.trim()||DEFAULT_NAME);window.ManniI18n?.setLanguage?.(lang.value);applyName()});
    window.ManniI18n?.apply?.(section);
  }
  async function init(){applyName();await applySplash();injectSettings();window.addEventListener('manni:language-changed',()=>{applyName();setTimeout(()=>window.ManniI18n?.apply?.(document.body),0)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  window.ManniPersonalisation={profileName,applyName,applySplash};
})();
