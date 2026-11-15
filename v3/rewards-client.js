import { ENGINE_VERSION, createGame, stepGame, resizeGame } from './game-session-engine.mjs';

const $ = id => document.getElementById(id);
const game = window.BorealGame;
const panel = $('rewardClaim');
const note = $('rewardStartNote');
const money = cents => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(cents / 100);
const modeLabel = mode => mode === 'extreme' ? 'Défi extrême' : 'Mode récompenses';
const CONSENT_VERSION = 'rewards-no-sms-2026-11-v1';
let busy = false, run = null, pendingSession = null, challenge = null, knownDeviceRestriction=null;
let turnstileLoad;
const reasonText = {
  invalid_code: 'Le code SMS est incorrect. Réessaie avec le code reçu.',
  phone_cooldown: 'Ce numéro a déjà obtenu une récompense au cours des 30 derniers jours.',
  invalid_phone: 'Entre un numéro mobile au format international, par exemple +15145551234.',
  challenge_expired: 'Le code SMS a expiré. Reviens au résultat pour demander un nouveau code.',
  session_not_eligible: 'Cette partie ne peut plus confirmer une récompense.',
  session_expired: 'La validité de 30 minutes de cette partie est écoulée.',
  configuration_pending: 'Les récompenses sont indisponibles pour le moment. Tu peux jouer en mode libre, sans récompense.',
  verification_unavailable: 'La vérification est temporairement indisponible. Réessaie dans quelques instants.',
  sms_daily_limit: 'La vérification SMS est indisponible pour le moment. Réessaie plus tard.',
  verification_replaced:'Cette vérification a été remplacée. Utilise le dernier SMS demandé.',
  sms_wait:'Attends le délai indiqué avant de demander un nouveau code.',
  sms_send_limit:'La limite de cinq demandes SMS pour cette partie est atteinte.',
  phone_bound: 'Utilise le même numéro de téléphone que lors de ta première demande pour cette partie.',
  consent_required: 'Accepte les conditions de la récompense pour confirmer ton gain.',
  profile_missing: 'Ton prénom et ton nom sont requis pour confirmer le gain.',
  turnstile_required: 'Termine la vérification de sécurité avant de commencer.',
  turnstile_failed: 'La vérification de sécurité a échoué. Réessaie.',
  engine_changed: 'Le jeu a été mis à jour. Recharge la page avant de commencer.',
  owner_required: 'Retrouve cette confirmation dans le navigateur utilisé pour jouer.',
  attempts_exceeded: 'Le nombre de tentatives SMS est atteint.',
  rate_limited: 'Trop de demandes rapprochées. Patiente avant de réessayer.',
  verification_pending: 'La vérification est en cours. Réessaie dans quelques instants.'
};

function message(text) { note.textContent = text; }
function hidePanel() { panel.classList.add('off'); panel.replaceChildren(); }
function showPanel(title, text) {
  panel.replaceChildren();
  const box = document.createElement('div'); box.className = 'panel';
  const heading = document.createElement('h2'); heading.textContent = title;
  const body = document.createElement('p'); body.textContent = text;
  box.append(heading, body); panel.append(box); panel.classList.remove('off');
  return box;
}
function button(box, text, action, primary = true) {
  const node = document.createElement('button'); node.type = 'button'; node.className = primary ? 'primary' : 'alt';
  node.textContent = text; node.addEventListener('click', action); box.append(node); return node;
}
function setBusy(value) {
  busy = value; window.BorealRewardMenu?.setBusy?.(value);
  for (const id of ['start', 'retry', 'fromHow']) $(id).disabled = value || !game?.ready;
}
async function api(path, data) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal }); }
  catch { throw new Error('Le service est temporairement indisponible. Réessaie.'); }
  finally { clearTimeout(timer); }
  let body; try { body = await response.json(); } catch { throw new Error('Le service est temporairement indisponible. Réessaie.'); }
  if (!response.ok) { const error = new Error(reasonText[body.reason || body.error] || 'La demande n’a pas pu être terminée. Réessaie.'); error.status = response.status; error.reason = body.reason || body.error;error.retryAfter=body.retryAfter;error.nextEligibleAt=body.nextEligibleAt; throw error; }
  return body;
}
function currentStatus() {
  return window.BorealRewardMenu?.getStatus?.() || { mode: 'pending', rewardsEnabled: false, capCents: 0 };
}
function phoneMode(value){return value?.phoneVerificationMode==='sms'?'sms':'unverified';}
function conditions(status) {
  if (status.mode === 'extreme') return 'Défi extrême : vitesse et difficulté accrues. Aucune récompense monétaire.';
  if (status.rewardsEnabled && status.mode === 'rewards') return `Mode récompenses. Maximum annoncé : ${money(status.capCents)}. Une récompense par numéro tous les 30 jours. ${phoneMode(status)==='sms'?'Vérification SMS après la partie.':'Téléphone demandé après un gain admissible, sans vérification SMS.'} Partie admissible pendant 30 minutes, pauses comprises.`;
  return 'Mode libre — sans récompense. Joue sans compte pour battre ton record.';
}
async function securityToken(sitekey) {
  if (!sitekey) throw new Error('Les récompenses sont indisponibles pour le moment. Tu peux jouer en mode libre, sans récompense.');
  if (!window.turnstile) {
    if (!turnstileLoad) turnstileLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
      const timer = setTimeout(() => reject(new Error('La vérification de sécurité est indisponible.')), 15000);
      script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error('La vérification de sécurité est indisponible.')); };
      document.head.append(script);
    }).catch(error => { turnstileLoad = null; throw error; });
    await turnstileLoad;
  }
  return new Promise((resolve, reject) => {
    let widget, settled = false;
    const finish = (error, token) => { if (settled) return; settled = true; clearTimeout(timer); if (widget !== undefined) window.turnstile.remove(widget); error ? reject(error) : resolve(token); };
    const timer = setTimeout(() => finish(new Error('La vérification de sécurité a expiré. Réessaie.')), 20000);
    try {
      widget = window.turnstile.render('#rewardChallenge', { sitekey, action: 'boreal-session', execution: 'execute', size: 'invisible', callback: token => token ? finish(null, token) : finish(new Error('Vérification de sécurité invalide.')), 'error-callback': () => finish(new Error('La vérification de sécurité a échoué.')), 'expired-callback': () => finish(new Error('La vérification de sécurité a expiré.')) });
      window.turnstile.execute(widget);
    } catch { finish(new Error('La vérification de sécurité est indisponible.')); }
  });
}
function startError(error) {
  const box = showPanel('Impossible de commencer cette partie', error.message);
  button(box, 'Réessayer', () => { hidePanel(); start(); });
  button(box, 'Jouer sans récompense', () => { hidePanel(); startPractice(); }, false);
  button(box, 'Retour au menu', hidePanel, false);
}
function launch(session, practice = false) {
  const size = game.dimensions(); const width = Math.round(size.width), height = Math.round(size.height);
  const state = createGame({ seed: session.seed, width: session.initialWidth ?? width, height: session.initialHeight ?? height, mode: session.mode });
  const thisRun = { session, state, jumps: [], resizes: [], practice, finished: false, finishPromise: null };
  if (state.width !== width || state.height !== height) { thisRun.resizes.push({ tick: 0, width, height }); resizeGame(state, width, height); }
  run = thisRun; challenge = null; pendingSession = null; $('rewardResultAction')?.remove(); hidePanel();
  message(practice ? 'Mode libre — sans récompense.' : session.mode === 'extreme' ? 'Défi extrême — aucune récompense monétaire.' : `Mode récompenses · Maximum : ${money(session.capCents)} · Admissible jusqu’à ${new Date(session.expiresAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}.`);
  game.start({ state,
    step(s, jump) {
      if (jump) thisRun.jumps.push(s.ticks);
      stepGame(s, jump);
    },
    resize(s, newWidth, newHeight) {
      const width = Math.round(newWidth), height = Math.round(newHeight);
      if (s.ended) { resizeGame(s, width, height); return; }
      if (s.width === width && s.height === height) return;
      // Coalesce multiple layout events before the next simulation tick.
      const previous = thisRun.resizes.at(-1);
      if (previous?.tick === s.ticks) Object.assign(previous, { width, height });
      else if (thisRun.resizes.length < 60) thisRun.resizes.push({ tick: s.ticks, width, height });
      else {
        // Keep the same game and its eligibility after unusually frequent layout
        // changes: freeze simulation dimensions at the last recorded viewport.
        message('La taille du terrain reste fixe pour cette partie. Les points et l’admissibilité sont conservés.');
        return;
      }
      resizeGame(s, width, height);
    },
    onEnd() { thisRun.finished = true; finish(thisRun); }
  });
}
function startPractice(restriction=null) {
  if (!game?.ready) return;
  launch({ seed: crypto.getRandomValues(new Uint32Array(1))[0], mode: 'rewards', capCents: 0, expiresAt: null, rewardRestriction:restriction }, true);
}
function confirmMode(session) {
  pendingSession = session;
  const box = showPanel('Le mode disponible a changé', `${conditions({ mode: session.mode, rewardsEnabled: session.mode === 'rewards', capCents: session.capCents,phoneVerificationMode:session.phoneVerificationMode })} La difficulté sera fixée pour toute la partie.`);
  button(box, `Commencer en ${modeLabel(session.mode)}`, () => { hidePanel(); start(); });
  button(box, 'Retour au menu', () => { pendingSession = null; hidePanel(); }, false);
}
async function start() {
  if (busy || !game?.ready) return;
  hidePanel(); setBusy(true);
  try {
    if (pendingSession) {
      const session = pendingSession;
      if (Date.parse(session.expiresAt) <= Date.now()) { pendingSession = null; throw new Error('Le délai pour commencer cette partie est écoulé. Commence une nouvelle partie.'); }
      launch(session); return;
    }
    if(knownDeviceRestriction&&Date.parse(knownDeviceRestriction.nextEligibleAt)>Date.now()){startPractice(knownDeviceRestriction);return;}
    await window.BorealRewardMenu?.ready;
    const status = currentStatus();
    if (status.mode === 'pending' || (status.mode !== 'extreme' && !status.rewardsEnabled)) { startPractice(); return; }
    const size = game.dimensions(); const expectedMode = status.mode;
    const turnstileToken = expectedMode === 'rewards' ? await securityToken(status.turnstileSiteKey) : undefined;
    const session = await api('/api/games/start', { width: Math.round(size.width), height: Math.round(size.height), expectedMode, ...(turnstileToken ? { turnstileToken } : {}) });
    if(session.playOnly&&session.rewardRestriction){knownDeviceRestriction=session.rewardRestriction;startPractice(knownDeviceRestriction);return;}
    if (session.engineVersion !== ENGINE_VERSION || !['rewards', 'extreme'].includes(session.mode) || !Number.isInteger(session.seed) || !session.sessionId || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('Le jeu a été mis à jour. Recharge la page avant une partie récompensée.');
    if (session.mode === 'rewards' && ![500, 1000, 2000].includes(session.capCents)) throw new Error('Aucune récompense ne peut être annoncée pour cette partie.');
    session.initialWidth = session.width ?? Math.round(size.width); session.initialHeight = session.height ?? Math.round(size.height);
    const changedCap = session.mode === 'rewards' && session.capCents !== status.capCents;
    if (session.requiresModeConfirmation || session.mode !== expectedMode || changedCap) { confirmMode(session); return; }
    launch(session);
  } catch (error) { if(error.status===429)startPractice(knownDeviceRestriction);else startError(error); }
  finally { setBusy(false); }
}
async function finish(thisRun) {
  if (thisRun.practice) {
    if(thisRun.session.rewardRestriction&&thisRun.state.score>=5000){showRestricted(thisRun.session.rewardRestriction);return;}
    $('feedback').textContent = 'Mode libre terminé — sans récompense. Rejoue pour battre ton record, sans compte.';
    return;
  }
  if (thisRun.finishPromise) return thisRun.finishPromise;
  const box = showPanel('Vérification de la partie', 'Ton score est en cours de vérification. Aucun gain n’est confirmé à cette étape.');
  thisRun.finishPromise = (async () => {
    try {
      const result = await api('/api/games/finish', { sessionId: thisRun.session.sessionId, ticks: thisRun.state.ticks, jumps: thisRun.jumps, resizes: thisRun.resizes });
      if (!Number.isSafeInteger(result.score) || result.score < 0 || result.mode !== thisRun.session.mode) throw new Error('La vérification de la partie est incomplète. Réessaie.');
      thisRun.result = result;
      $('finalScore').textContent = result.score.toLocaleString('fr-CA');
      if(result.rewardRestriction){showRestricted(result.rewardRestriction);return;}
      if (result.eligible && result.mode === 'rewards') { showWinner(thisRun); resultAction(phoneMode(thisRun.session)==='sms'?'Continuer la vérification SMS':'Réclamer mon code', () => challenge?.run === thisRun ? showSmsCode(challenge) : showWinner(thisRun)); }
      else {
        const text = result.mode === 'extreme' ? 'Défi extrême terminé. Ce mode ne donne aucune récompense monétaire.' : 'Partie vérifiée. Le score ne donne pas droit à une récompense.';
        $('feedback').textContent = text;
        const done = showPanel(`${result.score.toLocaleString('fr-CA')} points vérifiés`, text);
        button(done, 'Voir le résultat', hidePanel);
      }
      window.BorealRewardMenu?.refresh?.();
    } catch (error) {
      thisRun.finishPromise = null;
      if (error.reason === 'session_expired') {
        const expired = showPanel('Le délai annoncé est écoulé', 'La partie a dépassé sa validité de 30 minutes, pauses comprises. Ce score ne donne plus droit à une récompense.');
        button(expired, 'Voir le résultat', hidePanel); return;
      }
      const retry = showPanel('Vérification à réessayer', `${error.message} Ta partie est conservée dans cette page pour réessayer.`);
      button(retry, 'Réessayer la vérification', () => finish(thisRun));
      button(retry, 'Voir mon résultat', hidePanel, false);
    }
  })();
  return thisRun.finishPromise;
}
function resultAction(text, action) {
  let actionButton = $('rewardResultAction');
  if (!actionButton) { actionButton = document.createElement('button'); actionButton.id = 'rewardResultAction'; actionButton.className = 'alt'; $('retry').before(actionButton); }
  actionButton.textContent = text; actionButton.onclick = action;
}
function field(form, label, name, attributes) {
  const wrap = document.createElement('label'); wrap.textContent = label;
  const input = document.createElement('input'); input.name = name; Object.assign(input, attributes); wrap.append(input); form.append(wrap); return input;
}
function smsGate(thisRun,control,label){
  const update=()=>{const seconds=Math.max(0,Math.ceil(((thisRun.nextSmsAt||0)-Date.now())/1000));control.disabled=Boolean(thisRun.smsSending)||seconds>0||thisRun.sendsRemaining===0;control.textContent=thisRun.sendsRemaining===0?'Limite de demandes atteinte':seconds>0?label+' ('+seconds+' s)':label;};update();
  const timer=setInterval(()=>{if(!control.isConnected){clearInterval(timer);return;}update();},1000);
}
function rememberSms(thisRun,result){thisRun.nextSmsAt=Date.parse(result.nextSendAt)||Date.now()+60000;thisRun.sendsRemaining=result.sendsRemaining;}
function showRestricted(restriction,thisRun=null) {
  const text='Tu as déjà remporté une récompense au cours des 30 derniers jours. Tu peux continuer à jouer autant que tu le souhaites et tenter de battre ton record ! Tu pourras réclamer une nouvelle récompense lorsque ta période de 30 jours sera terminée.';
  const box=showPanel('Bravo pour ton score ! 🌲',text);
  if(restriction.nextEligibleAt){const p=document.createElement('p');p.textContent='Prochaine admissibilité : '+new Date(restriction.nextEligibleAt).toLocaleString('fr-CA',{timeZone:'America/Toronto'});box.append(p);}
  if(restriction.reason==='device_cooldown')knownDeviceRestriction=restriction;
  $('feedback').textContent=text;
  if(thisRun&&restriction.reason==='phone_cooldown')button(box,'Corriger mes renseignements',()=>{thisRun.claimRequest=null;showWinner(thisRun);},false);
  button(box,'Voir le résultat',hidePanel,false);
}
function showWinner(thisRun) {
  if(phoneMode(thisRun.session)==='sms')return showSmsWinner(thisRun);
  const box=showPanel(`${thisRun.result.score.toLocaleString('fr-CA')} points vérifiés`,`Entre ton nom complet et ton téléphone pour confirmer ton gain. Une seule récompense par numéro tous les 30 jours. Maximum annoncé : ${money(thisRun.session.capCents)}.${thisRun.result.claimDeadline?' Demande à terminer avant '+new Date(thisRun.result.claimDeadline).toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'})+'.':''}`);
  const form=document.createElement('form');box.append(form);
  const first=field(form,'Prénom','firstName',{required:true,maxLength:80,autocomplete:'given-name'}),last=field(form,'Nom','lastName',{required:true,maxLength:80,autocomplete:'family-name'}),phone=field(form,'Téléphone (ex. +15145551234)','phone',{required:true,type:'tel',autocomplete:'tel',maxLength:24});
  const information=document.createElement('p');information.textContent='Aucun SMS ne sera envoyé. Le numéro n’est pas vérifié ; il est enregistré avec ton nom pour retrouver ta récompense et limiter les gains.';form.append(information);
  const consent=field(form,'J’accepte les conditions du bon et l’enregistrement de mon nom et de mon téléphone pour gérer ma récompense.','consent',{required:true,type:'checkbox'});consent.parentElement.className='consent';
  const previous=thisRun.claimRequest||thisRun.profile;
  if(previous){first.value=previous.firstName;last.value=previous.lastName;phone.value=previous.phone;consent.checked=true;}
  const error=document.createElement('p');error.role='status';form.append(error);
  const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=thisRun.claimRequest?'Réessayer ma demande':'Obtenir mon code';form.append(submit);
  const lock=(locked,keepRetry=false)=>{for(const control of form.elements)control.disabled=locked;submit.disabled=locked&&!keepRetry;};
  if(thisRun.claimRequest)lock(true,true);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(thisRun.claimSending||!form.reportValidity())return;thisRun.claimSending=true;lock(true);error.textContent='';
    thisRun.claimRequest ||= {sessionId:thisRun.session.sessionId,firstName:first.value.trim(),lastName:last.value.trim(),phone:phone.value.trim(),consentVersion:CONSENT_VERSION};thisRun.profile={...thisRun.claimRequest};
    try{
      const result=await api('/api/rewards/claim',thisRun.claimRequest);
      if(result.awarded&&result.reward?.code&&[500,1000,2000].includes(result.reward.valueCents)&&result.reward.confirmedAt&&result.reward.claimBy){thisRun.claimRequest=null;showAward(result);}
      else {const problem=new Error(reasonText[result.reason]||'Le gain n’a pas été confirmé. Vérifie les informations de ta demande.');problem.status=409;throw problem;}
    }catch(problem){if(['phone_cooldown','device_cooldown'].includes(problem.reason)){thisRun.claimRequest=null;showRestricted({reason:problem.reason,nextEligibleAt:problem.nextEligibleAt},thisRun);return;}error.textContent=problem.message;if(problem.status>=400&&problem.status<500){thisRun.claimRequest=null;lock(false);submit.textContent='Obtenir mon code';}else{lock(true,true);submit.textContent='Réessayer ma demande';error.textContent+=' Ta demande est conservée : réessaie avec les mêmes informations pour retrouver le même code.';}}
    finally{thisRun.claimSending=false;}
  });
  button(box,'Plus tard sur cette page',hidePanel,false);
}
function showSmsWinner(thisRun) {
  const box = showPanel(`${thisRun.result.score.toLocaleString('fr-CA')} points vérifiés`, `Palier admissible, sous réserve de la vérification SMS et de la règle d’une récompense par personne tous les 30 jours. Maximum annoncé : ${money(thisRun.session.capCents)}. Aucun code n’est attribué avant la confirmation du gain.${thisRun.result.claimDeadline ? ' Vérification à terminer avant ' + new Date(thisRun.result.claimDeadline).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}`);
  const form = document.createElement('form'); box.append(form);
  const first = field(form, 'Prénom', 'firstName', { required: true, maxLength: 80, autocomplete: 'given-name' });
  const last = field(form, 'Nom', 'lastName', { required: true, maxLength: 80, autocomplete: 'family-name' });
  const phone = field(form, 'Téléphone mobile (ex. +15145551234)', 'phone', { required: true, type: 'tel', autocomplete: 'tel', maxLength: 24 });
  const consent = field(form, 'J’accepte la vérification SMS et les conditions de la récompense. Mon numéro sert à vérifier la limite de 30 jours.', 'consent', { required: true, type: 'checkbox' }); consent.parentElement.className = 'consent';
  if(thisRun.profile){first.value=thisRun.profile.firstName;last.value=thisRun.profile.lastName;phone.value=thisRun.profile.phone;consent.checked=true;}
  const error = document.createElement('p'); error.role = 'status'; form.append(error);
  const send = document.createElement('button'); send.className = 'primary'; send.textContent = 'Recevoir mon code SMS'; form.append(send);smsGate(thisRun,send,'Recevoir mon code SMS');
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (thisRun.smsSending || !form.reportValidity()) return;thisRun.smsSending=true;for(const input of form.elements)input.disabled=true; send.disabled = true; error.textContent = '';
    thisRun.profile={phone:phone.value.trim(),firstName:first.value.trim(),lastName:last.value.trim()};
    try {
      const result = await api('/api/rewards/sms/request', { sessionId: thisRun.session.sessionId, phone: phone.value.trim(), firstName: first.value.trim(), lastName: last.value.trim(), consentVersion: CONSENT_VERSION });
      if (!result.challengeId) throw new Error('Le service SMS n’a pas confirmé la demande. Réessaie.');
      rememberSms(thisRun,result);
      challenge = { id: result.challengeId, phone: thisRun.profile.phone, run: thisRun };
      showSmsCode(challenge);
    } catch (problem) { error.textContent = problem.message;if(problem.retryAfter)thisRun.nextSmsAt=Date.now()+problem.retryAfter*1000;send.disabled=false;smsGate(thisRun,send,'Recevoir mon code SMS'); }finally{thisRun.smsSending=false;if(form.isConnected){for(const input of form.elements)input.disabled=false;smsGate(thisRun,send,'Recevoir mon code SMS');}}
  });
  button(box, 'Plus tard sur cette page', hidePanel, false);
}
function showSmsCode(currentChallenge) {
  const thisRun=currentChallenge.run;
  const box = showPanel('Vérifie ton téléphone', 'Entre le code reçu par SMS pour confirmer ton admissibilité. Ton gain sera confirmé après cette vérification.');
  const destination=document.createElement('p');destination.textContent='SMS demandé au '+currentChallenge.phone+'. Tu peux corriger ce numéro avant la confirmation.';box.append(destination);
  const form = document.createElement('form'); box.append(form);
  const code = field(form, 'Code SMS', 'code', { required: true, inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 8, pattern: '[0-9]{6}' });
  const error = document.createElement('p'); error.role = 'status'; form.append(error);
  const verify = document.createElement('button'); verify.className = 'primary'; verify.textContent = 'Confirmer mon gain'; form.append(verify);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return; verify.disabled = true; error.textContent = '';
    try {
      const result = await api('/api/rewards/sms/verify', { challengeId: currentChallenge.id, phone: currentChallenge.phone, code: code.value.trim() });
      if (result.awarded && result.reward?.code && [500,1000,2000].includes(result.reward.valueCents) && result.reward.confirmedAt && result.reward.claimBy) showAward(result);
      else { error.textContent = reasonText[result.reason] || 'Aucune récompense attribuée. La limite est d’une récompense par personne tous les 30 jours.'; verify.disabled = false; }
    } catch (problem) { error.textContent = problem.message; verify.disabled = false; }
  });
  const change=button(box,'Modifier mon numéro',()=>showWinner(thisRun),false);
  const resend=button(box,'Renvoyer le code',async()=>{
    if(thisRun.smsSending)return;thisRun.smsSending=true;resend.disabled=true;verify.disabled=true;code.disabled=true;change.disabled=true;error.textContent='';try{
      const result=await api('/api/rewards/sms/request',{sessionId:thisRun.session.sessionId,...thisRun.profile,consentVersion:CONSENT_VERSION});
      if(!result.challengeId)throw Error('Demande non confirmée');rememberSms(thisRun,result);challenge={id:result.challengeId,phone:thisRun.profile.phone,run:thisRun};showSmsCode(challenge);
    }catch(problem){error.textContent=problem.message;if(problem.retryAfter)thisRun.nextSmsAt=Date.now()+problem.retryAfter*1000;smsGate(thisRun,resend,'Renvoyer le code');}finally{thisRun.smsSending=false;if(form.isConnected){verify.disabled=false;code.disabled=false;change.disabled=false;}}
  },false);smsGate(thisRun,resend,'Renvoyer le code');
  button(box, 'Revenir au résultat', hidePanel, false);
}
function showAward(result) {
  const reward = result.reward;
  if(reward.confirmedAt)knownDeviceRestriction={reason:'device_cooldown',nextEligibleAt:new Date(Date.parse(reward.confirmedAt)+2592000000).toISOString()};
  const scoreText = Number.isSafeInteger(result.score) ? `Score vérifié : ${result.score.toLocaleString('fr-CA')} points. ` : '';
  const usable = reward.status === 'pending' && Date.parse(reward.claimBy) > Date.now();
  const statuses = { claimed: 'Ce code est pris en charge par le personnel du restaurant.', issued: 'Le rabais associé à ce code a déjà été appliqué.', cancelled: 'Cette récompense a été annulée.', expired: 'Le délai de présentation de ce code est écoulé.' };
  const details = usable ? `Présente ce code en personne aux Boréalistes avant le ${new Date(reward.claimBy).toLocaleDateString('fr-CA')}. Code à usage unique, valable 30 jours après attribution. Ce bon donne droit au rabais indiqué sur ta facture, après validation par le personnel. Il est utilisable une seule fois.` : (statuses[reward.status] || 'Le délai de présentation de ce code est écoulé.');
  const box = showPanel(`${money(reward.valueCents)} de rabais sur les aliments`, scoreText + details);
  const food = document.createElement('p'); food.className='reward-food-conditions'; food.textContent='Applicable exclusivement aux aliments vendus au restaurant Les Boréalistes. Aucun rabais direct ou indirect sur les boissons alcooliques. Une facture mixte est admissible pour sa portion alimentaire seulement ; une facture contenant uniquement de l’alcool ne l’est pas. Le rabais est limité à la valeur des aliments admissibles. Toute portion inutilisée est perdue, sans échange contre de l’argent.';box.append(food);
  const code = document.createElement('p'); code.className = 'reward-code'; code.textContent = reward.code; box.append(code);
  button(box, 'Copier le code', async event => {
    try { await navigator.clipboard.writeText(reward.code); event.currentTarget.textContent = 'Code copié'; } catch { code.focus(); }
  });
  const identity=document.createElement('p');identity.textContent=[reward.firstName,reward.lastName].filter(Boolean).join(' ');if(identity.textContent)box.append(identity);
  if(reward.phoneVerified===false || (reward.phoneVerified===undefined&&phoneMode(currentStatus())==='unverified')){const unverified=document.createElement('p');unverified.textContent='Téléphone déclaré, non vérifié par SMS. Une récompense par numéro tous les 30 jours.';box.append(unverified);}
  const saved=document.createElement('p');saved.textContent='Conserve ce code par capture d’écran. Tu peux aussi le copier.';box.append(saved);
  if (usable && currentStatus().notificationSmsEnabled===true) button(box, 'Renvoyer le code par SMS', () => {
    const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),send=document.createElement('button'),status=document.createElement('p');
    label.textContent='Ton numéro vérifié pour cette récompense';input.type='tel';input.autocomplete='tel';input.required=true;label.append(input);send.type='submit';send.textContent='Confirmer le renvoi';form.append(label,send,status);box.append(form);
    const requestId=crypto.randomUUID().replaceAll('-','');
    form.addEventListener('submit',async event=>{event.preventDefault();send.disabled=true;try{const r=await fetch('/api/rewards/notification',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({rewardId:reward.id,phone:input.value,requestId})});const data=await r.json();if(!r.ok)throw Error(data.message||'Renvoi indisponible');status.textContent=data.notification.status==='accepted'?'SMS pris en charge par le fournisseur.':data.notification.status==='disabled'?'Envoi SMS désactivé. Conserve ton code affiché ici.':'Envoi non confirmé. Conserve ton code et vérifie tes messages avant un nouveau renvoi.';}catch(e){status.textContent=e.message;}finally{send.disabled=false;}});
  },false);
  button(box, 'Voir le résultat', hidePanel, false);
  $('feedback').textContent = `${money(reward.valueCents)} attribués. ${details}`;
  resultAction('Afficher mon code attribué', () => showAward(result));
  challenge = null; window.BorealRewardMenu?.refresh?.();
}
async function recoverAward() {
  const box = showPanel('Retrouver un code confirmé', 'Recherche d’une récompense déjà attribuée dans ce navigateur.');
  try {
    const response = await fetch('/api/rewards/confirmation', { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (response.ok && result.reward?.code && [500,1000,2000].includes(result.reward.valueCents) && result.reward.confirmedAt && result.reward.claimBy) { showAward(result); return; }
    const empty = showPanel('Aucun code confirmé trouvé', 'Aucun code attribué n’est associé à ce navigateur. Le formulaire de gain est proposé après une partie admissible.');
    button(empty, 'Retour au menu', hidePanel);
  } catch {
    const retry = showPanel('Recherche à réessayer', 'Le service est temporairement indisponible.');
    button(retry, 'Réessayer', recoverAward); button(retry, 'Retour au menu', hidePanel, false);
  }
}
const recover = $('rewardRecover') || document.createElement('button'); recover.type = 'button'; recover.id = 'rewardRecover'; recover.className = 'alt'; recover.textContent = 'Retrouver mon code confirmé'; recover.onclick = recoverAward;
if (!recover.parentElement) $('home').querySelector('.panel').insertBefore(recover, $('home').querySelector('.boreal-credit'));
window.dispatchEvent(new Event('boreal:menu-layout'));
window.BorealRewards = Object.freeze({ start });
window.dispatchEvent(new Event('boreal:rewards-client-ready'));
Promise.resolve(window.BorealRewardMenu?.ready).then(() => message(conditions(currentStatus())));
window.addEventListener('boreal:rewards-status', () => { if (!game?.isPlaying()) message(conditions(currentStatus())); });
