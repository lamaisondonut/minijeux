'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const dateTime = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const dateOnly = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' });
  const labels = { pending: 'À utiliser', claimed: 'En cours de remise', issued: 'Carte remise', expired: 'Code expiré', cancelled: 'Annulé' };
  const state = { employee: null, rewards: [], selected: null, cursor: null, listRequest: 0, auditRequest: 0, session: 0, busy: false, listBusy: false };

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
  function badge(status) { return node('span', 'status-badge status-' + (Object.hasOwn(labels, status) ? status : 'unknown'), labels[status] || 'Statut à vérifier'); }
  function showNotice(message, error = false) {
    $('notification').textContent = message;
    $('notification').classList.toggle('error', error);
    $('notification').hidden = false;
  }
  function clearNotice() { $('notification').hidden = true; $('notification').textContent = ''; }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch('/api/admin' + path, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'follow',
        ...options,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
      });
    } catch (_) {
      throw new ApiError('Connexion au serveur interrompue. Actualisez le registre pour vérifier le statut avant toute remise.');
    }
    if (response.status === 401 || response.status === 403) {
      showAccess(response.status);
      throw new ApiError('Votre accès doit être vérifié.', response.status);
    }
    let data;
    try { data = await response.json(); }
    catch (_) { throw new ApiError('La réponse du serveur est illisible. Réessayez après avoir vérifié votre connexion.', response.status); }
    if (!response.ok) throw new ApiError(typeof data.message === 'string' ? data.message : 'Le serveur ne peut pas traiter cette demande. Réessayez.', response.status, data.error);
    return data;
  }

  function showAccess(status, message) {
    state.session += 1;
    state.employee = null;
    state.rewards = [];
    state.selected = null;
    state.cursor = null;
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
      $('access-message').textContent = 'Votre session est absente ou a expiré. La connexion sécurisée Cloudflare Access utilise votre compte individuel.';
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
      $('access-title').textContent = 'Connexion momentanément indisponible';
      $('access-message').textContent = message || 'Le serveur ne répond pas. Aucune récompense ne peut être traitée pour le moment.';
    }
  }

  async function boot() {
    const session = ++state.session;
    $('access-title').textContent = 'Vérification de votre accès…';
    $('access-message').textContent = 'Veuillez patienter pendant la connexion à votre compte individuel.';
    $('access-login').hidden = true;
    $('access-retry').hidden = true;
    $('access-identity').hidden = true;
    try {
      const data = await api('/me');
      if (session !== state.session) return;
      if (!data.employee || !(data.employee.sub || data.employee.subject)) throw new ApiError('Le compte employé reçu est incomplet. Contactez votre responsable.');
      state.employee = data.employee;
      $('employee-name').textContent = data.employee.name || data.employee.email || 'Compte employé';
      $('access-panel').hidden = true;
      $('admin-content').hidden = false;
      clearNotice();
      await Promise.allSettled([loadRewards(), loadBudget()]);
    } catch (error) { if (error.status !== 401 && error.status !== 403) showAccess(0, error.message); }
  }

  async function loadBudget() {
    const session = state.session;
    $('budget-values').setAttribute('aria-busy', 'true');
    $('budget-error').hidden = true;
    try {
      const data = await api('/budget');
      if (session !== state.session || !state.employee) return;
      $('budget-remaining').textContent = amount(data.remainingCents);
      $('budget-used').textContent = amount(data.usedCents);
      $('budget-reserved').textContent = amount(data.reservedCents);
      $('budget-pending').textContent = Number.isSafeInteger(data.pendingCount) ? String(data.pendingCount) : '—';
      if (typeof data.month === 'string' && /^\d{4}-\d{2}$/.test(data.month)) {
        const month = new Date(data.month + '-15T12:00:00Z');
        $('budget-month').textContent = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
      } else $('budget-month').textContent = 'Mois en cours';
    } catch (error) {
      if (session !== state.session) return;
      for (const id of ['budget-remaining', 'budget-used', 'budget-reserved', 'budget-pending']) $(id).textContent = '—';
      $('budget-month').textContent = 'Données indisponibles';
      $('budget-error').textContent = 'Le budget n’a pas pu être chargé. Utilisez « Actualiser » pour réessayer.';
      $('budget-error').hidden = false;
    } finally { if (session === state.session) $('budget-values').setAttribute('aria-busy', 'false'); }
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
    const code = $('code-search').value.trim();
    const status = $('status-filter').value;
    if (code) query.set('code', code);
    if (status) query.set('status', status);
    if (append && state.cursor) query.set('cursor', state.cursor);
    setListBusy(true);
    if (!append) {
      $('reward-list').replaceChildren();
      $('result-count').textContent = 'Chargement des récompenses…';
      listState('Chargement du registre', 'Les données sont récupérées auprès du serveur.');
    }
    $('load-more').hidden = true;
    try {
      const data = await api('/rewards' + (query.size ? '?' + query.toString() : ''));
      if (request !== state.listRequest || session !== state.session || !state.employee) return;
      if (!Array.isArray(data.rewards)) throw new ApiError('Le registre reçu est incomplet. Réessayez.');
      state.rewards = append ? [...state.rewards, ...data.rewards.filter((reward) => !state.rewards.some((item) => item.id === reward.id))] : data.rewards;
      state.cursor = data.nextCursor || null;
      renderRewards();
      if (state.selected) {
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
      row.append(customer, node('span', 'row-value', amount(reward.valueCents)), badge(reward.status));
      row.addEventListener('click', () => {
        if (state.busy) return;
        state.selected = reward;
        clearNotice();
        renderRewards();
        renderDetail();
        loadAudit();
        if (matchMedia('(max-width: 850px)').matches) $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      list.append(row);
    }
    $('result-count').textContent = state.rewards.length + (state.rewards.length > 1 ? ' récompenses affichées' : ' récompense affichée');
    $('list-state').hidden = state.rewards.length > 0;
    if (!state.rewards.length) listState('Aucune récompense trouvée', 'Vérifiez le code saisi ou essayez un autre statut.');
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
    const statusBadge = badge(reward.status);
    statusBadge.id = 'detail-status';
    $('detail-status').replaceWith(statusBadge);
    $('detail-name').textContent = name(reward);
    $('detail-code').textContent = reward.code || 'Code indisponible';
    $('detail-value').textContent = amount(reward.valueCents);
    $('detail-facts').replaceChildren();
    fact('Participation confirmée', date(reward.confirmedAt));
    if (reward.score !== undefined) fact('Score', Number.isSafeInteger(reward.score) ? reward.score.toLocaleString('fr-CA') : 'Non renseigné');
    fact('Code utilisable jusqu’au', date(claimDeadline(reward)));
    if (reward.claimedAt) fact('Code utilisé le', date(reward.claimedAt));
    if (reward.claimedBy) fact('Employé responsable', ownClaim(reward) ? state.employee.name || state.employee.email : reward.claimedByName || reward.claimedBy);
    if (reward.issuedAt) fact('Carte remise le', date(reward.issuedAt));
    if (reward.lightspeedRef) fact('Référence Lightspeed', reward.lightspeedRef);
    renderAction();
  }

  function renderAction() {
    const reward = state.selected;
    const container = $('detail-action');
    container.replaceChildren();
    if (!reward) return;
    const block = node('div', 'action-block');
    if (reward.status === 'pending') {
      block.append(node('h3', '', '1. Valider l’utilisation du code'), node('p', '', 'Vérifiez le montant avec le client. La carte doit être créée dans Lightspeed après la confirmation du serveur.'));
      const button = node('button', 'button primary', 'Marquer comme utilisé');
      button.id = 'claim-button'; button.type = 'button'; button.disabled = state.busy;
      button.addEventListener('click', openClaimDialog);
      block.append(button);
    } else if (reward.status === 'claimed' && ownClaim(reward)) {
      block.append(node('h3', '', '2. Créer et remettre la carte'), node('p', '', 'Ce code est verrouillé à votre nom. Vérifiez d’abord si une carte a déjà été créée, puis créez manuellement une seule carte dans Lightspeed au montant indiqué.'));
      const form = node('form'); form.id = 'issue-form';
      const field = node('div', 'field');
      const label = node('label', '', 'Référence de la carte Lightspeed'); label.htmlFor = 'lightspeed-ref';
      const input = node('input'); input.type = 'text'; input.id = 'lightspeed-ref'; input.name = 'lightspeedRef'; input.required = true; input.maxLength = 120; input.autocomplete = 'off'; input.disabled = state.busy;
      field.append(label, input);
      const checkLabel = node('label', 'checkbox-label');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'handover-confirm'; checkbox.required = true; checkbox.disabled = state.busy;
      checkLabel.append(checkbox, node('span', '', 'J’ai remis au client une seule carte-cadeau du montant de ' + amount(reward.valueCents) + '.'));
      const error = node('p', 'inline-error'); error.id = 'issue-error'; error.hidden = true; error.setAttribute('role', 'alert');
      const submit = node('button', 'button primary', '3. Confirmer la carte remise'); submit.type = 'submit'; submit.id = 'issue-confirm'; submit.disabled = state.busy;
      form.append(field, checkLabel, error, submit);
      form.addEventListener('submit', confirmIssue);
      block.append(form);
    } else if (reward.status === 'claimed') {
      block.append(node('h3', '', 'Remise déjà prise en charge'), node('p', '', 'Ce code est verrouillé par un autre employé. Ne créez pas de carte supplémentaire. L’employé qui a utilisé le code doit terminer la remise avec son compte.'));
    } else if (reward.status === 'issued') {
      block.append(node('h3', '', 'Carte remise et enregistrée'), node('p', '', 'Cette récompense a déjà été utilisée. Aucune autre carte ne doit être créée pour ce code.'));
    } else if (reward.status === 'expired') {
      block.append(node('h3', '', 'La date limite du code est dépassée'), node('p', '', 'Cette récompense ne peut plus être utilisée. Cette date limite concerne le code, et non une carte-cadeau.'));
    } else if (reward.status === 'cancelled') {
      block.append(node('h3', '', 'Récompense annulée'), node('p', '', reward.cancelReason || 'Cette récompense ne peut pas être utilisée.'));
    } else {
      block.append(node('h3', '', 'Vérification nécessaire'), node('p', '', 'Le statut reçu ne permet pas de traiter cette récompense. Actualisez le registre et contactez votre responsable.'));
    }
    container.append(block);
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
      const actionLabels = { claimed: 'Code marqué comme utilisé', claim: 'Code marqué comme utilisé', reward_claimed: 'Code marqué comme utilisé', issued: 'Carte remise', issue: 'Carte remise', reward_issued: 'Carte remise', confirmed: 'Participation confirmée', reward_confirmed: 'Participation confirmée', cancelled: 'Récompense annulée', cancel: 'Récompense annulée', reward_cancelled: 'Récompense annulée' };
      for (const event of events) {
        const item = node('li');
        item.append(node('span', 'audit-action', actionLabels[event.action] || 'Mise à jour de la récompense'), node('span', 'audit-meta', [date(event.createdAt), event.actorName || event.actor || event.actorSub].filter(Boolean).join(' · ')));
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
    if (!reward || !reward.id) throw new ApiError('Confirmation serveur incomplète. Actualisez la fiche avant toute remise.');
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
      if (updated.status !== 'claimed' || !ownClaim(updated)) throw new ApiError('Le serveur n’a pas confirmé le verrouillage à votre nom. Actualisez la fiche avant toute remise.');
      if (updated.id !== reward.id) throw new ApiError('La confirmation ne correspond pas au code choisi. Actualisez la fiche avant toute remise.');
      updateReward(updated);
      $('claim-dialog').close();
      showNotice('Code marqué comme utilisé à votre nom. Vous pouvez maintenant créer la carte dans Lightspeed, puis confirmer sa remise.');
      await Promise.allSettled([loadBudget(), loadAudit(), loadRewards()]);
    } catch (error) {
      if (session !== state.session) return;
      if (error.status === 409) {
        $('claim-dialog').close();
        showNotice('Ce code a changé de statut ou a déjà été utilisé. La fiche est actualisée. Ne créez aucune carte avant de vérifier son statut.', true);
        await Promise.allSettled([loadRewards(), refreshSelected(reward), loadBudget()]);
      } else {
        $('claim-dialog-error').textContent = error.message;
        $('claim-dialog-error').hidden = false;
      }
    } finally {
      state.busy = false;
      $('claim-confirm').disabled = false;
      $('claim-cancel').disabled = false;
      $('claim-confirm').textContent = 'Confirmer l’utilisation';
      if (state.selected) renderAction();
    }
  }

  async function confirmIssue(event) {
    event.preventDefault();
    const reward = state.selected;
    const form = event.currentTarget;
    if (state.busy || !reward || reward.status !== 'claimed' || !ownClaim(reward) || !form.reportValidity()) return;
    const reference = $('lightspeed-ref').value.trim();
    if (!reference) { $('lightspeed-ref').setCustomValidity('Saisissez une référence Lightspeed.'); $('lightspeed-ref').reportValidity(); return; }
    const session = state.session;
    state.busy = true;
    for (const control of form.elements) control.disabled = true;
    $('issue-confirm').textContent = 'Enregistrement en cours…';
    $('issue-error').hidden = true;
    try {
      const data = await api('/rewards/' + encodeURIComponent(reward.id) + '/issue', { method: 'POST', body: JSON.stringify({ lightspeedRef: reference }) });
      if (session !== state.session || !state.employee) return;
      const updated = data.reward || data;
      if (updated.status !== 'issued') throw new ApiError('Le serveur n’a pas confirmé l’enregistrement. Vérifiez le statut avant toute nouvelle action.');
      if (updated.id !== reward.id) throw new ApiError('La confirmation ne correspond pas au code choisi. Actualisez la fiche avant toute nouvelle action.');
      updateReward(updated);
      showNotice('La remise de la carte-cadeau est enregistrée. Ce code ne peut plus être utilisé.');
      await Promise.allSettled([loadBudget(), loadAudit(), loadRewards()]);
    } catch (error) {
      if (session !== state.session) return;
      if (error.status === 409) {
        showNotice('La fiche a changé de statut. Elle est actualisée. Ne créez aucune carte supplémentaire ; vérifiez la remise déjà effectuée.', true);
        await Promise.allSettled([loadRewards(), refreshSelected(reward), loadBudget()]);
      } else if ($('issue-error')) {
        $('issue-error').textContent = error.message + ' La carte a peut-être déjà été remise : vérifiez Lightspeed et ne créez pas de nouvelle carte.';
        $('issue-error').hidden = false;
      }
    } finally {
      state.busy = false;
      if (session === state.session && $('issue-form')) {
        for (const control of $('issue-form').elements) control.disabled = false;
        $('issue-confirm').textContent = '3. Confirmer la carte remise';
      }
    }
  }

  async function exportCsv() {
    const button = $('export-button');
    button.disabled = true;
    const session = state.session;
    let objectUrl;
    try {
      const query = new URLSearchParams();
      const code = $('code-search').value.trim();
      if (code) query.set('code', code);
      if ($('status-filter').value) query.set('status', $('status-filter').value);
      const response = await fetch('/api/admin/export' + (query.size ? '?' + query.toString() : ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/csv' } });
      if (response.status === 401 || response.status === 403) { showAccess(response.status); return; }
      if (!response.ok) {
        let message = 'L’export n’a pas pu être préparé. Réessayez.';
        try { const data = await response.json(); if (typeof data.message === 'string') message = data.message; } catch (_) {}
        throw new ApiError(message);
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/csv')) throw new ApiError('Le serveur n’a pas renvoyé de fichier CSV. Vérifiez votre session.');
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

  $('access-retry').addEventListener('click', boot);
  $('search-form').addEventListener('submit', (event) => { event.preventDefault(); if (!state.busy) { clearNotice(); loadRewards(); } });
  $('status-filter').addEventListener('change', () => { if (!state.busy) loadRewards(); });
  $('refresh-button').addEventListener('click', () => { if (!state.busy) { clearNotice(); const selected = state.selected; Promise.allSettled([loadRewards(), loadBudget(), refreshSelected(selected)]); } });
  $('load-more').addEventListener('click', () => loadRewards(true));
  $('export-button').addEventListener('click', exportCsv);
  $('close-detail').addEventListener('click', () => { if (!state.busy) { state.selected = null; state.auditRequest += 1; renderRewards(); renderDetail(); } });
  $('claim-form').addEventListener('submit', confirmClaim);
  $('claim-cancel').addEventListener('click', () => { if (!state.busy) $('claim-dialog').close(); });
  $('claim-dialog').addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
  document.addEventListener('input', (event) => { if (event.target.id === 'lightspeed-ref') event.target.setCustomValidity(''); });
  // Customer information stays in memory only; the server controls every state change.
  window.addEventListener('pagehide', () => {
    state.session += 1;
    state.employee = null; state.selected = null; state.rewards = [];
    $('reward-list').replaceChildren(); $('audit-list').replaceChildren();
    $('detail-name').textContent = ''; $('detail-code').textContent = ''; $('detail-value').textContent = '';
    $('detail-facts').replaceChildren(); $('detail-action').replaceChildren();
    $('code-search').value = ''; $('employee-name').textContent = ''; $('claim-summary').textContent = '';
    $('admin-content').hidden = true;
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) boot(); });
  boot();
})();
