'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const dateTime = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });
  const dateOnly = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeZone: 'America/Toronto' });
  const labels = { pending: 'À utiliser', claimed: 'Pris en charge', issued: 'Déjà utilisé', expired: 'Code expiré', cancelled: 'Annulé' };
  const state = { employee: null, rewards: [], selected: null, cursor: null, listRequest: 0, auditRequest: 0, session: 0, busy: false, listBusy: false, budget: null, budgetRequest: 0, budgetBusy: false, budgetDraft: null, budgetOperation: null };

  class ApiError extends Error {
    constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }
  function amount(value) { return Number.isSafeInteger(value) && value >= 0 ? money.format(value / 100) : 'Montant indisponible'; }
  function date(value, withTime = true) {
    const parsed = new Date(value);
    return value && Number.isFinite(parsed.getTime()) ? (withTime ? dateTime : dateOnly).format(parsed) : 'Non renseigné';
  }
  function name(reward) { return [reward.firstName, reward.lastName].filter(Boolean).join(' ') || 'Client'; }
  function subject() { return state.employee && (state.employee.sub || state.employee.subject); }
  function claimDeadline(reward) { return reward.claimDeadline || reward.claimBy; }
  function ownClaim(reward) { return Boolean(subject() && reward.claimedBy === subject()); }
  function badge(status, discountApplied = false) { return node('span', 'status-badge status-' + (Object.hasOwn(labels, status) ? status : 'unknown'), status === 'issued' && discountApplied ? 'Utilisé · rabais appliqué' : labels[status] || 'Statut à vérifier'); }
  function showNotice(message, error = false) {
    $('notification').textContent = message;
    $('notification').classList.toggle('error', error);
    $('notification').hidden = false;
  }
  function clearNotice() { $('notification').hidden = true; $('notification').textContent = ''; }
  function serviceError(status, code) {
    if (status === 429) return 'Trop de tentatives. Patientez un moment avant de réessayer.';
    const messages = {
      admin_unavailable: 'L’espace employés est indisponible. Faites vérifier la connexion sécurisée et le registre par le responsable de l’hébergement, puis réessayez.',
      reward_not_found: 'CODE INTROUVABLE. Vérifiez le code présenté par le client.',
      reward_conflict: 'Ce code a déjà été utilisé, est expiré ou a changé de statut. Actualisez sa fiche.',
      discount_confirmation_required: 'Confirmez que le rabais a été appliqué sur la facture.',
      invalid_budget: 'Saisissez un montant CAD valide, avec au plus deux décimales.',
      budget_month_changed: 'Le mois a changé. Vérifiez le nouveau mois avant de recommencer.',
      budget_conflict: 'Le budget a été modifié par un autre responsable. Vérifiez les montants actualisés.',
      budget_below_committed: 'Le budget proposé est inférieur aux montants déjà attribués et réservés. Vérifiez le minimum actualisé.',
      budget_request_conflict: 'Cette modification ne correspond plus à la demande initiale. Vérifiez les montants actualisés.',
      export_too_large: 'Choisissez un statut avant d’exporter les récompenses.'
    };
    return Object.hasOwn(messages, code) ? messages[code] : 'Le service est temporairement indisponible. Réessayez dans un instant.';
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch('/api/admin' + path, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'follow',
        ...options,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
      });
    } catch (_) {
      throw new ApiError('Connexion interrompue. Actualisez pour vérifier l’état de l’opération.');
    }
    if (response.status === 401 || response.status === 403) {
      showAccess(response.status);
      throw new ApiError('Votre accès doit être vérifié.', response.status);
    }
    let data;
    try { data = await response.json(); }
    catch (_) { throw new ApiError('La connexion n’a pas pu être confirmée. Réessayez dans un instant.', response.status); }
    if (!response.ok) throw new ApiError(serviceError(response.status, data.error), response.status, data.error);
    return data;
  }

  function showAccess(status, message) {
    state.session += 1;
    state.employee = null;
    document.dispatchEvent(new CustomEvent('boreal:admin-session', { detail: { employee: null, session: state.session } }));
    state.rewards = [];
    state.selected = null;
    state.cursor = null;
    state.budget = null; state.budgetDraft = null; state.budgetOperation = null; state.budgetBusy = false;
    state.budgetRequest += 1;
    $('budget-editor').hidden = true;
    if ($('budget-dialog').open) $('budget-dialog').close();
    state.auditRequest += 1;
    $('reward-list').replaceChildren();
    $('audit-list').replaceChildren();
    $('detail-name').textContent = '';
    $('detail-code').textContent = '';
    $('detail-value').textContent = '';
    $('detail-facts').replaceChildren();
    $('detail-action').replaceChildren();
    $('employee-name').textContent = '';
    $('code-search').value = '';
    $('claim-summary').textContent = '';
    if ($('claim-dialog').open) $('claim-dialog').close();
    $('admin-content').hidden = true;
    $('access-panel').hidden = false;
    $('access-identity').hidden = true;
    $('access-identity').textContent = '';
    $('access-login').hidden = status !== 401 && status !== 403;
    $('access-retry').hidden = status === 401;
    if (status === 401) {
      $('access-title').textContent = 'Connectez-vous à votre compte';
      $('access-message').textContent = 'Connectez-vous avec votre courriel autorisé et le code reçu par courriel. La session reste ouverte pendant le service ; aucune reconnexion à chaque code. Aucun compte Cloudflare n’est nécessaire.';
    } else if (status === 403) {
      $('access-title').textContent = 'Accès employé requis';
      $('access-message').textContent = 'Votre compte est connecté, mais il ne figure pas parmi les employés autorisés. Contactez votre responsable pour faire vérifier votre accès.';
      const currentSession = state.session;
      fetch('/api/admin/identity', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
        .then((response) => response.ok ? response.json() : null)
        .then((identity) => {
          if (state.session !== currentSession || !identity) return;
          const parts = [identity.email, identity.sub].filter((value) => typeof value === 'string');
          if (parts.length) { $('access-identity').textContent = 'Compte à transmettre au responsable : ' + parts.join(' · '); $('access-identity').hidden = false; }
        }).catch(() => {});
    } else {
      $('access-title').textContent = status === 503 ? 'Accès au registre indisponible' : 'Connexion momentanément indisponible';
      $('access-message').textContent = message || 'Le service ne répond pas. Aucune récompense ne peut être traitée pour le moment.';
    }
  }

  async function boot() {
    const session = ++state.session;
    state.employee = null;
    document.dispatchEvent(new CustomEvent('boreal:admin-session', { detail: { employee: null, session } }));
    $('access-title').textContent = 'Vérification de votre accès…';
    $('access-message').textContent = 'Veuillez patienter pendant la connexion à votre compte individuel.';
    $('access-login').hidden = true;
    $('access-retry').hidden = true;
    $('access-identity').hidden = true;
    try {
      const data = await api('/me');
      if (session !== state.session) return;
      if (!data.employee || !(data.employee.sub || data.employee.subject)) throw new ApiError('Votre compte doit être vérifié par votre responsable.');
      state.employee = data.employee;state.employee.phoneVerificationMode=data.phoneVerificationMode==='sms'?'sms':'unverified';state.employee.notificationSmsEnabled=data.notificationSmsEnabled===true;
      $('employee-name').textContent = data.employee.name || data.employee.email || 'Compte employé';
      $('access-panel').hidden = true;
      $('admin-content').hidden = false;
      clearNotice();
      document.dispatchEvent(new CustomEvent('boreal:admin-session', { detail: { employee: state.employee, session } }));
      await Promise.allSettled([loadRewards(), loadBudget()]);
    } catch (error) { if (error.status !== 401 && error.status !== 403) showAccess(error.status === 503 ? 503 : 0, error.message); }
  }

  function validBudget(data) {
    const integer = (value) => Number.isSafeInteger(value) && value >= 0;
    return data && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) &&
      ['budgetCents', 'usedCents', 'reservedCents', 'remainingCents', 'pendingCount', 'usedCount', 'defaultBudgetCents', 'revision', 'defaultRevision', 'minimumBudgetCents', 'minimumFutureBudgetCents'].every((key) => integer(data[key])) &&
      data.countScope === 'all' && data.remainingCents === Math.max(0, data.budgetCents - data.usedCents - data.reservedCents) &&
      data.minimumBudgetCents === Math.max(0, data.usedCents + data.reservedCents - (data.authorizedExceptionalCents || 0)) && data.minimumFutureBudgetCents >= data.minimumBudgetCents;
  }

  function budgetMonth(month) {
    return new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-15T12:00:00Z'));
  }

  function renderBudgetEditor() {
    const data = state.budget;
    const visible = state.employee?.role === 'manager' && Boolean(data);
    $('budget-editor').hidden = !visible;
    $('budget-fields').disabled = !visible || state.budgetBusy || Boolean(state.budgetOperation);
    $('budget-retry').hidden = !visible || !state.budgetOperation || state.budgetBusy;
    if (!visible) return;
    $('budget-future').textContent = 'Budget par défaut des mois suivants : ' + amount(data.defaultBudgetCents) + ' par mois.';
    $('budget-commitments').textContent = 'Minimum engagé pour ' + budgetMonth(data.month) + ' : ' + amount(data.minimumBudgetCents) + '. Pour ce mois et les suivants : ' + amount(data.minimumFutureBudgetCents) + '.';
    $('budget-updated').hidden = !data.updatedAt;
    if (data.updatedAt) $('budget-updated').textContent = 'Dernière modification : ' + date(data.updatedAt) + (data.updatedByName ? ' · ' + data.updatedByName : '');
    if (!state.budgetOperation && !state.budgetDraft) $('budget-amount').value = (data.budgetCents / 100).toFixed(2).replace('.', ',');
  }

  async function loadBudget() {
    const session = state.session;
    const request = ++state.budgetRequest;
    state.budget = null;
    renderBudgetEditor();
    $('budget-values').setAttribute('aria-busy', 'true');
    $('budget-error').hidden = true;
    try {
      const data = await api('/budget');
      if (session !== state.session || request !== state.budgetRequest || !state.employee) return;
      if (!validBudget(data)) throw new ApiError('Budget incomplet.');
      state.budget = data;
      $('budget-total').textContent = amount(data.budgetCents);
      $('budget-remaining').textContent = amount(data.remainingCents);
      $('budget-used').textContent = amount(data.usedCents);
      $('budget-overrun').hidden=!(data.overrunCents>0);$('budget-overrun').textContent='Dépassement actuel, réservations comprises : '+amount(data.overrunCents||0)+'. Autorisations exceptionnelles cumulées : '+amount(data.authorizedExceptionalCents||0)+'. Le plafond normal demeure inchangé.';
      $('budget-reserved').textContent = amount(data.reservedCents) + ' retenus pour les parties en cours. ';
      $('budget-reserved').hidden = !Number.isSafeInteger(data.reservedCents) || data.reservedCents <= 0;
      $('budget-pending').textContent = Number.isSafeInteger(data.pendingCount) ? String(data.pendingCount) : '—';
      $('budget-used-count').textContent = Number.isSafeInteger(data.usedCount) ? String(data.usedCount) : '—';
      $('budget-month').textContent = budgetMonth(data.month);
      renderBudgetEditor();
    } catch (error) {
      if (session !== state.session || request !== state.budgetRequest) return;
      for (const id of ['budget-total', 'budget-remaining', 'budget-used', 'budget-pending', 'budget-used-count']) $(id).textContent = '—';
      $('budget-reserved').hidden = true;
      $('budget-month').textContent = 'Données indisponibles';
      $('budget-error').textContent = 'Le budget n’a pas pu être chargé. Utilisez « Actualiser » pour réessayer.';
      $('budget-error').hidden = false;
    } finally { if (session === state.session && request === state.budgetRequest) $('budget-values').setAttribute('aria-busy', 'false'); }
  }

  function reviewBudget(event) {
    event.preventDefault();
    if (state.employee?.role !== 'manager' || !state.budget || state.budgetBusy || state.budgetOperation) return;
    const input = $('budget-amount');
    input.setCustomValidity('');
    const value = input.value.trim();
    const cents = /^(?:0|[1-9]\d*)(?:[,.]\d{1,2})?$/.test(value) ? Math.round(Number(value.replace(',', '.')) * 100) : NaN;
    const scope = document.querySelector('input[name="budget-scope"]:checked')?.value;
    const minimum = scope === 'current_and_future' ? state.budget.minimumFutureBudgetCents : state.budget.minimumBudgetCents;
    if (!Number.isSafeInteger(cents) || cents < 0) input.setCustomValidity('Saisissez un montant CAD positif ou nul, avec au plus deux décimales.');
    else if (cents < minimum) input.setCustomValidity('Le minimum déjà engagé est de ' + amount(minimum) + '.');
    if (!$('budget-edit-form').reportValidity() || !['month_only', 'current_and_future'].includes(scope)) return;
    const data = state.budget;
    state.budgetDraft = { month: data.month, budgetCents: cents, scope, expectedRevision: data.revision, expectedDefaultRevision: data.defaultRevision, requestId: crypto.randomUUID() };
    $('budget-confirmation-summary').textContent = budgetMonth(data.month) + ' : ' + amount(data.budgetCents) + ' → ' + amount(cents) + '. ' +
      (scope === 'month_only' ? 'Ce mois-ci seulement. Le budget par défaut des mois suivants reste à ' + amount(data.defaultBudgetCents) + ' par mois.' : 'Ce mois-ci et les mois suivants. Le budget par défaut passe de ' + amount(data.defaultBudgetCents) + ' à ' + amount(cents) + ' par mois.') +
      ' Minimum engagé pour cette portée : ' + amount(minimum) + '.';
    $('budget-operation-error').hidden = true;
    $('budget-dialog').showModal();
  }

  async function saveBudget(event) {
    event?.preventDefault();
    if (state.employee?.role !== 'manager' || state.budgetBusy || (!state.budgetOperation && !state.budgetDraft)) return;
    state.budgetOperation ||= state.budgetDraft;
    state.budgetDraft = null;
    const operation = state.budgetOperation;
    const session = state.session;
    state.budgetBusy = true;
    $('budget-confirm').disabled = true; $('budget-cancel').disabled = true;
    $('budget-operation-error').hidden = true;
    renderBudgetEditor();
    try {
      const data = await api('/budget', { method: 'PATCH', body: JSON.stringify(operation) });
      if (session !== state.session || !state.employee) return;
      if (!validBudget(data)) throw new ApiError('La modification n’a pas pu être confirmée.');
      state.budgetOperation = null;
      $('budget-dialog').close();
      showNotice('Budget enregistré pour ' + budgetMonth(operation.month) + ' : ' + amount(operation.budgetCents) + (operation.scope === 'current_and_future' ? ', ainsi que pour les mois suivants.' : '. Les mois suivants conservent leur budget par défaut.'));
      await loadBudget();
      document.dispatchEvent(new Event('boreal:admin-data-changed'));
    } catch (error) {
      if (session !== state.session) return;
      $('budget-dialog').close();
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        state.budgetOperation = null;
        await loadBudget();
        $('budget-operation-error').textContent = error.message;
      } else {
        $('budget-operation-error').textContent = error.message + ' Le résultat est incertain. Réessayez la même modification pour vérifier son enregistrement.';
      }
      $('budget-operation-error').hidden = false;
    } finally {
      if (session === state.session) {
        state.budgetBusy = false;
        $('budget-confirm').disabled = false; $('budget-cancel').disabled = false;
        renderBudgetEditor();
      }
    }
  }

  function listState(title, message, retry = false) {
    const container = $('list-state');
    container.replaceChildren(node('span', 'state-symbol', retry ? '↻' : '○'), node('h3', '', title), node('p', '', message));
    container.firstChild.setAttribute('aria-hidden', 'true');
    if (retry) {
      const button = node('button', 'button secondary', 'Réessayer');
      button.type = 'button';
      button.addEventListener('click', () => loadRewards());
      container.append(button);
    }
    container.hidden = false;
  }

  function setListBusy(busy) {
    state.listBusy = busy;
    $('reward-list').setAttribute('aria-busy', String(busy));
    $('refresh-button').disabled = busy;
    $('load-more').disabled = busy;
    $('search-form').querySelector('button').disabled = busy;
  }

  async function loadRewards(append = false) {
    const request = ++state.listRequest;
    const session = state.session;
    const query = new URLSearchParams();
    const search = $('code-search').value.trim();
    const status = $('status-filter').value;
    if (search) query.set('search', search);
    if (status && !search) query.set('status', status);
    if (append && state.cursor) query.set('cursor', state.cursor);
    setListBusy(true);
    if (!append) {
      $('reward-list').replaceChildren();
      $('result-count').textContent = 'Chargement des récompenses…';
      listState('Chargement des gagnants', 'Un instant, s’il vous plaît.');
    }
    $('load-more').hidden = true;
    try {
      const data = await api('/rewards' + (query.size ? '?' + query.toString() : ''));
      if (request !== state.listRequest || session !== state.session || !state.employee) return;
      if (!Array.isArray(data.rewards)) throw new ApiError('Les récompenses n’ont pas pu être chargées. Réessayez.');
      state.rewards = append ? [...state.rewards, ...data.rewards.filter((reward) => !state.rewards.some((item) => item.id === reward.id))] : data.rewards;
      state.cursor = data.nextCursor || null;
      renderRewards();
      if (search && state.rewards.length === 1) {
        selectReward(state.rewards[0]);
      } else if (state.selected) {
        const updated = state.rewards.find((reward) => reward.id === state.selected.id);
        if (updated) { state.selected = updated; renderDetail(); }
      }
    } catch (error) {
      if (request !== state.listRequest || session !== state.session) return;
      $('result-count').textContent = 'Registre indisponible';
      if (!append) state.rewards = [];
      listState('Le registre n’a pas pu être chargé', error.message, true);
    } finally { if (request === state.listRequest && session === state.session) setListBusy(false); }
  }

  function selectReward(reward) {
    if (state.busy) return;
    state.selected = reward;
    clearNotice();
    renderRewards();
    renderDetail();
    loadAudit();loadEligibility();
    if (matchMedia('(max-width: 850px)').matches) $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderRewards() {
    const list = $('reward-list');
    list.replaceChildren();
    for (const reward of state.rewards) {
      const row = node('button', 'reward-row' + (state.selected && state.selected.id === reward.id ? ' is-selected' : ''));
      row.type = 'button';
      row.dataset.rewardId = reward.id;
      row.setAttribute('aria-pressed', String(Boolean(state.selected && state.selected.id === reward.id)));
      const customer = node('span', 'row-customer');
      customer.append(node('span', 'customer-name', name(reward)), node('span', 'row-code', reward.code));
      row.append(customer, node('span', 'row-value', amount(reward.valueCents)), badge(reward.status, reward.discountApplied === true));
      row.addEventListener('click', () => selectReward(reward));
      list.append(row);
    }
    $('result-count').textContent = state.rewards.length + (state.rewards.length > 1 ? ' récompenses affichées' : ' récompense affichée');
    $('list-state').hidden = state.rewards.length > 0;
    const searching = Boolean($('code-search').value.trim());
    $('registry-title').textContent = searching ? 'Résultat de la recherche' : $('status-filter').value ? 'Récompenses par statut' : 'Derniers gagnants';
    if (!state.rewards.length) listState(searching ? 'AUCUN RÉSULTAT' : 'Aucune récompense trouvée', searching ? 'Vérifiez le nom, le téléphone ou le code saisi.' : 'Aucun gagnant à afficher pour le moment.');
    $('load-more').hidden = !state.cursor;
  }

  function fact(label, value) {
    const row = node('div', 'detail-fact');
    row.append(node('dt', '', label), node('dd', '', value));
    $('detail-facts').append(row);
  }
  function renderDetail() {
    const reward = state.selected;
    $('detail-empty').hidden = Boolean(reward);
    $('detail-content').hidden = !reward;
    if (!reward) return;
    const statusBadge = badge(reward.status, reward.discountApplied === true);
    statusBadge.id = 'detail-status';
    $('detail-status').replaceWith(statusBadge);
    $('detail-name').textContent = name(reward);
    $('detail-code').textContent = reward.code || 'Code indisponible';
    $('detail-value').textContent = amount(reward.valueCents);
    $('detail-validation').textContent = reward.status === 'claimed' ? 'CODE PRIS EN CHARGE' : reward.status === 'issued' ? 'CODE DÉJÀ UTILISÉ' : reward.status === 'expired' ? 'CODE EXPIRÉ' : '';
    $('detail-validation').hidden = !$('detail-validation').textContent;
    $('detail-facts').replaceChildren();
    fact('Téléphone fourni', reward.phone || 'Non disponible pour cette ancienne récompense');
    fact('Vérification du téléphone', reward.phoneVerified === true ? 'Vérifié par SMS' : 'Numéro déclaré, non vérifié par SMS');
    fact('Date d’attribution', date(reward.confirmedAt));
    fact('Origine',reward.source==='manual'?'Création manuelle par un gestionnaire':'Partie vérifiée');
    if (reward.appliedValueCents!=null){fact('Rabais réellement appliqué',amount(reward.appliedValueCents));fact('Portion inutilisée perdue',amount(reward.unusedCents));}
    if (reward.score !== undefined && reward.score !== null) fact('Score', Number.isSafeInteger(reward.score) ? reward.score.toLocaleString('fr-CA') : 'Non renseigné');
    fact('Code utilisable jusqu’au', date(claimDeadline(reward)));
    if (reward.claimedAt) fact('Pris en charge le', date(reward.claimedAt));
    if (reward.claimedBy) fact('Employé responsable', ownClaim(reward) ? state.employee.name || state.employee.email : reward.claimedByName || reward.claimedBy);
    if (reward.issuedAt) fact(reward.discountApplied === true ? 'Rabais appliqué le' : 'Utilisation enregistrée le', date(reward.issuedAt));
    if (reward.issuedByName) fact('Utilisation confirmée par', reward.issuedByName);
    renderAction();
  }

  function notificationForm(reward) {
    const form=node('form'),label=node('label','field','Téléphone du bénéficiaire pour renvoyer le code'),input=node('input'),send=node('button','button secondary','Renvoyer le SMS du code'),message=node('p');input.type='tel';input.required=true;label.append(input);send.type='submit';form.append(label,send,message);const requestId=crypto.randomUUID().replaceAll('-','');
    form.addEventListener('submit',async e=>{e.preventDefault();send.disabled=true;try{const data=await api('/rewards/'+encodeURIComponent(reward.id)+'/notify',{method:'POST',body:JSON.stringify({phone:input.value,requestId})});message.textContent=data.notification.status==='accepted'?'SMS pris en charge par le fournisseur.':data.notification.status==='disabled'?'Envoi des SMS de récompense désactivé.':'Envoi non confirmé. Vérifiez les messages avant de recommencer.';}catch(error){message.textContent=error.message;}finally{send.disabled=false;}});return form;
  }
  function renderAction() {
    const reward = state.selected;
    const container = $('detail-action');
    container.replaceChildren();
    if (!reward) return;
    const block = node('div', 'action-block');
    if (reward.status === 'pending') {
      block.append(node('h3', '', '1. Prendre en charge le code'), node('p', '', 'Vérifiez le montant avec le client, puis confirmez. Attendez la confirmation avant d’appliquer le rabais sur la facture.'));
      const button = node('button', 'button primary', 'PRENDRE EN CHARGE');
      button.id = 'claim-button'; button.type = 'button'; button.disabled = state.busy;
      button.addEventListener('click', openClaimDialog);
      block.append(button);
    } else if (reward.status === 'claimed' && ownClaim(reward)) {
      block.append(node('h3', '', '2. Appliquer le rabais sur la facture'), node('p', '', 'Le code est pris en charge à votre nom. Vérifiez la facture, puis appliquez manuellement une seule fois le rabais de ' + amount(reward.valueCents) + ' dans la caisse du restaurant.'));
      const form = node('form'); form.id = 'use-form';
      const checkLabel = node('label', 'checkbox-label');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'discount-confirm'; checkbox.required = true; checkbox.disabled = state.busy;
      checkLabel.append(checkbox, node('span', '', 'Le rabais a été appliqué sur la facture.'));
      const error = node('p', 'inline-error'); error.id = 'use-error'; error.hidden = true; error.setAttribute('role', 'alert');
      const submit = node('button', 'button primary', '3. Confirmer le rabais appliqué'); submit.type = 'submit'; submit.id = 'use-confirm'; submit.disabled = state.busy;
      const foodLabel=node('label','field','Valeur des aliments admissibles (CAD, hors boissons alcooliques)'),foodInput=node('input');foodInput.id='eligible-food-amount';foodInput.type='text';foodInput.inputMode='decimal';foodInput.required=true;foodInput.disabled=state.busy;foodLabel.append(foodInput);
      const foodConfirmLabel=node('label','checkbox-label'),foodCheck=node('input');foodCheck.type='checkbox';foodCheck.id='food-only-confirm';foodCheck.required=true;foodCheck.disabled=state.busy;foodConfirmLabel.append(foodCheck,node('span','','Rabais applicable uniquement aux aliments. Aucun rabais direct ou indirect sur les boissons alcooliques.'));
      const preview=node('p','','Indiquez la portion alimentaire avant d’appliquer le rabais dans Lightspeed.');
      foodInput.addEventListener('input',()=>{const cents=moneyInput(foodInput.value);preview.textContent=cents>0?'Rabais à appliquer : '+amount(Math.min(cents,reward.valueCents))+'. Portion inutilisée perdue : '+amount(Math.max(0,reward.valueCents-cents))+'.':'Facture sans aliments admissibles : aucun rabais possible.';});
      form.append(foodLabel,preview,foodConfirmLabel,checkLabel, error, submit);
      form.addEventListener('submit', confirmUse);
      block.append(form);
    } else if (reward.status === 'claimed') {
      block.append(node('h3', '', 'Code déjà pris en charge'), node('p', '', 'Un autre employé a pris en charge ce code et doit terminer avec son compte. N’appliquez pas un deuxième rabais.'));
    } else if (reward.status === 'issued') {
      block.append(node('h3', '', reward.discountApplied === true ? 'Rabais appliqué et enregistré' : 'Code déjà utilisé'), node('p', '', 'Cette récompense a déjà été utilisée. Aucun autre rabais ne doit être appliqué pour ce code.'));
    } else if (reward.status === 'expired') {
      block.append(node('h3', '', 'La date limite du code est dépassée'), node('p', '', 'Cette récompense ne peut plus être utilisée. N’appliquez aucun rabais pour ce code.'));
    } else if (reward.status === 'cancelled') {
      block.append(node('h3', '', 'Récompense annulée'), node('p', '', reward.cancelReason || 'Cette récompense ne peut pas être utilisée.'));
    } else {
      block.append(node('h3', '', 'Vérification nécessaire'), node('p', '', 'Cette récompense nécessite une vérification. Actualisez le registre et contactez votre responsable.'));
    }
    container.append(block);
    if(reward.status==='pending' && state.employee?.notificationSmsEnabled===true)container.append(notificationForm(reward));
  }

  async function loadEligibility() {
    const reward=state.selected,session=state.session,section=$('eligibility-section');if(!reward||!section)return;
    section.replaceChildren(node('h3','','Admissibilité et doublons'),node('p','','Vérification du registre…'));
    try{
      const data=await api('/rewards/'+encodeURIComponent(reward.id)+'/eligibility');if(session!==state.session||state.selected?.id!==reward.id)return;
      section.replaceChildren(node('h3','','Admissibilité et doublons'));
      if(data.potentialDuplicate)section.append(node('p','inline-error','Doublon potentiel : plusieurs gains ou une tentative répétée sont associés au téléphone ou à cet appareil. Vérifiez l’historique ; ce signal ne prouve pas une fraude.'));
      for(const [key,label] of [['phone','Téléphone'],['device','Navigateur / appareil']]){const limit=data[key];if(!limit)continue;section.append(node('p','',label+' : '+(limit.exceptionAvailable?'déblocage autorisé jusqu’au '+date(limit.exceptionExpiresAt):limit.nextEligibleAt?'prochaine admissibilité '+date(limit.nextEligibleAt):'aucune restriction active')+(key==='device'&&!limit.tracked?' (aucun appareil lié à ce bon)':'')));}
      for(const entry of data.history||[])section.append(node('p','',date(entry.confirmedAt)+' · '+entry.fullName+' · '+amount(entry.valueCents)+' · '+entry.code));
      for(const signal of data.signals||[])section.append(node('p','',date(signal.createdAt)+' · tentative répétée'+(signal.differentName?' avec un nom différent':'')+' · '+(signal.reason==='device_cooldown'?'même appareil':'même téléphone')));
      if(state.employee?.role==='manager'){
        const form=node('form'),label=node('label','field','Déblocage exceptionnel pour un seul nouveau gain'),scope=node('select');scope.id='unlock-scope';
        for(const [value,text] of [['phone','Téléphone'],['device','Appareil partagé'],['both','Téléphone et appareil']]){const option=node('option','',text);option.value=value;option.disabled=value!=='phone'&&!data.device?.tracked;scope.append(option);}label.append(scope);
        const why=node('textarea');why.id='unlock-reason';why.required=true;why.minLength=8;why.maxLength=500;why.placeholder='Justification obligatoire (8 caractères minimum)';why.setAttribute('aria-label','Justification du déblocage');
        const help=node('p','','Ce déblocage autorise un seul nouveau gain dans les prochaines 24 heures, sans modifier le budget ni effacer les gains précédents. Le joueur doit actualiser sa page après un déblocage d’appareil.');
        const confirm=node('button','button secondary','Autoriser un gain exceptionnel');confirm.type='submit';confirm.id='unlock-confirm';const message=node('p');message.setAttribute('role','status');
        form.append(label,why,help,message,confirm);section.append(form);const requestId=crypto.randomUUID().replaceAll('-','');let operation=null,busy=false;
        form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!form.reportValidity())return;operation ||= {scope:scope.value,reason:why.value,requestId};busy=true;for(const input of form.elements)input.disabled=true;
          try{await api('/rewards/'+encodeURIComponent(reward.id)+'/unlock',{method:'POST',body:JSON.stringify(operation)});if(session!==state.session||state.selected?.id!==reward.id)return;showNotice('Déblocage exceptionnel enregistré pour un seul gain. Le budget reste inchangé.');await Promise.allSettled([loadEligibility(),loadAudit()]);}
          catch(error){message.textContent=error.message;if(error.status>=400&&error.status<500){operation=null;for(const input of form.elements)input.disabled=false;}else{message.textContent+=' Réessayez la même demande.';confirm.disabled=false;confirm.textContent='Réessayer le même déblocage';}}finally{busy=false;}
        });
      }
    }catch(error){if(session===state.session&&state.selected?.id===reward.id)section.replaceChildren(node('h3','','Admissibilité et doublons'),node('p','','Informations indisponibles. Actualisez la fiche.'));}
  }
  async function loadAudit() {
    const reward = state.selected;
    if (!reward) return;
    const request = ++state.auditRequest;
    const session = state.session;
    $('audit-list').replaceChildren();
    $('audit-state').textContent = 'Chargement de l’historique…';
    $('audit-state').hidden = false;
    try {
      const data = await api('/audit?rewardId=' + encodeURIComponent(reward.id));
      if (request !== state.auditRequest || session !== state.session || !state.selected || reward.id !== state.selected.id) return;
      const events = data.events || data.audit;
      if (!Array.isArray(events)) throw new ApiError('Historique incomplet.');
      const actionLabels = { claimed: 'Code pris en charge', claim: 'Code pris en charge', reward_claimed: 'Code pris en charge', issued: 'Utilisation enregistrée', issue: 'Utilisation enregistrée', reward_issued: 'Utilisation enregistrée', used: 'Rabais appliqué sur la facture', discount_applied: 'Rabais appliqué sur la facture', confirmed: 'Récompense attribuée', reward_confirmed: 'Récompense attribuée', preview_test_used:'Ancienne consommation technique sans rabais appliqué', duplicate_detected:'Tentative répétée signalée',manager_exception_granted:'Déblocage exceptionnel autorisé',manager_exception_consumed:'Exception utilisée pour un nouveau gain', manual_confirmed:'Bon créé manuellement', reward_sms_requested:'SMS demandé', reward_sms_result:'Résultat de la demande SMS', cancelled: 'Récompense annulée', cancel: 'Récompense annulée', reward_cancelled: 'Récompense annulée' };
      for (const event of events) {
        const item = node('li');
        const action = event.action === 'issued' && (event.details?.discountApplied === true || reward.discountApplied === true) ? 'Rabais appliqué sur la facture' : actionLabels[event.action] || 'Mise à jour de la récompense';
        item.append(node('span', 'audit-action', action), node('span', 'audit-meta', [date(event.createdAt), event.actorName || event.actor || event.actorSub, amount(event.details?.appliedValueCents??event.details?.valueCents??reward.valueCents)].filter(Boolean).join(' · ')));
        for(const key of ['reason','budgetOverrideReason','cooldownOverrideReason'])if(event.details?.[key])item.append(node('p','',event.details[key]));
        if(event.details?.exceptionalCents>0)item.append(node('p','','Montant exceptionnel : '+amount(event.details.exceptionalCents)));
        $('audit-list').append(item);
      }
      $('audit-state').hidden = events.length > 0;
      if (!events.length) $('audit-state').textContent = 'Aucun événement enregistré.';
    } catch (error) {
      if (request !== state.auditRequest || session !== state.session) return;
      $('audit-state').textContent = 'Historique momentanément indisponible. Actualisez pour réessayer.';
    }
  }

  function openClaimDialog() {
    if (state.busy || !state.selected || state.selected.status !== 'pending') return;
    $('claim-summary').textContent = amount(state.selected.valueCents) + ' pour ' + name(state.selected) + ' · Code ' + state.selected.code + ' · Employé : ' + (state.employee.name || state.employee.email);
    $('claim-dialog-error').hidden = true;
    $('claim-confirm').disabled = false;
    $('claim-cancel').disabled = false;
    $('claim-dialog').showModal();
  }

  function updateReward(reward) {
    if (!reward || !reward.id) throw new ApiError('L’opération n’a pas pu être confirmée. Actualisez la fiche avant d’appliquer un rabais.');
    state.selected = reward;
    const index = state.rewards.findIndex((item) => item.id === reward.id);
    if (index >= 0) state.rewards[index] = reward;
    renderRewards();
    renderDetail();
  }

  async function refreshSelected(reward) {
    if (!state.employee || !reward) return;
    const session = state.session;
    try {
      const data = await api('/rewards?code=' + encodeURIComponent(reward.code));
      if (session !== state.session || !state.employee) return;
      const current = Array.isArray(data.rewards) && data.rewards.find((item) => item.id === reward.id);
      if (current && state.selected && state.selected.id === reward.id) { updateReward(current); await loadAudit(); }
    } catch (_) { /* Existing action errors explain that a fresh server check is required. */ }
  }

  async function confirmClaim(event) {
    event.preventDefault();
    const reward = state.selected;
    if (state.busy || !reward || reward.status !== 'pending') return;
    const session = state.session;
    state.busy = true;
    $('claim-confirm').disabled = true;
    $('claim-cancel').disabled = true;
    $('claim-confirm').textContent = 'Validation en cours…';
    $('claim-dialog-error').hidden = true;
    try {
      const data = await api('/rewards/' + encodeURIComponent(reward.id) + '/claim', { method: 'POST', body: '{}' });
      if (session !== state.session || !state.employee) return;
      const updated = data.reward || data;
      if (updated.status !== 'claimed' || !ownClaim(updated)) throw new ApiError('La prise en charge à votre nom n’a pas été confirmée. Actualisez la fiche avant d’appliquer le rabais.');
      if (updated.id !== reward.id) throw new ApiError('La confirmation ne correspond pas au code choisi. Actualisez la fiche avant d’appliquer le rabais.');
      updateReward(updated);
      document.dispatchEvent(new Event('boreal:admin-data-changed'));
      $('claim-dialog').close();
      showNotice('Code pris en charge à votre nom. Appliquez manuellement le rabais sur la facture, puis confirmez son application.');
      await Promise.allSettled([loadBudget(), loadAudit(), loadRewards()]);
    } catch (error) {
      if (session !== state.session) return;
      if (error.status === 409) {
        $('claim-dialog').close();
        showNotice('Ce code a changé de statut ou a déjà été utilisé. La fiche est actualisée. N’appliquez aucun rabais avant de vérifier son statut.', true);
        await Promise.allSettled([loadRewards(), refreshSelected(reward), loadBudget()]);
      } else {
        $('claim-dialog-error').textContent = error.message;
        $('claim-dialog-error').hidden = false;
      }
    } finally {
      state.busy = false;
      $('claim-confirm').disabled = false;
      $('claim-cancel').disabled = false;
      $('claim-confirm').textContent = 'Confirmer la prise en charge';
      if (state.selected) renderAction();
    }
  }

  function moneyInput(value){const s=String(value).trim();return /^(?:0|[1-9]\d*)(?:[,.]\d{1,2})?$/.test(s)?Math.round(Number(s.replace(',','.'))*100):NaN;}
  async function confirmUse(event) {
    event.preventDefault();
    const reward = state.selected;
    const form = event.currentTarget;
    if (state.busy || !reward || reward.status !== 'claimed' || !ownClaim(reward) || !form.reportValidity()) return;
    const eligibleFoodCents=moneyInput($('eligible-food-amount').value);if(!Number.isSafeInteger(eligibleFoodCents)||eligibleFoodCents<=0){$('use-error').textContent='Saisissez une portion alimentaire admissible positive.';$('use-error').hidden=false;return;}
    const session = state.session;
    state.busy = true;
    for (const control of form.elements) control.disabled = true;
    $('use-confirm').textContent = 'Enregistrement en cours…';
    $('use-error').hidden = true;
    try {
      const data = await api('/rewards/' + encodeURIComponent(reward.id) + '/use', { method: 'POST', body: JSON.stringify({ discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents }) });
      if (session !== state.session || !state.employee) return;
      const updated = data.reward || data;
      if (updated.status !== 'issued' || (updated.discountApplied !== true || updated.foodOnlyConfirmed !== true || updated.appliedValueCents !== Math.min(reward.valueCents,eligibleFoodCents)) || updated.issuedBy !== subject()) throw new ApiError('L’application du rabais n’a pas été confirmée. Vérifiez le statut avant toute nouvelle action.');
      if (updated.id !== reward.id) throw new ApiError('La confirmation ne correspond pas au code choisi. Actualisez la fiche avant toute nouvelle action.');
      updateReward(updated);
      document.dispatchEvent(new Event('boreal:admin-data-changed'));
      showNotice('L’application du rabais sur la facture est enregistrée. Ce code ne peut plus être utilisé.');
      await Promise.allSettled([loadBudget(), loadAudit(), loadRewards()]);
    } catch (error) {
      if (session !== state.session) return;
      if (error.status === 409) {
        showNotice('La fiche a changé de statut. Elle est actualisée. Vérifiez le rabais déjà appliqué et ne l’appliquez pas une deuxième fois.', true);
        await Promise.allSettled([loadRewards(), refreshSelected(reward), loadBudget()]);
      } else if ($('use-error')) {
        $('use-error').textContent = error.message + ' Le rabais a peut-être déjà été enregistré : vérifiez la facture et ne l’appliquez pas une deuxième fois.';
        $('use-error').hidden = false;
      }
    } finally {
      state.busy = false;
      if (session === state.session && $('use-form')) {
        for (const control of $('use-form').elements) control.disabled = false;
        $('use-confirm').textContent = '3. Confirmer le rabais appliqué';
      }
    }
  }

  document.addEventListener('boreal:admin-changed',()=>{loadRewards();loadBudget();});
  async function exportCsv() {
    const button = $('export-button');
    button.disabled = true;
    const session = state.session;
    let objectUrl;
    try {
      const query = new URLSearchParams();
      const search = $('code-search').value.trim();
      if (search) query.set('search', search);
      if ($('status-filter').value) query.set('status', $('status-filter').value);
      const response = await fetch('/api/admin/export' + (query.size ? '?' + query.toString() : ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/csv' } });
      if (response.status === 401 || response.status === 403) { showAccess(response.status); return; }
      if (!response.ok) {
        let message = serviceError(response.status);
        try { const data = await response.json(); message = serviceError(response.status, data.error); } catch (_) {}
        throw new ApiError(message);
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/csv')) throw new ApiError('Le fichier n’a pas pu être préparé. Vérifiez votre connexion.');
      const blob = await response.blob();
      if (session !== state.session || !state.employee) return;
      objectUrl = URL.createObjectURL(blob);
      const link = node('a'); link.href = objectUrl; link.download = 'recompenses-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.append(link); link.click(); link.remove();
      showNotice('Export préparé. Le fichier contient des données clients : conservez-le uniquement dans un espace de travail autorisé.');
    } catch (error) {
      if (session === state.session) showNotice(error.message || 'L’export a échoué. Vérifiez votre connexion et réessayez.', true);
    } finally {
      button.disabled = false;
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  }

  document.addEventListener('boreal:admin-session-request', () => document.dispatchEvent(new CustomEvent('boreal:admin-session', { detail: { employee: state.employee, session: state.session } })));
  document.addEventListener('boreal:admin-expired', event => showAccess(event.detail?.status === 403 ? 403 : 401));
  $('access-retry').addEventListener('click', boot);
  $('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.busy) {
      clearNotice();
      state.selected = null; state.auditRequest += 1; renderDetail();
      if ($('code-search').value.trim()) $('status-filter').value = '';
      loadRewards();
    }
  });
  $('status-filter').addEventListener('change', () => {
    if (!state.busy) {
      $('code-search').value = '';
      state.selected = null; state.auditRequest += 1; renderDetail();
      loadRewards();
    }
  });
  $('refresh-button').addEventListener('click', () => { if (!state.busy) { clearNotice(); const selected = state.selected; document.dispatchEvent(new Event('boreal:admin-data-changed')); Promise.allSettled([loadRewards(), loadBudget(), refreshSelected(selected)]); } });
  $('load-more').addEventListener('click', () => loadRewards(true));
  $('export-button').addEventListener('click', exportCsv);
  $('close-detail').addEventListener('click', () => { if (!state.busy) { state.selected = null; state.auditRequest += 1; renderRewards(); renderDetail(); } });
  $('claim-form').addEventListener('submit', confirmClaim);
  $('claim-cancel').addEventListener('click', () => { if (!state.busy) $('claim-dialog').close(); });
  $('claim-dialog').addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
  $('budget-edit-form').addEventListener('submit', reviewBudget);
  $('budget-confirm-form').addEventListener('submit', saveBudget);
  $('budget-retry').addEventListener('click', saveBudget);
  $('budget-cancel').addEventListener('click', () => { if (!state.budgetBusy) { state.budgetDraft = null; $('budget-dialog').close(); } });
  $('budget-dialog').addEventListener('cancel', (event) => { if (state.budgetBusy) event.preventDefault(); else state.budgetDraft = null; });
  document.querySelectorAll('[data-budget-preset]').forEach((button) => button.addEventListener('click', () => { $('budget-amount').value = button.dataset.budgetPreset; $('budget-amount').setCustomValidity(''); }));
  $('budget-amount').addEventListener('input', () => $('budget-amount').setCustomValidity(''));
  document.querySelectorAll('input[name="budget-scope"]').forEach((input) => input.addEventListener('change', () => $('budget-amount').setCustomValidity('')));
  // Customer information stays in memory only; the server controls every state change.
  window.addEventListener('pagehide', () => {
    state.session += 1;
    state.employee = null; state.selected = null; state.rewards = [];
    document.dispatchEvent(new CustomEvent('boreal:admin-session', { detail: { employee: null, session: state.session } }));
    state.budget = null; state.budgetDraft = null; state.budgetOperation = null; state.budgetRequest += 1;
    $('budget-editor').hidden = true;
    if ($('budget-dialog').open) $('budget-dialog').close();
    $('reward-list').replaceChildren(); $('audit-list').replaceChildren();
    $('detail-name').textContent = ''; $('detail-code').textContent = ''; $('detail-value').textContent = '';
    $('detail-facts').replaceChildren(); $('detail-action').replaceChildren();
    $('code-search').value = ''; $('employee-name').textContent = ''; $('claim-summary').textContent = '';
    $('admin-content').hidden = true;
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) boot(); });
  boot();
})();
