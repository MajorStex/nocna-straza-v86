// Noćna Straža v82 — actual Firebase Auth + per-account Firestore cloud saves.
// No self-made password storage, fake accounts or default shared login.
// Firebase project must be configured by the owner before this module enables cloud features.
const ROOT = document.getElementById('ns82-auth');
const el = id => document.getElementById(id);
const KEYS = /^ns(?:[0-9a-z_-]*)$/i;
const EXCLUDE = /^(?:ns61_relay_url|ns69_cloud_recovery_v1|ns82_)/;
const MAX_KEY = 125, CHUNK_CHARS = 140000, MAX_BYTES = 4200000;
const LOCK = 'ns82_cloud_pending';
const CONFIG = window.NS82_FIREBASE_CONFIG || {};
const configured = Boolean(CONFIG.apiKey && CONFIG.authDomain && CONFIG.projectId && CONFIG.appId);
let sdk, db, auth, currentUser=null, cloudReady=false, guestMode=false, syncing=false;
let known=new Map(), snapshotSaved=new Map(), debounce=null, lang='en', authBusy=false;
let accountUid='', sessionUid='', bootstrap=false, lastSync=0, needsSync=false;
let lastError='';

function tr(en,sr){return lang==='sr'?sr:en}
function language(){try{return JSON.parse(localStorage.getItem('ns_game_language_v1'))==='sr'?'sr':'en'}catch{return 'en'}}
function setMessage(text,kind='info'){
 const node=el('ns82-info'); if(!node)return;
 node.textContent=text; node.dataset.kind=kind;
}
function status(text,kind='info'){
 const e=el('ns82-status');if(e){e.textContent=text;e.dataset.kind=kind;}
 const p=el('ns82-profile-status');if(p){p.textContent=text;p.dataset.kind=kind;}
}
function setVisible(show){if(ROOT)ROOT.hidden=!show}
function setBusy(b){authBusy=b;for(const btt of ROOT.querySelectorAll('button[data-auth-action]'))btt.disabled=b;}
function isPlay(){return !!document.getElementById('gameCanvas')}
function isSaveKey(key){return typeof key==='string'&&key.length>0&&key.length<=MAX_KEY&&KEYS.test(key)&&!EXCLUDE.test(key)}
function currentSave(){const out=new Map();try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(isSaveKey(key)){const value=localStorage.getItem(key);if(typeof value==='string')out.set(key,value);}}}catch{}return out}
function byteLength(str){return new TextEncoder().encode(str).length}
function splitSave(value){
 const parts=[];
 for(let i=0;i<value.length;){
  let end=Math.min(i+CHUNK_CHARS,value.length);
  const last=value.charCodeAt(end-1);
  if(end<value.length&&last>=0xD800&&last<=0xDBFF)end--;
  parts.push(value.slice(i,end));i=end;
 }
 return parts.length?parts:[''];
}
function safeSet(k,v){try{localStorage.setItem(k,v)}catch(e){throw new Error(tr('Not enough phone storage.','Nema dovoljno prostora u telefonu.'))}}
function changed(a,b){if(a.size!==b.size)return true;for(const [k,v] of a)if(b.get(k)!==v)return true;return false}
function getDirty(uid){try{return localStorage.getItem(LOCK)==='u:'+uid}catch{return false}}
function markDirty(){if(!currentUser||!cloudReady||guestMode)return;
 needsSync=true; try{localStorage.setItem(LOCK,'u:'+currentUser.uid)}catch{}
 if(!debounce)debounce=setTimeout(()=>{debounce=null;void flush()},Math.max(3500,30000-(Date.now()-lastSync)));
 status(tr('Unsaved changes • syncing…','Nesačuvane izmene • sinhronizujem…'),'pending');
}
async function flush(force=false){
 if(!sdk||!db||!currentUser||!cloudReady||guestMode||syncing)return false;
 if(document.visibilityState==='hidden'&&!force)force=true;
 // Save changes only; avoid unnecessary Firestore writes.
 const present=currentSave();
 const next=new Map([...present].filter(([k,v])=>byteLength(v)<=MAX_BYTES));
 const skipped=[...present].filter(([k,v])=>byteLength(v)>MAX_BYTES).map(([k])=>k);
 if(skipped.length){status(tr('Some large saves could not be synced; export a backup.','Neki veliki zapisi nisu sinhronizovani; izvezi rezervnu kopiju.'),'error')}
 const writes=[];
 for(const [k,v] of next)if(known.get(k)!==v){
  const parts=splitSave(v),total=parts.length;
  if(total>81){skipped.push(k);continue}
  for(let part=0;part<total;part++)writes.push({key:k,value:parts[part],part,total,deleted:false,full:v});
 }
 for(const k of known.keys())if(!next.has(k)&&!present.has(k))writes.push({key:k,value:'',part:0,total:1,deleted:true});
 if(!writes.length){needsSync=false;try{localStorage.removeItem(LOCK)}catch{};if(!skipped.length)status(tr('Saved to cloud ✓','Sačuvano u cloudu ✓'),'ok');return true}
 syncing=true;status(tr('Saving to cloud…','Čuvam u cloudu…'),'pending');
 try{
  // Firestore batches: bounded to 25 docs (~3.5 MB) per commit.
  for(let start=0;start<writes.length;start+=25){
   const batch=sdk.writeBatch(db);
   for(const w of writes.slice(start,start+25)){
    const ref=sdk.doc(db,'users',currentUser.uid,'saves',encodeURIComponent(w.key)+'~'+w.part);
    batch.set(ref,{key:w.key,value:w.value,deleted:w.deleted,part:w.part,total:w.total,schema:1,updatedAt:sdk.serverTimestamp()});
   }
   await batch.commit();
   for(const w of writes.slice(start,start+25)){if(w.deleted)known.delete(w.key);else if(w.part===w.total-1)known.set(w.key,w.full)}
  }
  lastSync=Date.now();snapshotSaved=currentSave();needsSync=changed(snapshotSaved,known);
  if(!needsSync)try{localStorage.removeItem(LOCK)}catch{}
  if(!skipped.length)status(tr('Saved to cloud ✓','Sačuvano u cloudu ✓'),'ok');
  return true;
 }catch(err){lastError=String(err.code||err.message||err);
  status(tr('Cloud sync failed. Local save is safe.','Cloud sinhronizacija nije uspela. Lokalni napredak je sačuvan.'),'error');
  return false;
 }finally{syncing=false; if(needsSync&&document.visibilityState!=='hidden')clearTimeout(debounce),debounce=setTimeout(()=>void flush(),20000)}
}
function backupLocal(label){
 const saved=Object.fromEntries(currentSave());try{
  const name='ns82_backup_'+label;localStorage.setItem(name,JSON.stringify({date:new Date().toISOString(),saved}));
  return true;
 }catch{return false}
}
function applyCloud(saved){
 // Authenticated account is never mixed with another account on shared device.
 const local=currentSave();
 if(!changed(saved,local))return false;
 backupLocal('before_restore');
 for(const k of local.keys())if(!saved.has(k))localStorage.removeItem(k);
 for(const [k,v] of saved)safeSet(k,v);
 return true;
}
function gameReset(){for(const k of currentSave().keys())localStorage.removeItem(k)}
async function bootstrapCloud(user){
 if(bootstrap||!db)return;
 bootstrap=true;accountUid=user.uid;cloudReady=false;
 status(tr('Reading cloud saves…','Učitavam napredak iz clouda…'),'pending');
 try{
  const items=await sdk.getDocs(sdk.collection(db,'users',user.uid,'saves'));
  const groups=new Map();
  for(const p of items.docs){const v=p.data();if(!isSaveKey(v.key)||typeof v.value!=='string')continue;
   const part=Number.isInteger(v.part)?v.part:0,total=Number.isInteger(v.total)?v.total:1;
   if(part<0||part>80||total<1||total>81)continue;
   if(!groups.has(v.key))groups.set(v.key,{parts:new Map(),total:0,deleted:false});
   const g=groups.get(v.key);
   if(part===0){g.total=total;g.deleted=!!v.deleted}
   g.parts.set(part,v.value);
  }
  const saved=new Map();
  for(const [k,g] of groups){if(g.deleted||!g.total)continue;
   if(Array.from({length:g.total},(_,i)=>g.parts.has(i)).some(ok=>!ok))throw Error('Incomplete cloud save for '+k);
   saved.set(k,Array.from({length:g.total},(_,i)=>g.parts.get(i)).join(''));
  }
  const local=currentSave();
  const pending=getDirty(user.uid);
  // Local changes from a previously offline session win only for the same UID.
  if(pending){known=saved;cloudReady=true;markDirty();status(tr('Restoring offline changes…','Čuvam izmene nastale bez interneta…'),'pending');return;}
  if(items.empty){
   if(sessionUid && sessionUid!==user.uid){
    backupLocal('before_account_switch');gameReset();known=new Map();cloudReady=true;
    sessionUid=user.uid;window.sessionStorage.setItem('ns82_verified_uid',user.uid);location.reload();return;
   }
   known=new Map();cloudReady=true;
   if(local.size){
    const confirmImport=window.confirm(tr(
     'Found existing Night Watch progress on this device. Import it to your new cloud account? Choose Cancel for a fresh profile.',
     'Pronađen je postojeći napredak Noćne Straže na telefonu. Želiš li da ga prebaciš na novi cloud nalog? Otkaži za prazan profil.'));
    if(confirmImport){markDirty();await flush(true)}
    else{backupLocal('before_new_profile');gameReset();known=new Map();snapshotSaved=new Map();sessionUid=user.uid;window.sessionStorage.setItem('ns82_verified_uid',user.uid);location.reload();return}
   }else status(tr('Cloud account ready ✓','Cloud nalog spreman ✓'),'ok');
  }else{
   known=saved;
   const changedDevice=applyCloud(saved);
   cloudReady=true;snapshotSaved=currentSave();
   if(changedDevice){sessionUid=user.uid;window.sessionStorage.setItem('ns82_verified_uid',user.uid);location.reload();return}
   status(tr('Cloud progress loaded ✓','Cloud napredak učitan ✓'),'ok');
  }
  snapshotSaved=currentSave();sessionUid=user.uid;
  window.sessionStorage.setItem('ns82_verified_uid',user.uid);
  setVisible(false);
 }catch(err){cloudReady=false;lastError=String(err.code||err.message||err);
  status(tr('Cloud unavailable — playing locally. Do not erase browser data.','Cloud trenutno nije dostupan — igraš lokalno. Ne briši podatke pregledača.'),'error');
  setMessage(tr('Could not load your cloud save. Check Firestore rules and internet.',
  'Ne mogu da učitam cloud napredak. Proveri Firestore pravila i internet.'),'error');
  guestMode=true;setVisible(false);
 }finally{bootstrap=false}
}
async function loadSession(user){
 currentUser=user;
 const who=el('ns82-who');if(who)who.textContent=user?.email||tr('Google account','Google nalog');
 if(!user){cloudReady=false;known.clear();accountUid='';sessionUid='';
  status(configured?tr('Guest • local save','Gost • lokalno čuvanje'):tr('Cloud not configured','Cloud nije podešen'),'pending');
  if(!guestMode)setVisible(true);return;
 }
 guestMode=false;setVisible(false);
 sessionUid=window.sessionStorage.getItem('ns82_verified_uid')||'';
 await bootstrapCloud(user);
 const verify=el('ns82-verify');if(verify)verify.hidden=!!user.emailVerified;
}
function errorText(err){const code=String(err?.code||'');
 if(/invalid-credential|wrong-password|user-not-found/.test(code))return tr('Incorrect email or password.','Netačan email ili lozinka.');
 if(/email-already-in-use/.test(code))return tr('This email already has an account. Sign in instead.','Ovaj email već ima nalog. Prijavi se.');
 if(/weak-password/.test(code))return tr('Choose a stronger password.','Izaberi jaču lozinku.');
 if(/invalid-email/.test(code))return tr('Enter a valid email address.','Upiši ispravnu email adresu.');
 if(/unauthorized-domain/.test(code))return tr('Game domain is not authorized in Firebase.','Domen igre nije odobren u Firebase podešavanjima.');
 if(/popup-blocked|popup-closed-by-user|cancelled-popup/.test(code))return tr('Google window was blocked or closed. Open the game in Chrome and try again.','Google prozor je blokiran ili zatvoren. Otvori igru u Chrome-u i probaj ponovo.');
 if(/network-request-failed|unavailable/.test(code))return tr('Network unavailable. Try again.','Mreža nije dostupna. Probaj ponovo.');
 if(/too-many-requests/.test(code))return tr('Too many attempts. Try later.','Previše pokušaja. Probaj kasnije.');
 return tr('Authentication error. Try again.','Greška prijave. Probaj ponovo.')+' ('+(code||'unknown')+')';
}
function setMode(mode){const reg=mode==='signup';
 el('ns82-register').dataset.active=reg?'true':'false';el('ns82-signin').dataset.active=reg?'false':'true';
 el('ns82-confirm-wrap').hidden=!reg;el('ns82-confirm').required=reg;
 el('ns82-password').autocomplete=reg?'new-password':'current-password';
 el('ns82-action').textContent=reg?tr('CREATE ACCOUNT','NAPRAVI NALOG'):tr('SIGN IN','PRIJAVI SE');
 el('ns82-forgot').hidden=reg;
 el('ns82-email').focus({preventScroll:true});
}
async function run(fn){if(!configured||!sdk||authBusy)return;
 setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(errorText(e),'error');}finally{setBusy(false)}
}
async function submit(e){e.preventDefault();if(!sdk)return;
 const email=el('ns82-email').value.trim(),pass=el('ns82-password').value,
  signup=!el('ns82-confirm-wrap').hidden;
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){setMessage(tr('Enter your email.','Unesi email.'),'error');return}
 if(pass.length<8){setMessage(tr('Password must be at least 8 characters.','Lozinka mora imati najmanje 8 karaktera.'),'error');return}
 if(signup&&pass!==el('ns82-confirm').value){setMessage(tr('Passwords do not match.','Lozinke se ne poklapaju.'),'error');return}
 await run(async()=>{
  await sdk.setPersistence(auth,el('ns82-remember').checked?sdk.browserLocalPersistence:sdk.browserSessionPersistence);
  const credential=signup?await sdk.createUserWithEmailAndPassword(auth,email,pass):await sdk.signInWithEmailAndPassword(auth,email,pass);
  if(signup){try{await sdk.sendEmailVerification(credential.user)}catch{};
   setMessage(tr('Account created! Check your email to verify it.','Nalog napravljen! Potvrdi email iz poruke.'),'ok');}
 });
}
async function linkGoogle(){if(!currentUser||!sdk)return;await run(async()=>{
 const provider=new sdk.GoogleAuthProvider();
 await sdk.linkWithPopup(currentUser,provider);
 setMessage(tr('Google login linked to this profile.','Google prijava je povezana sa ovim profilom.'),'ok');
 })}
async function loginGoogle(){await run(async()=>{
 await sdk.setPersistence(auth,el('ns82-remember').checked?sdk.browserLocalPersistence:sdk.browserSessionPersistence);
 const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
 await sdk.signInWithPopup(auth,provider);
 });}
async function sendReset(){if(!sdk)return;
 const e=el('ns82-email').value.trim();if(!e){setMessage(tr('Enter your email first.','Prvo unesi email.'),'error');return}
 await run(async()=>{await sdk.sendPasswordResetEmail(auth,e);setMessage(tr('If this email is registered, a reset link has been sent.','Ako je email registrovan, poslat je link za promenu lozinke.'),'ok')});
}
async function signOut(){if(!auth||!currentUser)return;
 if(isPlay()&&document.getElementById('home')?.classList.contains('hidden')){setMessage(tr('Return to main menu before signing out.','Vrati se u glavni meni pre odjave.'),'error');return}
 const saved=await flush(true);
 if(!saved){const confirm=window.confirm(tr('Cloud save has not completed. Sign out anyway?','Cloud čuvanje nije završeno. Da se ipak odjaviš?'));if(!confirm)return;}
 backupLocal('before_signout_'+currentUser.uid.slice(0,9));
 gameReset();try{localStorage.removeItem(LOCK)}catch{};
 window.sessionStorage.removeItem('ns82_verified_uid');guestMode=false;cloudReady=false;known.clear();
 await sdk.signOut(auth);location.reload();
}
async function changePassword(){if(!currentUser?.email||!sdk)return;await run(async()=>{
 await sdk.sendPasswordResetEmail(auth,currentUser.email);
 setMessage(tr('Password reset email sent.','Poslat je email za promenu lozinke.'),'ok');
 })}
async function verifyEmail(){await run(async()=>{
 if(!currentUser)return;
 await sdk.sendEmailVerification(currentUser);
 setMessage(tr('Verification email sent.','Poslat je email za potvrdu.'),'ok')
 })}
async function reloadVerify(){await run(async()=>{
 if(!currentUser)return;await currentUser.reload();
 el('ns82-verify').hidden=!!currentUser.emailVerified;
 setMessage(currentUser.emailVerified?tr('Email verified ✓','Email potvrđen ✓'):tr('Not verified yet.','Još nije potvrđen.'),currentUser.emailVerified?'ok':'pending');
 })}
function downloadBackup(){
 const data={version:82,exportedAt:new Date().toISOString(),saved:Object.fromEntries(currentSave())};
 const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
 const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='Nocna_Straza_Backup_'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),15000);
}
async function uploadBackup(event){const file=event.target.files?.[0];event.target.value='';if(!file||file.size>5_000_000){setMessage(tr('File missing or too large.','Nema fajla ili je prevelik.'),'error');return}
 try{const data=JSON.parse(await file.text());if(data.version!==82||!data.saved||typeof data.saved!=='object')throw Error('bad backup');
  const entries=Object.entries(data.saved).filter(([k,v])=>isSaveKey(k)&&typeof v==='string'&&byteLength(v)<=MAX_BYTES);
  if(entries.length<1)throw Error('empty');
  if(!window.confirm(tr('Restore backup? Current save will be replaced.','Vrati rezervnu kopiju? Trenutni napredak biće zamenjen.')))return;
  backupLocal('before_import');gameReset();for(const [k,v] of entries)safeSet(k,v);
  if(currentUser&&cloudReady){known=new Map([...known].map(([k,v])=>[k,v]));markDirty();await flush(true)}
  location.reload();
 }catch(e){setMessage(tr('Invalid backup JSON.','Neispravna rezervna kopija.'),'error')}}
function renderLang(){lang=language();for(const node of document.querySelectorAll('[data-ns82-en]')){
 node.textContent=node.getAttribute(lang==='sr'?'data-ns82-sr':'data-ns82-en');}
 const a=el('ns82-action');if(a)a.textContent=el('ns82-confirm-wrap').hidden?tr('SIGN IN','PRIJAVI SE'):tr('CREATE ACCOUNT','NAPRAVI NALOG');
 const pass=el('ns82-password');if(pass)pass.placeholder=tr('Password (8+ characters)','Lozinka (8+ karaktera)');
}
function openAccount(){setVisible(true);el('ns82-login-form').hidden=!configured||!!currentUser;el('ns82-account').hidden=!currentUser;
 el('ns82-guest').hidden=!!currentUser;el('ns82-guest-export').hidden=!!currentUser;
 if(el('ns83-backup-details'))el('ns83-backup-details').hidden=!!currentUser;
 if(currentUser)el('ns82-who').textContent=currentUser.email||tr('Google account','Google nalog');
 renderLang();}
function attach(){
 // Email/password is the only enabled provider for this release.
 // Google buttons remain hidden until the owner enables Google in Firebase.
 if(CONFIG.googleSignInEnabled!==true){
  for(const target of [el('ns82-google'),el('ns82-link-google'),document.querySelector('.ns82-separator')])
   if(target){target.hidden=true;target.style.display='none';}
 }
 el('ns82-login-form').addEventListener('submit',submit);
 el('ns82-signin').onclick=()=>setMode('signin');el('ns82-register').onclick=()=>setMode('signup');
 el('ns82-google').onclick=loginGoogle;el('ns82-forgot').onclick=sendReset;
 el('ns82-guest').onclick=()=>{guestMode=true;setVisible(false);status(tr('Guest • local only','Gost • samo lokalno'),'pending')};
 el('ns82-close').onclick=()=>{if(currentUser||guestMode)setVisible(false)};
 el('ns82-eye').onclick=()=>{const f=el('ns82-password');f.type=f.type==='password'?'text':'password'};
 el('ns82-logout').onclick=()=>void signOut();el('ns82-force').onclick=()=>void flush(true);
 el('ns82-link-google').onclick=()=>void linkGoogle();el('ns82-change-password').onclick=()=>void changePassword();
 el('ns82-verify-send').onclick=verifyEmail;el('ns82-verify-check').onclick=reloadVerify;
 el('ns82-backup').onclick=downloadBackup;el('ns82-import').onchange=uploadBackup;
 el('ns82-guest-backup').onclick=downloadBackup;el('ns82-guest-import').onchange=uploadBackup;
 el('ns82-open').onclick=openAccount;el('ns82-profile-button').onclick=openAccount;
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&currentUser&&cloudReady)void flush(true)});
 window.addEventListener('online',()=>{if(currentUser&&cloudReady)void flush(true)});
 window.addEventListener('storage',e=>{if(isSaveKey(e.key)&&currentUser&&cloudReady)markDirty()});
 // Low frequency fallback also tracks game code that writes localStorage directly.
 setInterval(()=>{if(currentUser&&cloudReady&&!syncing&&changed(currentSave(),snapshotSaved))markDirty()},14000);
 const observer=new MutationObserver(()=>renderLang());
 const languageSelector=el('gameLanguageHome');if(languageSelector)languageSelector.addEventListener('change',()=>setTimeout(renderLang,30));
 renderLang();setMode('signin');
 window.NS82_CLOUD={markDirty,flush,openAccount,downloadBackup,get online(){return !!currentUser&&cloudReady},get user(){return currentUser?.uid||null},get lastError(){return lastError}};
}
async function begin(){
 attach();
 if(!configured){
  // Never show non-functional sign-in fields before the owner connects Firebase.
  el('ns82-login-form').hidden=true;
  el('ns82-login-form').style.setProperty('display','none','important');
  el('ns82-account').hidden=true;
  el('ns82-config').hidden=false;
  el('ns83-owner-setup').hidden=false;
  el('ns82-guest-export').hidden=false;
  el('ns83-backup-details').hidden=false;
  el('ns82-close').hidden=true;
  document.body.classList.add('ns83-config-minimal');
  const heading=el('ns83-account-heading'),desc=el('ns83-account-subheading');
  if(heading){heading.setAttribute('data-ns82-en','PLAY NOW • ONLINE ACCOUNTS SOON');heading.setAttribute('data-ns82-sr','IGRAJ SADA • ONLINE NALOZI USKORO');}
  if(desc){desc.setAttribute('data-ns82-en','Your save stays on this phone until online accounts are enabled.');desc.setAttribute('data-ns82-sr','Tvoj napredak ostaje na ovom telefonu dok se online nalozi ne aktiviraju.');}
  setMessage('');status(tr('Guest • local save only','Gost • samo lokalno čuvanje'),'pending');renderLang();setVisible(true);return}
 try{
  const version='13.2.0';
  const [appModule,authModule,firestoreModule]=await Promise.all([
   import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
   import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
   import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
  ]);
  sdk={...authModule,...firestoreModule};
  const app=appModule.initializeApp(CONFIG);auth=sdk.getAuth(app);db=sdk.getFirestore(app);
  sdk.onAuthStateChanged(auth,u=>{void loadSession(u)},e=>{setMessage(errorText(e),'error');setVisible(true)});
 }catch(err){setMessage(tr('Firebase SDK unavailable. Check the connection and configuration.','Firebase nije dostupan. Proveri vezu i konfiguraciju.'),'error');setVisible(true)}
}
if(ROOT)void begin();
