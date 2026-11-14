import { ENGINE_VERSION, createGame, stepGame, resizeGame } from './game-session-engine.mjs';

const $ = id => document.getElementById(id);
const game = window.BorealGame;
const panel = $('rewardClaim');
const note = $('rewardStartNote');
const money = cents => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(cents / 100);
const modeLabel = mode => mode === 'extreme' ? 'Défi extrême' : 'Mode récompenses';
const CONSENT_VERSION = 'rewards-2026-11-v1';
let busy = false, run = null, pendingSession = null, challenge = null;
let turnstileLoad;
const reasonText = {
  invalid_code: 'Le code SMS est incorrect. Réessaie avec le code reçu.',
  phone_cooldown: 'Ce numéro a déjà obtenu une récompense au cours des 30 derniers jours.',
  invalid_phone: 'Entre un numéro mobile au format international, par exemple +15145551234.',
  challenge_expired: 'Le code SMS a expiré. Reviens au résultat pour demander un nouveau code.',
  session_not_eligible: 'Cette partie ne peut plus confirmer une récompense.',
  session_expired: 'La validité de 30 minutes de cette partie est écoulée.',
  configuration_pending: 'Les récompenses sont en préparation. L’entraînement reste disponible.',
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
  if (!response.ok) { const error = new Error(reasonText[body.reason || body.error] || body.message || 'La demande n’a pas pu être terminée. Réessaie.'); error.status = response.status; error.reason = body.reason || body.error; throw error; }
  return body;
}
function currentStatus() {
  return window.BorealRewardMenu?.getStatus?.() || { mode: 'pending', rewardsEnabled: false, capCents: 0 };
}
function conditions(status) {
  if (status.mode === 'extreme') return 'Défi extrême : vitesse et difficulté accrues. Aucune récompense monétaire.';
  if (status.rewardsEnabled && status.mode === 'rewards') return `Mode récompenses. Plafond annoncé : ${money(status.capCents)}. Une récompense par numéro vérifié tous les 30 jours. Partie valable 30 minutes, pauses comprises. SMS après la partie gagnante seulement.`;
  return 'Entraînement libre, sans compte. Aucune récompense monétaire disponible.';
}
async function securityToken(sitekey) {
  if (!sitekey) throw new Error('Les parties récompensées se préparent. L’entraînement reste disponible.');
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
  const box = showPanel('La partie se prépare', error.message);
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
  message(practice ? 'Entraînement — aucune récompense monétaire.' : session.mode === 'extreme' ? 'Défi extrême — aucune récompense monétaire.' : `Mode récompenses · Plafond réservé : ${money(session.capCents)} · Valable jusqu’à ${new Date(session.expiresAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}.`);
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
function startPractice() {
  if (!game?.ready) return;
  launch({ seed: crypto.getRandomValues(new Uint32Array(1))[0], mode: 'rewards', capCents: 0, expiresAt: null }, true);
}
function confirmMode(session) {
  pendingSession = session;
  const box = showPanel('Le mode disponible a changé', `${conditions({ mode: session.mode, rewardsEnabled: session.mode === 'rewards', capCents: session.capCents })} La difficulté sera fixée pour toute la partie.`);
  button(box, `Commencer en ${modeLabel(session.mode)}`, () => { hidePanel(); start(); });
  button(box, 'Retour au menu', () => { pendingSession = null; hidePanel(); }, false);
}
async function start() {
  if (busy || !game?.ready) return;
  hidePanel(); setBusy(true);
  try {
    if (pendingSession) {
      const session = pendingSession;
      if (Date.parse(session.expiresAt) <= Date.now()) { pendingSession = null; throw new Error('La réservation a expiré. Commence une nouvelle partie.'); }
      launch(session); return;
    }
    await window.BorealRewardMenu?.ready;
    const status = currentStatus();
    if (status.mode === 'pending' || (status.mode !== 'extreme' && !status.rewardsEnabled)) { startPractice(); return; }
    const size = game.dimensions(); const expectedMode = status.mode;
    const turnstileToken = expectedMode === 'rewards' ? await securityToken(status.turnstileSiteKey) : undefined;
    const session = await api('/api/games/start', { width: Math.round(size.width), height: Math.round(size.height), expectedMode, ...(turnstileToken ? { turnstileToken } : {}) });
    if (session.engineVersion !== ENGINE_VERSION || !['rewards', 'extreme'].includes(session.mode) || !Number.isInteger(session.seed) || !session.sessionId || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('Le jeu a été mis à jour. Recharge la page avant une partie récompensée.');
    if (session.mode === 'rewards' && ![500, 1000, 2000].includes(session.capCents)) throw new Error('Aucune récompense ne peut être annoncée pour cette partie.');
    session.initialWidth = session.width ?? Math.round(size.width); session.initialHeight = session.height ?? Math.round(size.height);
    const changedCap = session.mode === 'rewards' && session.capCents !== status.capCents;
    if (session.requiresModeConfirmation || session.mode !== expectedMode || changedCap) { confirmMode(session); return; }
    launch(session);
  } catch (error) { startError(error); }
  finally { setBusy(false); }
}
async function finish(thisRun) {
  if (thisRun.practice) {
    $('feedback').textContent = 'Entraînement terminé — aucune récompense monétaire. Rejoue librement, sans compte.';
    return;
  }
  if (thisRun.finishPromise) return thisRun.finishPromise;
  const box = showPanel('Vérification de la partie', 'Le serveur vérifie les sauts et le score. Aucun gain n’est confirmé à cette étape.');
  thisRun.finishPromise = (async () => {
    try {
      const result = await api('/api/games/finish', { sessionId: thisRun.session.sessionId, ticks: thisRun.state.ticks, jumps: thisRun.jumps, resizes: thisRun.resizes });
      if (!Number.isSafeInteger(result.score) || result.score < 0 || result.mode !== thisRun.session.mode) throw new Error('La vérification de la partie est incomplète. Réessaie.');
      thisRun.result = result;
      $('finalScore').textContent = result.score.toLocaleString('fr-CA');
      if (result.eligible && result.mode === 'rewards') { showWinner(thisRun); resultAction('Continuer la vérification SMS', () => challenge?.run === thisRun ? showSmsCode(challenge) : showWinner(thisRun)); }
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
        const expired = showPanel('Le délai annoncé est écoulé', 'La partie a dépassé sa validité de 30 minutes, pauses comprises. Ce score local ne donne plus droit à une récompense.');
        button(expired, 'Voir le résultat', hidePanel); return;
      }
      const retry = showPanel('Vérification à réessayer', `${error.message} La preuve de la partie est conservée dans cette page.`);
      button(retry, 'Réessayer la vérification', () => finish(thisRun));
      button(retry, 'Voir mon score local', hidePanel, false);
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
function showWinner(thisRun) {
  const box = showPanel(`${thisRun.result.score.toLocaleString('fr-CA')} points vérifiés`, `Palier admissible, sous réserve de la vérification SMS et de la règle d’une récompense par numéro tous les 30 jours. Plafond annoncé : ${money(thisRun.session.capCents)}. Aucun code n’est attribué avant confirmation du serveur.${thisRun.result.claimDeadline ? ' Vérification à terminer avant ' + new Date(thisRun.result.claimDeadline).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}`);
  const form = document.createElement('form'); box.append(form);
  const first = field(form, 'Prénom', 'firstName', { required: true, maxLength: 80, autocomplete: 'given-name' });
  const last = field(form, 'Nom', 'lastName', { required: true, maxLength: 80, autocomplete: 'family-name' });
  const phone = field(form, 'Téléphone mobile (ex. +15145551234)', 'phone', { required: true, type: 'tel', autocomplete: 'tel', maxLength: 24 });
  const consent = field(form, 'J’accepte la vérification SMS et les conditions de la récompense. Mon numéro sert à vérifier la limite de 30 jours.', 'consent', { required: true, type: 'checkbox' }); consent.parentElement.className = 'consent';
  const error = document.createElement('p'); error.role = 'status'; form.append(error);
  const send = document.createElement('button'); send.className = 'primary'; send.textContent = 'Recevoir mon code SMS'; form.append(send);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return; send.disabled = true; error.textContent = '';
    try {
      const result = await api('/api/rewards/sms/request', { sessionId: thisRun.session.sessionId, phone: phone.value.trim(), firstName: first.value.trim(), lastName: last.value.trim(), consentVersion: CONSENT_VERSION });
      if (!result.challengeId) throw new Error('Le service SMS n’a pas confirmé la demande. Réessaie.');
      challenge = { id: result.challengeId, phone: phone.value.trim(), run: thisRun };
      showSmsCode(challenge);
    } catch (problem) { error.textContent = problem.message; send.disabled = false; }
  });
  button(box, 'Plus tard sur cette page', hidePanel, false);
}
function showSmsCode(currentChallenge) {
  const box = showPanel('Vérifie ton téléphone', 'Entre le code reçu par SMS. Aucun gain n’est confirmé avant la réponse du serveur.');
  const form = document.createElement('form'); box.append(form);
  const code = field(form, 'Code SMS', 'code', { required: true, inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 8, pattern: '[0-9]{6}' });
  const error = document.createElement('p'); error.role = 'status'; form.append(error);
  const verify = document.createElement('button'); verify.className = 'primary'; verify.textContent = 'Vérifier et réclamer'; form.append(verify);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return; verify.disabled = true; error.textContent = '';
    try {
      const result = await api('/api/rewards/sms/verify', { challengeId: currentChallenge.id, phone: currentChallenge.phone, code: code.value.trim() });
      if (result.awarded && result.reward?.code && [500,1000,2000].includes(result.reward.valueCents) && result.reward.confirmedAt && result.reward.claimBy) showAward(result);
      else { error.textContent = reasonText[result.reason] || 'Aucune récompense attribuée. La limite est d’une récompense par numéro tous les 30 jours.'; verify.disabled = false; }
    } catch (problem) { error.textContent = problem.message; verify.disabled = false; }
  });
  button(box, 'Revenir au résultat', hidePanel, false);
}
function showAward(result) {
  const reward = result.reward;
  const scoreText = Number.isSafeInteger(result.score) ? `Score vérifié : ${result.score.toLocaleString('fr-CA')} points. ` : '';
  const usable = reward.status === 'pending' && Date.parse(reward.claimBy) > Date.now();
  const statuses = { claimed: 'Ce code a déjà été présenté au restaurant.', issued: 'La carte-cadeau associée a déjà été remise.', cancelled: 'Cette récompense a été annulée.', expired: 'Le délai de présentation de ce code est écoulé.' };
  const details = usable ? `Présente ce code en personne au restaurant avant le ${new Date(reward.claimBy).toLocaleDateString('fr-CA')}. Code à usage unique, valable 30 jours après attribution.` : (statuses[reward.status] || 'Le délai de présentation de ce code est écoulé.');
  const box = showPanel(`${money(reward.valueCents)} attribués`, scoreText + details);
  const code = document.createElement('p'); code.className = 'reward-code'; code.textContent = reward.code; box.append(code);
  button(box, 'Copier le code', async event => {
    try { await navigator.clipboard.writeText(reward.code); event.currentTarget.textContent = 'Code copié'; } catch { code.focus(); }
  });
  button(box, 'Voir le résultat', hidePanel, false);
  $('feedback').textContent = `${money(reward.valueCents)} attribués. ${details}`;
  resultAction('Afficher mon code attribué', () => showAward(result));
  challenge = null; window.BorealRewardMenu?.refresh?.();
}
async function recoverAward() {
  const box = showPanel('Retrouver un code confirmé', 'Recherche d’une récompense déjà attribuée après vérification SMS dans ce navigateur.');
  try {
    const response = await fetch('/api/rewards/confirmation', { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (response.ok && result.reward?.code && [500,1000,2000].includes(result.reward.valueCents) && result.reward.confirmedAt && result.reward.claimBy) { showAward(result); return; }
    const empty = showPanel('Aucun code confirmé trouvé', 'Aucun code attribué n’est associé à ce navigateur. La vérification SMS est proposée après une partie admissible.');
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
