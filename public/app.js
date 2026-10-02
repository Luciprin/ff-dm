const $ = (s) => document.querySelector(s);
const entry = $('#entry'), transition = $('#transition'), chat = $('#chat'), admin = $('#admin'), modal = $('#adminModal');
const messages = $('#messages'), input = $('#messageInput'), send = $('#sendButton');
let conversationId = newConversationId();
let busy = false;
let scenarioCache = { welcome: 'Bienvenue. Prends ton temps, je suis là pour discuter avec toi.', firstPrompt: 'Qu’aimerais-tu savoir ou partager aujourd’hui ?' };
let toastTimer;

function newConversationId(){ return crypto.randomUUID ? crypto.randomUUID().replaceAll('-','') : `${Date.now()}${Math.random().toString(36).slice(2)}`; }
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
function escapeText(v){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function timeNow(){ return new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date()); }
function scrollBottom(){ requestAnimationFrame(()=>messages.scrollTo({top:messages.scrollHeight,behavior:'auto'})); }
function addBot(text, className=''){
  $('#typing')?.remove();
  const row=document.createElement('div'); row.className=`bubble-row ${className}`.trim();
  const wrap=document.createElement('div');
  const bubble=document.createElement('div'); bubble.className='bubble bot';
  const meta=document.createElement('div'); meta.className='meta'; meta.textContent=timeNow();
  wrap.append(bubble,meta); row.append(wrap); messages.append(row);
  return streamText(bubble, String(text || ''));
}
function streamText(target, text){
  // Approx. 60 tokens/sec for French text (~240 visible characters/sec).
  const speed = 240;
  let shown = 0, last = performance.now();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { target.textContent = text; scrollBottom(); return Promise.resolve(); }
  return new Promise(resolve => {
  function frame(now){
    const elapsed = Math.max(0, now-last); last=now;
    shown = Math.min(text.length, shown + elapsed*speed/1000);
    target.textContent = text.slice(0, Math.floor(shown));
    scrollBottom();
    if (shown < text.length) requestAnimationFrame(frame); else resolve();
  }
  requestAnimationFrame(frame);
  });
}
function addUser(text){
  const row=document.createElement('div'); row.className='bubble-row user';
  const wrap=document.createElement('div'); const bubble=document.createElement('div'); bubble.className='bubble user'; bubble.textContent=text;
  const meta=document.createElement('div'); meta.className='meta'; meta.innerHTML=`${timeNow()} <span class="checks">✓✓</span>`;
  wrap.append(bubble,meta); row.append(wrap); messages.append(row); scrollBottom();
}
function addTyping(){
  const row=document.createElement('div'); row.id='typing'; row.className='bubble-row';
  row.innerHTML='<div class="typing"><i></i><i></i><i></i></div>'; messages.append(row); scrollBottom();
}
async function fetchPublicConfig(){
  try { const r=await fetch('/api/?action=config',{cache:'no-store'}); if(r.ok) scenarioCache=await r.json(); }
  catch { /* Default text keeps the entry usable if the network is temporarily unavailable. */ }
}
function startConversation(){
  messages.innerHTML=''; busy=true; send.disabled=true;
  (async()=>{ await addBot(scenarioCache.welcome,'welcome-message'); await new Promise(r=>setTimeout(r,160)); await addBot(scenarioCache.firstPrompt,'prompt-message'); busy=false; send.disabled=false; })();
}
function showToast(){
  const toast=$('#toast'); toast.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('visible'),3200);
}
$('#entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name=$('#entryName').value.trim(), password=$('#entryPassword').value;
  if(!name || !password) return;
  // Entry credentials are intentionally local-only and discarded immediately.
  $('#entryName').value=''; $('#entryPassword').value='';
  hide(entry); show(transition);
  await fetchPublicConfig();
  setTimeout(()=>{
    hide(transition); show(chat); startConversation(); showToast();
    setTimeout(()=>input.focus({preventScroll:true}),120);
  },1150);
});

async function sendMessage(){
  if(busy) return;
  const text=input.value.trim(); if(!text) return;
  busy=true; send.disabled=true; input.value=''; input.style.height='auto';
  addUser(text); addTyping();
  try{
    const r=await fetch('/api/?action=message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,conversationId})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Erreur');
    await new Promise(res=>setTimeout(res,250));
    await addBot(data.response);
    // The next configured prompt is presented as natural conversation, without stage numbers.
    if(data.nextPrompt){ await new Promise(res=>setTimeout(res,220)); await addBot(data.nextPrompt,'prompt-message'); }
  }catch(err){ addBot('Ton message n’a pas pu être transmis. Vérifie ta connexion et réessaie.'); }
  finally{busy=false;send.disabled=false;input.focus({preventScroll:true});}
}
send.addEventListener('click',sendMessage);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,132)+'px';});
$('#newChat').addEventListener('click',()=>{if(busy)return;conversationId=newConversationId();startConversation();input.focus({preventScroll:true});});

$('#adminLink').addEventListener('click',()=>{show(modal);$('#adminPassword').value='';$('#adminError').textContent='';setTimeout(()=>$('#adminPassword').focus(),30);});
$('#modalClose').addEventListener('click',()=>hide(modal));
modal.addEventListener('click',e=>{if(e.target===modal)hide(modal);});
$('#adminForm').addEventListener('submit',async e=>{
  e.preventDefault(); const password=$('#adminPassword').value; $('#adminError').textContent='';
  try{
    const r=await fetch('/api/?action=admin-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error||'Accès refusé');
    hide(modal); hide(chat); show(admin); await loadAdmin();
  }catch(err){$('#adminError').textContent=err.message;}
});

function createStepCard(step,index){
  const card=document.createElement('section'); card.className='step-card';
  const head=document.createElement('div'); head.className='step-card-head';
  const title=document.createElement('strong'); title.textContent='Échange';
  const actions=document.createElement('div'); actions.className='step-actions';
  const up=document.createElement('button'); up.type='button'; up.className='mini-action'; up.textContent='↑'; up.setAttribute('aria-label','Monter cet échange'); up.disabled=index===0;
  const down=document.createElement('button'); down.type='button'; down.className='mini-action'; down.textContent='↓'; down.setAttribute('aria-label','Descendre cet échange');
  const remove=document.createElement('button'); remove.type='button'; remove.className='mini-action remove-step'; remove.textContent='Supprimer'; remove.disabled=$$('#stepsEditor .step-card').length<=1;
  actions.append(up,down,remove); head.append(title,actions);
  const promptLabel=document.createElement('label'); promptLabel.className='field-label'; promptLabel.textContent='Question affichée dans le chat';
  const prompt=document.createElement('textarea'); prompt.className='step-prompt'; prompt.maxLength=2000; prompt.rows=2; prompt.placeholder='Écris la prochaine question…'; prompt.value=step.prompt||''; promptLabel.append(prompt);
  const responseLabel=document.createElement('label'); responseLabel.className='field-label'; responseLabel.textContent='Réponse après le message du visiteur';
  const response=document.createElement('textarea'); response.className='step-response'; response.maxLength=5000; response.rows=3; response.placeholder='Écris la réponse qui sera envoyée…'; response.value=step.response||''; responseLabel.append(response);
  card.append(head,promptLabel,responseLabel);
  up.addEventListener('click',()=>moveStep(card,-1)); down.addEventListener('click',()=>moveStep(card,1));
  remove.addEventListener('click',()=>{card.remove();refreshStepControls();});
  return card;
}
function $$(selector){return [...document.querySelectorAll(selector)];}
function moveStep(card,direction){
  const cards=$$('#stepsEditor .step-card'), index=cards.indexOf(card), target=cards[index+direction];
  if(!target)return;
  if(direction<0) target.before(card); else target.after(card);
  refreshStepControls();
}
function refreshStepControls(){
  const cards=$$('#stepsEditor .step-card');
  cards.forEach((card,index)=>{
    card.querySelector('.step-card-head strong').textContent=`Échange ${index+1}`;
    card.querySelector('[aria-label="Monter cet échange"]').disabled=index===0;
    card.querySelector('[aria-label="Descendre cet échange"]').disabled=index===cards.length-1;
    card.querySelector('.remove-step').disabled=cards.length<=1;
  });
  $('#stepCount').textContent=`${cards.length} ${cards.length>1?'échanges':'échange'}`;
  $('#addStep').disabled=cards.length>=30;
}
function renderSteps(steps){
  const host=$('#stepsEditor'); host.innerHTML='';
  steps.forEach((step,index)=>host.append(createStepCard(step,index)));
  refreshStepControls();
}
function collectScenario(){
  return {welcome:$('#welcomeEditor').value.trim(),steps:$$('#stepsEditor .step-card').map(card=>({prompt:card.querySelector('.step-prompt').value.trim(),response:card.querySelector('.step-response').value.trim()}))};
}
async function loadAdmin(){
  const r=await fetch('/api/?action=admin-state',{cache:'no-store'});
  if(r.status===401){hide(admin);show(chat);return;}
  const d=await r.json(); $('#welcomeEditor').value=d.config?.welcome||''; renderSteps(d.config?.steps||[]); renderHistory(d.messages||[]);
}
function renderHistory(items){
  $('#messageCount').textContent=items.length;
  const host=$('#history'); host.innerHTML='';
  if(!items.length){host.innerHTML='<div class="small-note">Aucun message reçu pour le moment.</div>';return;}
  items.forEach(item=>{
    const card=document.createElement('div'); card.className='history-item';
    const top=document.createElement('div'); top.className='history-top';
    const id=document.createElement('span'); id.textContent=`Conversation ${String(item.conversationId).slice(0,8)}`;
    const date=document.createElement('span'); date.textContent=new Date(item.createdAt).toLocaleString('fr-FR'); top.append(id,date);
    const prompt=document.createElement('div'); prompt.className='history-prompt'; prompt.textContent=item.prompt||'';
    const question=document.createElement('div'); question.className='history-q'; question.textContent=item.question||'';
    const answer=document.createElement('div'); answer.className='history-a'; answer.textContent=item.response||'';
    card.append(top,prompt,question,answer); host.append(card);
  });
}
$('#addStep').addEventListener('click',()=>{
  const host=$('#stepsEditor');
  if(host.children.length>=30)return;
  host.append(createStepCard({prompt:'',response:''},host.children.length)); refreshStepControls();
  host.lastElementChild.scrollIntoView({behavior:'smooth',block:'center'});
});
$('#saveScenario').addEventListener('click',async()=>{
  const config=collectScenario(); const state=$('#saveState'); const btn=$('#saveScenario');
  if(!config.welcome || !config.steps.length || config.steps.some(s=>!s.prompt||!s.response)){state.textContent='Complète la phrase d’accueil, chaque question et chaque réponse.';state.classList.add('error-state');return;}
  state.classList.remove('error-state'); btn.disabled=true; state.textContent='Enregistrement…';
  try{
    const r=await fetch('/api/?action=scenario',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(config)});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||'Impossible d’enregistrer.');
    state.textContent='Modifications enregistrées. Elles s’appliquent aux prochains messages envoyés.';
  }catch(err){state.textContent=err.message;state.classList.add('error-state');}
  finally{btn.disabled=false;}
});
$('#adminClose').addEventListener('click',async()=>{await fetch('/api/?action=admin-logout',{method:'POST'});hide(admin);show(chat);});
