"use strict";
const SUPABASE_URL = "https://leccpiyvcknpgqmqcaqc.supabase.co";
const SUPABASE_KEY = "sb_publishable_BzpNUjEqfINYfTF6CPDwuQ_2pL50FUN";
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = id => document.getElementById(id);
const STATUS_TO_DB = {"À tester":"to_test","En test":"testing","Fiable":"reliable","À vérifier":"review","Abandonné":"abandoned"};
const STATUS_FROM_DB = Object.fromEntries(Object.entries(STATUS_TO_DB).map(([k,v])=>[v,k]));
const STORAGE_KEY = "panel20Data";
let data = {sites:[], sessions:[], transactions:[]}, selectedId=null, session=null, timerInterval=null, currentUser=null, enteringUserId=null;
function safeUrl(v){try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)?u.href:""}catch{return ""}}
function formatTime(n){n=Math.max(0,Math.floor(Number(n)||0));return [String(Math.floor(n/3600)).padStart(2,"0"),String(Math.floor(n%3600/60)).padStart(2,"0"),String(n%60).padStart(2,"0")].join(":")}
function fmtAmount(n){return Number(n||0).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:8})}
function getSite(id){return data.sites.find(s=>s.id===id)}
function elapsedFor(s){return Number(s.totalSeconds||0)}
function sessionSeconds(){if(!session)return 0;return Number(session.elapsed||0)+(session.running?Math.max(0,Math.floor((Date.now()-session.startedAt)/1000)):0)}
function total(k){return data.sites.reduce((a,s)=>a+Number(s[k]||0),0)}
function showMessage(msg,error=false){$("authMessage").textContent=msg;$("authMessage").style.color=error?"#ff9aaa":"#8af0c5"}
function setBusy(b){["signUp","signIn","signOut"].forEach(id=>{if($(id))$(id).disabled=b})}
function unwrap(row){return Array.isArray(row)?row[0]:row}
async function checked(promise){const {data,error}=await promise;if(error)throw error;return data}
async function loadAll(){
 const [sites,sessions,transactions]=await Promise.all([
  checked(client.from("sites").select("*").order("updated_at",{ascending:false})),
  checked(client.from("sessions").select("*").order("started_at",{ascending:false})),
  checked(client.from("reward_transactions").select("*").order("occurred_at",{ascending:false}))
 ]);
 data.sites=sites.map(s=>({...s,id:s.id,name:s.name,url:s.url,goal:s.goal||"",wallet:s.wallet_label||"",status:STATUS_FROM_DB[s.status]||"À tester",notes:s.notes||"",createdAt:s.created_at,updatedAt:s.updated_at,reward:0,fees:0,paid:0,totalSeconds:0}));
 data.sessions=sessions;data.transactions=transactions;
 transactions.forEach(t=>{const s=getSite(t.site_id);if(!s)return;if(t.kind==="reward")s.reward+=Number(t.amount);if(t.kind==="fee")s.fees+=Number(t.amount);if(t.kind==="payout")s.paid+=Number(t.amount)});
 sessions.filter(s=>s.status==="completed").forEach(x=>{const s=getSite(x.site_id);if(s)s.totalSeconds+=Number(x.elapsed_seconds||0)});
 const open=sessions.find(s=>["active","paused"].includes(s.status));
 session=open?{id:open.id,siteId:open.site_id,status:open.status,elapsed:Number(open.elapsed_seconds||0),startedAt:open.last_resumed_at?new Date(open.last_resumed_at).getTime():Date.now(),running:open.status==="active"}:null;
 if(session)selectedId=session.siteId;
 render();if(session&&session.running)startTicker();else stopTicker();
}
async function syncTotal(siteId,kind,amount){
 const existing=await checked(client.from("reward_transactions").select("id").eq("site_id",siteId).eq("kind",kind).eq("notes","panel2_total").limit(1));
 if(Number(amount)<=0){if(existing.length)await checked(client.from("reward_transactions").delete().eq("id",existing[0].id));return}
 const payload={site_id:siteId,kind,amount:Number(amount),currency:"USD",status:"confirmed",notes:"panel2_total",reference:"Panel 2.0 total"};
 if(existing.length)await checked(client.from("reward_transactions").update(payload).eq("id",existing[0].id));
 else await checked(client.from("reward_transactions").insert(payload));
}
function makeButton(label,cls,fn){const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=label;b.addEventListener("click",fn);return b}
function render(){
 $("statSites").textContent=data.sites.length;
 $("statTime").textContent=formatTime(data.sites.reduce((a,s)=>a+elapsedFor(s),0)+(session?sessionSeconds():0));
 $("statRewards").textContent=fmtAmount(total("reward"));$("statPaid").textContent=fmtAmount(total("paid"));
 const q=$("search").value.trim().toLowerCase(),st=$("filterStatus").value;
 const sites=data.sites.filter(s=>(!q||[s.name,s.url,s.goal,s.wallet,s.notes].join(" ").toLowerCase().includes(q))&&(!st||s.status===st));
 const tbody=$("siteRows");tbody.replaceChildren();
 if(!sites.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="Aucun site trouvé. Ajoute ton premier site ci-dessus.";td.className="muted";tr.appendChild(td);tbody.appendChild(tr)}
 sites.forEach(s=>{
  const tr=document.createElement("tr"),name=document.createElement("td"),strong=document.createElement("strong");strong.textContent=s.name;name.appendChild(strong);name.appendChild(document.createElement("br"));
  const link=document.createElement("a");link.href=safeUrl(s.url)||"#";link.target="_blank";link.rel="noopener noreferrer";link.textContent=s.url;link.addEventListener("click",e=>{if(!safeUrl(s.url))e.preventDefault()});name.appendChild(link);
  if(s.goal){const p=document.createElement("p");p.className="small";p.textContent=s.goal;name.appendChild(p)}
  const statusTd=document.createElement("td"),badge=document.createElement("span");badge.className="badge "+(s.status==="Fiable"?"active":(["À vérifier","Abandonné"].includes(s.status)?"error":""));badge.textContent=s.status||"À tester";statusTd.appendChild(badge);
  const timeTd=document.createElement("td");timeTd.textContent=formatTime(elapsedFor(s)+(session&&session.siteId===s.id?sessionSeconds():0));
  const rewardTd=document.createElement("td");rewardTd.textContent=fmtAmount(s.reward);
  const actions=document.createElement("td");actions.append(makeButton("Sélectionner","secondary",()=>selectSite(s.id)),makeButton("Modifier","secondary",()=>editSite(s.id)),makeButton("Supprimer","danger",()=>deleteSite(s.id)));
  tr.append(name,statusTd,timeTd,rewardTd,actions);tbody.appendChild(tr);
 });
 if(session){const s=getSite(session.siteId);$("sessionSite").textContent=s?"Site : "+s.name+(session.running?" — session active":" — en pause"):"Site supprimé";$("timer").textContent=formatTime(sessionSeconds());$("startSession").disabled=true;$("pauseSession").disabled=!session.running;$("resumeSession").disabled=session.running;$("finishSession").disabled=false}
 else{$("sessionSite").textContent=selectedId&&getSite(selectedId)?"Site sélectionné : "+getSite(selectedId).name:"Aucun site sélectionné.";$("timer").textContent="00:00:00";$("startSession").disabled=!selectedId;$("pauseSession").disabled=true;$("resumeSession").disabled=true;$("finishSession").disabled=true}
}
function selectSite(id){selectedId=id;const s=getSite(id);if(s&&safeUrl(s.url))$("viewer").src=safeUrl(s.url);render()}
function resetForm(){$("siteForm").reset();$("editId").value="";$("siteReward").value=0;$("siteFees").value=0;$("sitePaid").value=0;$("formTitle").textContent="＋ Ajouter un site";$("saveButton").textContent="Enregistrer le site";$("cancelEdit").classList.add("hidden")}
$("siteForm").addEventListener("submit",async e=>{
 e.preventDefault();if(!currentUser){alert("Connecte-toi ou crée un compte pour enregistrer un site dans Supabase.");return}try{
  const name=$("siteName").value.trim(),url=safeUrl($("siteUrl").value.trim());if(!name||!url){alert("Saisis un nom et une URL valide commençant par http:// ou https://.");return}
  const id=$("editId").value,old=id?getSite(id):null;
  const payload={name,url,goal:$("siteGoal").value.trim(),wallet_label:$("siteWallet").value.trim(),status:STATUS_TO_DB[$("siteStatus").value]||"to_test",notes:$("siteNotes").value.trim()};
  let saved;
  if(old)saved=unwrap(await checked(client.from("sites").update(payload).eq("id",id).select().single()));
  else saved=unwrap(await checked(client.from("sites").insert(payload).select().single()));
  await Promise.all([syncTotal(saved.id,"reward",$("siteReward").value),syncTotal(saved.id,"fee",$("siteFees").value),syncTotal(saved.id,"payout",$("sitePaid").value)]);
  selectedId=saved.id;resetForm();await loadAll();
 }catch(err){alert("Erreur d'enregistrement : "+(err.message||"vérifie ta connexion."))}
});
function editSite(id){const s=getSite(id);if(!s)return;$("editId").value=s.id;$("siteName").value=s.name;$("siteUrl").value=s.url;$("siteGoal").value=s.goal||"";$("siteWallet").value=s.wallet||"";$("siteStatus").value=s.status||"À tester";$("siteReward").value=s.reward||0;$("siteFees").value=s.fees||0;$("sitePaid").value=s.paid||0;$("siteNotes").value=s.notes||"";$("formTitle").textContent="✏️ Modifier le site";$("saveButton").textContent="Enregistrer les modifications";$("cancelEdit").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"})}
$("cancelEdit").addEventListener("click",resetForm);
async function deleteSite(id){const s=getSite(id);if(!s||!confirm("Supprimer le site « "+s.name+" » ainsi que ses sessions et transactions ? Cette action est irréversible."))return;if(session&&session.siteId===id){alert("Termine d'abord la session de ce site.");return}try{await checked(client.from("sites").delete().eq("id",id));if(selectedId===id)selectedId=null;await loadAll()}catch(e){alert("Suppression impossible : "+e.message)}}
$("search").addEventListener("input",render);$("filterStatus").addEventListener("change",render);
$("startSession").addEventListener("click",async()=>{if(!selectedId||!getSite(selectedId)){alert("Sélectionne d'abord un site.");return}try{unwrap(await checked(client.rpc("start_session",{p_site_id:selectedId})));await loadAll()}catch(e){alert("Impossible de démarrer : "+e.message)}});
$("pauseSession").addEventListener("click",async()=>{if(!session||!session.running)return;try{unwrap(await checked(client.rpc("pause_session",{p_session_id:session.id})));await loadAll()}catch(e){alert("Impossible de mettre en pause : "+e.message)}});
$("resumeSession").addEventListener("click",async()=>{if(!session||session.running)return;try{unwrap(await checked(client.rpc("resume_session",{p_session_id:session.id})));await loadAll()}catch(e){alert("Impossible de reprendre : "+e.message)}});
$("finishSession").addEventListener("click",async()=>{if(!session)return;try{unwrap(await checked(client.rpc("finish_session",{p_session_id:session.id})));await loadAll()}catch(e){alert("Impossible de terminer : "+e.message)}});
function startTicker(){stopTicker();timerInterval=setInterval(render,1000)}function stopTicker(){if(timerInterval)clearInterval(timerInterval);timerInterval=null}
$("openExternal").addEventListener("click",()=>{const s=getSite(selectedId);if(!s||!safeUrl(s.url)){alert("Sélectionne un site avec une URL valide.");return}window.open(s.url,"_blank","noopener,noreferrer")});
function downloadFile(filename,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$("exportJson").addEventListener("click",()=>downloadFile("panel20-sauvegarde.json",JSON.stringify({sites:data.sites,sessions:data.sessions,transactions:data.transactions},null,2),"application/json"));
$("importButton").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{const file=e.target.files[0];if(!file)return;try{const p=JSON.parse(await file.text());if(!p||!Array.isArray(p.sites))throw Error("Format invalide");if(!confirm("Importer cette sauvegarde et ajouter ses sites à ton compte ?"))return;for(const s of p.sites){const site=unwrap(await checked(client.from("sites").insert({name:String(s.name||"Site importé").slice(0,160),url:safeUrl(s.url)||"https://example.com",goal:String(s.goal||"").slice(0,2000),wallet_label:String(s.wallet||"").slice(0,160),status:STATUS_TO_DB[s.status]||"to_test",notes:String(s.notes||"").slice(0,10000)}).select().single()));await Promise.all([syncTotal(site.id,"reward",Math.max(0,Number(s.reward)||0)),syncTotal(site.id,"fee",Math.max(0,Number(s.fees)||0)),syncTotal(site.id,"payout",Math.max(0,Number(s.paid)||0))])}await loadAll();alert("Sauvegarde importée dans ton compte.")}catch(err){alert("Import impossible : "+(err.message||"fichier invalide"))}finally{e.target.value=""}});
$("exportCsv").addEventListener("click",()=>{const cols=["name","url","status","goal","wallet","totalSeconds","reward","fees","paid","notes"],q=v=>'"'+String(v??"").replace(/"/g,'""')+'"',csv=[cols.join(";"),...data.sites.map(s=>cols.map(k=>q(k==="status"?s[k]:s[k])).join(";"))].join("\r\n");downloadFile("panel20-sites.csv","\uFEFF"+csv,"text/csv;charset=utf-8")});
$("clearData").addEventListener("click",async()=>{if(!confirm("Supprimer TOUS tes sites, sessions et transactions dans le compte connecté ? Cette action est irréversible."))return;try{await checked(client.from("sites").delete().not("id","is",null));selectedId=null;session=null;$("viewer").src="about:blank";resetForm();await loadAll()}catch(e){alert("Suppression impossible : "+e.message)}});
$("signUp").addEventListener("click",async()=>{const email=$("authEmail").value.trim(),password=$("authPassword").value,name=$("displayName").value.trim();if(!email||password.length<8){showMessage("Entre un e-mail et un mot de passe d’au moins 8 caractères.",true);return}setBusy(true);try{const {data:result,error}=await client.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:window.location.origin+window.location.pathname}});if(error)throw error;if(result.session){showMessage("Compte créé. Tu es connecté.");await enterApp(result.session.user)}else showMessage("Inscription reçue. Vérifie tes e-mails pour confirmer ton compte, puis connecte-toi.")}catch(e){showMessage("Inscription impossible : "+e.message,true)}finally{setBusy(false)}});
$("signIn").addEventListener("click",async()=>{const email=$("authEmail").value.trim(),password=$("authPassword").value;if(!email||!password){showMessage("Entre ton e-mail et ton mot de passe.",true);return}setBusy(true);try{const {data:result,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;showMessage("Connexion réussie.");await enterApp(result.user)}catch(e){showMessage("Connexion impossible : "+e.message,true)}finally{setBusy(false)}});
$("signOut").addEventListener("click",async()=>{try{const {error}=await client.auth.signOut();if(error)throw error;leaveApp()}catch(e){alert("Déconnexion impossible : "+e.message)}});
async function enterApp(user){if(currentUser&&currentUser.id===user.id)return;if(enteringUserId===user.id)return;enteringUserId=user.id;currentUser=user;$("authPanel").classList.add("hidden");$("appContent").classList.remove("hidden");$("userLabel").textContent=user.email||"Compte connecté";showMessage("");try{await loadAll()}catch(e){alert("Impossible de charger tes données : "+e.message)}finally{enteringUserId=null}}
function leaveApp(){currentUser=null;data={sites:[],sessions:[],transactions:[]};session=null;selectedId=null;stopTicker();$("appContent").classList.add("hidden");$("authPanel").classList.remove("hidden");$("userLabel").textContent="Non connecté";render()}
client.auth.onAuthStateChange((event,authSession)=>{if(authSession&&authSession.user){if((!currentUser||currentUser.id!==authSession.user.id)&&enteringUserId!==authSession.user.id)setTimeout(()=>enterApp(authSession.user),0)}else if(currentUser)leaveApp()});
(async()=>{const {data:{session:authSession},error}=await client.auth.getSession();if(error){showMessage("Erreur d’authentification : "+error.message,true);return}if(authSession)await enterApp(authSession.user);else{leaveApp();showMessage("Connecte-toi ou crée un compte pour commencer.")}})();
