/* Browser fixtures below are isolated test data. Production has no mock API. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'v3');
const artifacts = '/tmp/admin-rewards-artifacts';
const employeeA = { sub: 'employee-a', subject: 'employee-a', name: 'Ariane Test', email: 'ariane@example.test', role: 'staff' };
const employeeB = { sub: 'employee-b', subject: 'employee-b', name: 'Benoît Test', email: 'benoit@example.test', role: 'manager' };
const fixture = (overrides = {}) => ({ id: 'reward-test-1', code: 'NOEL-TEST-0001', firstName: 'Camille', lastName: 'Essai', score: 7500, valueCents: 1000, status: 'pending', confirmedAt: '2026-11-14T12:00:00Z', claimBy: '2026-12-14T12:00:00Z', claimedAt: null, claimedBy: null, issuedAt: null, issuedBy: null, discountApplied: false, phone:'+15145551234',phoneVerified:false, ...overrides });
const budget = { month: '2026-11', budgetCents: 10000, usedCents: 1000, reservedCents: 1000, remainingCents: 8000, pendingCount: 1, usedCount: 2, countScope: 'all', defaultBudgetCents: 10000, revision: 0, defaultRevision: 0, minimumBudgetCents: 2000, minimumFutureBudgetCents: 2000, updatedAt: null, updatedBy: null, updatedByName: null };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function serve() {
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';
      const file = path.join(root, pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const data = await fs.readFile(file);
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(data);
    } catch (_) { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}

async function mockApi(page, options = {}) {
  const employee = options.employee || employeeA;
  const record = options.record || { reward: fixture(), claims: 0, uses: 0 };
  const send = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.slice('/api/admin'.length);
    if (options.intercept && await options.intercept({ route, request, url, endpoint, send, record, employee })) return;
    if (endpoint === '/me') return send(route, options.meStatus || 200, options.meStatus ? { error: 'test', message: 'Accès indisponible pour ce test.' } : { employee,previewTestRedemption:options.previewTestRedemption===true,phoneVerificationMode:options.phoneVerificationMode||'unverified',notificationSmsEnabled:options.notificationSmsEnabled===true });
    if (endpoint === '/identity') return send(route, 200, { sub: employee.sub, email: employee.email });
    if (endpoint === '/budget') return send(route, 200, options.budgetRecord?.value || options.budget || budget);
    if (endpoint === '/rewards') {
      let rows = options.rows || [record.reward];
      const code = url.searchParams.get('code');
      const search=url.searchParams.get('search');
      const status = url.searchParams.get('status');
      if(search){const fold=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');const digits=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===10?'1'+d:d;};rows=rows.filter(row=>row.code.toUpperCase()===search.toUpperCase()||fold([row.firstName,row.lastName].join(' ')).includes(fold(search))||(digits(search).length>=10&&digits(row.phone)===digits(search)));}
      if (code) rows = rows.filter((row) => row.code === code);
      if (status) rows = rows.filter((row) => row.status === status);
      return send(route, 200, { rewards: rows, nextCursor: null });
    }
    if (endpoint === '/audit') return send(route, 200, { audit: options.audit || [] });
    if (endpoint === '/export') return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: 'code,statut\nNOEL-TEST-0001,pending\n' });
    if (endpoint.endsWith('/claim') && request.method() === 'POST') {
      record.claims += 1;
      if (record.reward.status !== 'pending') return send(route, 409, { error: 'already_used', message: 'Ce code est déjà utilisé.' });
      record.reward = { ...record.reward, status: 'claimed', claimedBy: employee.sub, claimedAt: '2026-11-14T14:00:00Z', claimedByName: employee.name };
      const snapshot = { ...record.reward };
      if (options.claimGate) await options.claimGate.promise;
      return send(route, 200, { reward: snapshot });
    }
    if (endpoint.endsWith('/use') && request.method() === 'POST') {
      record.uses += 1;
      if (record.reward.status !== 'claimed' || record.reward.claimedBy !== employee.sub) return send(route, 409, { error: 'claim_owner', message: 'Seul l’employé responsable peut terminer.' });
      const body = request.postDataJSON();
      assert.deepEqual(body, { discountApplied: true,foodOnlyConfirmed:true,eligibleFoodCents:1000 });
      record.reward = { ...record.reward, status: 'issued', issuedBy: employee.sub, issuedAt: '2026-11-14T14:05:00Z', discountApplied: true, foodOnlyConfirmed:true,eligibleFoodCents:1000,appliedValueCents:Math.min(record.reward.valueCents,1000),unusedCents:Math.max(0,record.reward.valueCents-1000), issuedByName: employee.name };
      if (options.useGate) await options.useGate.promise;
      return send(route, 200, { reward: record.reward });
    }
    return send(route, 404, { error: 'test_route', message: 'Route de test non reconnue.' });
  });
  return record;
}

async function openReward(page, origin) {
  await page.goto(origin + '/admin/');
  await page.locator('.reward-row').first().click();
  await page.locator('#detail-content').waitFor({ state: 'visible' });
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const { server, origin } = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let checks = 0;
  async function test(label, work) { await work(); checks += 1; process.stdout.write('✓ ' + label + '\n'); }
  try {
    await test('responsive render, official assets, no horizontal overflow or browser errors', async () => {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        const errors = []; page.on('pageerror', (error) => errors.push(error.message));
        await mockApi(page);
        await openReward(page, origin);
        await page.locator('#budget-remaining').filter({ hasText: '80,00' }).waitFor();
        assert.match(await page.locator('#budget-total').innerText(), /100,00/);
        assert.match(await page.locator('#budget-used').innerText(), /10,00/);
        assert.equal(await page.locator('#budget-pending').innerText(), '1');
        assert.equal(await page.locator('#budget-used-count').innerText(), '2');
        assert.match(await page.locator('#budget-reserved').innerText(), /10,00.*parties en cours/);
        assert.equal(await page.locator('#registry-title').innerText(), 'Derniers gagnants');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page overflows at ' + viewport.width);
        assert.equal(await page.locator('.brand img').evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)), true, 'official logos did not load');
        await page.screenshot({ path: path.join(artifacts, 'admin-' + viewport.width + '.png'), fullPage: true });
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
        await page.close();
      }
    });

    await test('exact code search opens the result, identifies used or expired codes, and clears stale actions', async () => {
      for (const status of ['pending', 'claimed', 'issued', 'expired']) {
        const page = await browser.newPage();
        await mockApi(page, { record: { reward: fixture({ status, claimedBy: status === 'claimed' ? employeeB.sub : null }), claims: 0, uses: 0 } });
        await page.goto(origin + '/admin/');
        await page.locator('#status-filter').selectOption('cancelled');
        await page.locator('#list-state').filter({ hasText: 'Aucune récompense trouvée' }).waitFor();
        await page.locator('#code-search').fill('noel-test-0001');
        await page.locator('#search-form button').click();
        await page.locator('#detail-content').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#status-filter').inputValue(), '');
        assert.equal(await page.locator('#detail-code').innerText(), 'NOEL-TEST-0001');
        assert.match(await page.locator('#detail-facts').innerText(), /Date d’attribution/);
        if (status === 'pending') assert.equal(await page.locator('#claim-button').innerText(), 'PRENDRE EN CHARGE');
        else {
          assert.equal(await page.locator('#detail-validation').innerText(), status === 'expired' ? 'CODE EXPIRÉ' : status === 'claimed' ? 'CODE PRIS EN CHARGE' : 'CODE DÉJÀ UTILISÉ');
          assert.equal(await page.locator('#claim-button').count(), 0);
          assert.equal(await page.locator('#use-form').count(), 0);
        }
        await page.locator('#code-search').fill('NOT-A-CODE');
        await page.locator('#search-form button').click();
        await page.locator('#list-state h3').filter({ hasText: 'AUCUN RÉSULTAT' }).waitFor();
        assert.equal(await page.locator('#detail-content').isVisible(), false, 'previous code stayed actionable after failed search');
        await page.close();
      }
    });

    await test('empty real registry shows zeros and no invented winners', async () => {
      const page = await browser.newPage();
      await mockApi(page, { rows: [], budget: { ...budget, usedCents: 0, reservedCents: 0, remainingCents: 10000, pendingCount: 0, usedCount: 0, minimumBudgetCents: 0, minimumFutureBudgetCents: 0 } });
      await page.goto(origin + '/admin/');
      await page.locator('#budget-remaining').filter({ hasText: '100,00' }).waitFor();
      assert.equal(await page.locator('#budget-pending').innerText(), '0');
      assert.equal(await page.locator('#budget-used-count').innerText(), '0');
      assert.equal(await page.locator('#budget-reserved').isVisible(), false);
      assert.equal(await page.locator('.reward-row').count(), 0);
      await page.locator('#list-state').filter({ hasText: 'Aucun gagnant à afficher pour le moment.' }).waitFor();
      await page.close();
    });

    await test('claim server success precedes discount confirmation; concurrent employee receives 409; one completed discount', async () => {
      const record = { reward: fixture(), claims: 0, uses: 0 };
      const claimGate = deferred(); const useGate = deferred();
      const pageA = await browser.newPage(); const pageB = await browser.newPage();
      await mockApi(pageA, { record, claimGate, useGate });
      await mockApi(pageB, { record, employee: employeeB });
      await openReward(pageA, origin); await openReward(pageB, origin);
      await pageA.locator('#claim-button').click();
      assert.match(await pageA.locator('#claim-summary').innerText(), /Ariane Test/);
      assert.match(await pageA.locator('#claim-summary').innerText(), /10,00/);
      await pageA.locator('#claim-confirm').click();
      await pageA.waitForFunction(() => document.getElementById('claim-confirm').disabled);
      assert.equal(await pageA.locator('#use-form').count(), 0, 'issue form shown before claim server success');
      assert.equal(await pageA.locator('#notification').isVisible(), false);
      await pageA.keyboard.press('Escape');
      assert.equal(await pageA.locator('#claim-dialog').evaluate((dialog) => dialog.open), true, 'in-flight dialog escaped');
      await pageB.locator('#claim-button').click(); await pageB.locator('#claim-confirm').click();
      await pageB.locator('#notification.error').waitFor();
      await pageB.locator('#detail-action').filter({ hasText: 'Code déjà pris en charge' }).waitFor();
      assert.equal(await pageB.locator('#use-form').count(), 0, 'another employee can issue');
      assert.equal(await pageB.locator('#claim-button').count(), 0);
      claimGate.resolve();
      await pageA.locator('#use-confirm').waitFor({ state: 'visible' });
      await pageA.waitForFunction(() => !document.getElementById('use-confirm').disabled);
      await pageA.locator('#use-confirm').click();
      assert.equal(record.uses, 0, 'blank issue confirmation accepted');
      assert.equal(await pageA.locator('#lightspeed-ref').count(), 0);
      await pageA.locator('#eligible-food-amount').fill('10');await pageA.locator('#food-only-confirm').check();await pageA.locator('#discount-confirm').check();
      await pageA.locator('#use-confirm').click();
      await pageA.waitForFunction(() => document.getElementById('use-confirm').disabled);
      assert.doesNotMatch(await pageA.locator('#notification').innerText(), /rabais.*enregistrée/);
      useGate.resolve();
      await pageA.locator('#detail-action').filter({ hasText: 'Rabais appliqué et enregistré' }).waitFor();
      assert.equal(record.claims, 2); assert.equal(record.uses, 1); assert.equal(record.reward.status, 'issued');
      assert.equal(record.reward.claimedBy, employeeA.sub); assert.equal(record.reward.issuedBy, employeeA.sub);
      assert.equal(await pageA.locator('#claim-button').count(), 0); assert.equal(await pageA.locator('#use-form').count(), 0);
      await pageB.locator('#refresh-button').click();
      await pageB.locator('#detail-status').filter({ hasText: 'Utilisé · rabais appliqué' }).waitFor();
      await pageA.close(); await pageB.close();
    });

    await test('401 and 403 isolate the registry; denied account identifiers render safely', async () => {
      for (const status of [401, 403]) {
        const page = await browser.newPage(); await mockApi(page, { meStatus: status });
        await page.goto(origin + '/admin/');
        await page.locator('#access-title').filter({ hasText: status === 401 ? 'Connectez-vous' : 'Accès employé requis' }).waitFor();
        assert.equal(await page.locator('#admin-content').isVisible(), false);
        assert.equal(await page.locator('#reward-list').innerText(), '');
        assert.equal(await page.locator('#access-login').getAttribute('href'), '/admin/');
        assert.equal(await page.locator('.logout').getAttribute('href'), '/cdn-cgi/access/logout');
        if (status === 403) await page.locator('#access-identity').filter({ hasText: employeeA.email }).waitFor();
        await page.close();
      }
    });

    await test('service failures, empty search, filters, and audit failure have clear states', async () => {
      const offline = await browser.newPage(); await mockApi(offline, { meStatus: 503 });
      await offline.goto(origin + '/admin/');
      await offline.locator('#access-title').filter({ hasText: 'momentanément indisponible' }).waitFor();
      assert.equal(await offline.locator('#access-retry').isVisible(), true); await offline.close();
      const page = await browser.newPage(); let failList = true;
      await mockApi(page, { intercept: async ({ endpoint, route, send }) => {
        if (endpoint === '/rewards' && failList) { await send(route, 500, { message: 'Test serveur indisponible.' }); return true; }
        if (endpoint === '/budget' || endpoint === '/audit') { await send(route, 500, { message: 'Test serveur indisponible.' }); return true; }
        return false;
      } });
      await page.goto(origin + '/admin/');
      await page.locator('#list-state').filter({ hasText: 'n’a pas pu être chargé' }).waitFor();
      assert.doesNotMatch(await page.locator('#list-state').innerText(), /Test serveur/);
      await page.locator('#budget-error').waitFor();
      assert.equal(await page.locator('#budget-remaining').innerText(), '—');
      failList = false; await page.locator('#list-state button').click();
      await page.locator('.reward-row').click();
      await page.locator('#audit-state').filter({ hasText: 'momentanément indisponible' }).waitFor();
      await page.locator('#code-search').fill('NOT-A-CODE'); await page.locator('#search-form button').click();
      await page.locator('#list-state h3').filter({ hasText: 'AUCUN RÉSULTAT' }).waitFor();
      await page.locator('#code-search').fill(''); await page.locator('#status-filter').selectOption('issued');
      await page.locator('#list-state').filter({ hasText: 'Aucune récompense trouvée' }).waitFor();
      await page.locator('#status-filter').selectOption('pending');
      await page.locator('.reward-row').waitFor();
      await page.close();
    });

    await test('claim failure and cancel never report success or expose discount confirmation', async () => {
      const page = await browser.newPage(); let claims = 0;
      await mockApi(page, { intercept: async ({ endpoint, route, send }) => {
        if (endpoint.endsWith('/claim')) { claims += 1; await send(route, 500, { message: 'Validation temporairement indisponible.' }); return true; }
        return false;
      } });
      await openReward(page, origin); await page.locator('#claim-button').click(); await page.keyboard.press('Escape');
      assert.equal(claims, 0); assert.equal(await page.locator('#claim-dialog').evaluate((dialog) => dialog.open), false);
      await page.locator('#claim-button').click(); await page.locator('#claim-confirm').click();
      await page.locator('#claim-dialog-error').filter({ hasText: 'temporairement indisponible' }).waitFor();
      assert.equal(await page.locator('#use-form').count(), 0); assert.equal(await page.locator('#notification').isVisible(), false);
      await page.close();
    });

    await test('use failure retains confirmation, warns against a second discount, and never reports success', async () => {
      const page = await browser.newPage();
      await mockApi(page, { record: { reward: fixture({ status: 'claimed', claimedBy: employeeA.sub, claimedAt: '2026-11-14T14:00:00Z' }), claims: 0, uses: 0 }, intercept: async ({ endpoint, route, send }) => {
        if (endpoint.endsWith('/use')) { await send(route, 500, { message: 'Enregistrement indisponible.' }); return true; } return false;
      } });
      await openReward(page, origin); await page.locator('#eligible-food-amount').fill('10');await page.locator('#food-only-confirm').check();await page.locator('#discount-confirm').check(); await page.locator('#use-confirm').click();
      await page.locator('#use-error').filter({ hasText: 'ne l’appliquez pas une deuxième fois' }).waitFor();
      assert.equal(await page.locator('#discount-confirm').isChecked(), true);
      assert.equal(await page.locator('#notification').isVisible(), false);
      await page.close();
    });

    await test('untrusted customer, code, and audit actor remain inert', async () => {
      const page = await browser.newPage();
      const attack = '<img src=x onerror="window.adminXss=1">';
      await mockApi(page, { record: { reward: fixture({ firstName: attack, code: '</button><script>window.adminXss=2</script>', status: 'issued' }), claims: 0, uses: 0 }, audit: [{ id: 'event-test', action: 'issued', actorName: attack, createdAt: '2026-11-14T14:00:00Z' }] });
      await openReward(page, origin);
      await page.locator('#audit-list').filter({ hasText: attack }).waitFor();
      assert.equal(await page.evaluate(() => window.adminXss), undefined);
      assert.equal(await page.locator('#detail-content img, #reward-list script, #audit-list img').count(), 0);
      assert.match(await page.locator('#detail-name').innerText(), /<img/);
      await page.close();
    });

    await test('CSV downloads only after server success; session expiry removes customer data', async () => {
      const page = await browser.newPage({ acceptDownloads: true }); let expired = false;
      await mockApi(page, { intercept: async ({ endpoint, route, send }) => {
        if (expired && endpoint === '/rewards') { await send(route, 401, { error: 'access_required' }); return true; } return false;
      } });
      await openReward(page, origin);
      const downloadPromise = page.waitForEvent('download'); await page.locator('#export-button').click();
      const download = await downloadPromise; assert.match(download.suggestedFilename(), /^recompenses-\d{4}-\d{2}-\d{2}\.csv$/);
      expired = true; await page.locator('#refresh-button').click();
      await page.locator('#access-title').filter({ hasText: 'Connectez-vous' }).waitFor();
      assert.equal(await page.locator('#admin-content').isVisible(), false);
      assert.equal(await page.locator('#reward-list').innerText(), ''); assert.equal(await page.locator('#detail-name').innerText(), '');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await page.close();
    });

    await test('budget editing requires a manager and a complete successful GET', async () => {
      const staff = await browser.newPage(); await mockApi(staff);
      await staff.goto(origin + '/admin/');
      await staff.locator('#budget-total').filter({ hasText: '100,00' }).waitFor();
      assert.equal(await staff.locator('#budget-editor').isVisible(), false);
      await staff.close();
      for (const badBudget of [{ ...budget, revision: undefined }, { ...budget, remainingCents: 1 }]) {
        const page = await browser.newPage();
        await mockApi(page, { employee: employeeB, budget: badBudget });
        await page.goto(origin + '/admin/');
        await page.locator('#budget-error').waitFor();
        assert.equal(await page.locator('#budget-total').innerText(), '—');
        assert.equal(await page.locator('#budget-editor').isVisible(), false);
        await page.close();
      }
      const gate = deferred(); const page = await browser.newPage();
      await mockApi(page, { employee: employeeB, intercept: async ({ endpoint, request, route, send }) => {
        if (endpoint === '/budget' && request.method() === 'GET') { await gate.promise; await send(route, 200, budget); return true; } return false;
      } });
      await page.goto(origin + '/admin/');
      await page.locator('#admin-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#budget-editor').isVisible(), false);
      gate.resolve(); await page.locator('#budget-editor').waitFor({ state: 'visible' });
      await page.close();
    });

    await test('manager confirms month-only and future budgets; no optimistic success or overflow', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const budgetRecord = { value: { ...budget } }; const calls = []; const gate = deferred();
      await mockApi(page, { employee: employeeB, budgetRecord, intercept: async ({ endpoint, request, route, send }) => {
        if (endpoint !== '/budget' || request.method() !== 'PATCH') return false;
        const body = request.postDataJSON(); calls.push(body);
        if (calls.length === 1) await gate.promise;
        budgetRecord.value = { ...budgetRecord.value, budgetCents: body.budgetCents, remainingCents: body.budgetCents - 2000, revision: budgetRecord.value.revision + 1,
          ...(body.scope === 'current_and_future' ? { defaultBudgetCents: body.budgetCents, defaultRevision: budgetRecord.value.defaultRevision + 1 } : {}), updatedAt: '2026-11-15T16:00:00Z', updatedBy: employeeB.sub, updatedByName: employeeB.name };
        await send(route, 200, budgetRecord.value); return true;
      } });
      await page.goto(origin + '/admin/'); await page.locator('#budget-editor').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('[data-budget-preset="100"]').click();
      await page.locator('#budget-review').click();
      await page.locator('#budget-cancel').click(); assert.equal(calls.length, 0);
      await page.locator('[data-budget-preset="250"]').click(); await page.locator('#budget-review').click();
      const summary = await page.locator('#budget-confirmation-summary').innerText();
      assert.match(summary, /novembre 2026.*100,00.*250,00/);
      assert.match(summary, /Ce mois-ci seulement.*reste à 100,00/s);
      await page.locator('#budget-confirm').click();
      await page.waitForFunction(() => document.getElementById('budget-confirm').disabled);
      assert.match(await page.locator('#budget-total').innerText(), /100,00/);
      assert.equal(await page.locator('#notification').isVisible(), false);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#budget-dialog').evaluate((dialog) => dialog.open), true);
      gate.resolve(); await page.locator('#budget-total').filter({ hasText: '250,00' }).waitFor();
      await page.waitForFunction(() => !document.getElementById('budget-fields').disabled);
      assert.match(await page.locator('#budget-future').innerText(), /100,00/);
      assert.match(await page.locator('#budget-updated').innerText(), /Benoît Test/);
      assert.deepEqual({ ...calls[0], requestId: '<generated>' }, { month: '2026-11', budgetCents: 25000, scope: 'month_only', expectedRevision: 0, expectedDefaultRevision: 0, requestId: '<generated>' });
      assert.match(calls[0].requestId, /^[A-Za-z0-9_-]{16,128}$/);
      await page.locator('#budget-amount').fill('150,50');
      await page.locator('input[name="budget-scope"][value="current_and_future"]').check();
      await page.locator('#budget-review').click();
      assert.match(await page.locator('#budget-confirmation-summary').innerText(), /Ce mois-ci et les mois suivants.*100,00.*150,50/s);
      await page.locator('#budget-confirm').click();
      await page.locator('#budget-future').filter({ hasText: '150,50' }).waitFor();
      assert.equal(calls[1].budgetCents, 15050); assert.equal(calls[1].expectedRevision, 1); assert.equal(calls[1].expectedDefaultRevision, 0);
      await page.screenshot({ path: path.join(artifacts, 'admin-manager-budget-390.png'), fullPage: true });
      await page.close();
    });

    await test('uncertain budget response retries the same persisted request after refresh', async () => {
      const page = await browser.newPage(); const calls = []; const budgetRecord = { value: { ...budget } };
      await mockApi(page, { employee: employeeB, budgetRecord, intercept: async ({ endpoint, request, route, send }) => {
        if (endpoint !== '/budget' || request.method() !== 'PATCH') return false;
        calls.push(request.postDataJSON());
        budgetRecord.value = { ...budget, budgetCents: 25000, remainingCents: 23000, revision: 1 };
        if (calls.length === 1) await route.abort('failed'); else await send(route, 200, budgetRecord.value);
        return true;
      } });
      await page.goto(origin + '/admin/'); await page.locator('#budget-editor').waitFor({ state: 'visible' });
      await page.locator('[data-budget-preset="250"]').click(); await page.locator('#budget-review').click(); await page.locator('#budget-confirm').click();
      await page.locator('#budget-retry').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#budget-fields').evaluate(el=>el.disabled), true);assert.equal(await page.locator('#budget-amount').isDisabled(),true);
      assert.equal(await page.locator('#notification').isVisible(), false);
      await page.locator('#refresh-button').click();
      await page.locator('#budget-total').filter({ hasText: '250,00' }).waitFor();
      await page.locator('#budget-retry').click();
      await page.locator('#notification').filter({ hasText: 'Budget enregistré' }).waitFor();
      assert.deepEqual(calls[1], calls[0]);
      await page.waitForFunction(() => !document.getElementById('budget-fields').disabled);
      assert.equal(await page.locator('#budget-retry').isVisible(), false);
      await page.close();
    });

    await test('budget conflict refreshes commitments and revisions without claiming success', async () => {
      const page = await browser.newPage(); const budgetRecord = { value: { ...budget } }; const calls = [];
      await mockApi(page, { employee: employeeB, budgetRecord, intercept: async ({ endpoint, request, route, send }) => {
        if (endpoint !== '/budget' || request.method() !== 'PATCH') return false;
        calls.push(request.postDataJSON());
        budgetRecord.value = { ...budget, budgetCents: 25000, usedCents: 20000, reservedCents: 0, remainingCents: 5000, minimumBudgetCents: 20000, minimumFutureBudgetCents: 22000, revision: 2, defaultRevision: 1, defaultBudgetCents: 25000 };
        await send(route, 409, { error: 'budget_conflict' }); return true;
      } });
      await page.goto(origin + '/admin/'); await page.locator('#budget-editor').waitFor({ state: 'visible' });
      await page.locator('[data-budget-preset="250"]').click(); await page.locator('#budget-review').click(); await page.locator('#budget-confirm').click();
      await page.locator('#budget-operation-error').filter({ hasText: 'autre responsable' }).waitFor();
      assert.match(await page.locator('#budget-total').innerText(), /250,00/);
      assert.match(await page.locator('#budget-commitments').innerText(), /200,00.*220,00/);
      assert.equal(await page.locator('#notification').isVisible(), false);
      await page.locator('[data-budget-preset="100"]').click(); await page.locator('#budget-review').click();
      assert.equal(await page.locator('#budget-dialog').evaluate((dialog) => dialog.open), false);
      assert.equal(calls.length, 1);
      await page.locator('[data-budget-preset="250"]').click(); await page.locator('#budget-review').click(); await page.locator('#budget-confirm').click();
      await page.locator('#budget-operation-error').waitFor();
      assert.equal(calls[1].expectedRevision, 2); assert.equal(calls[1].expectedDefaultRevision, 1);
      assert.notEqual(calls[1].requestId, calls[0].requestId);
      await page.close();
    });

    await test('legacy issued rewards stay final without claiming that a discount was applied', async () => {
      const page = await browser.newPage();
      await mockApi(page, { record: { reward: fixture({ status: 'issued', discountApplied: false, issuedAt: '2026-11-14T14:05:00Z', issuedByName: employeeB.name }), claims: 0, uses: 0 } });
      await openReward(page, origin);
      assert.equal(await page.locator('#detail-status').innerText(), 'Déjà utilisé');
      assert.doesNotMatch(await page.locator('#detail-facts').innerText(), /Rabais appliqué le/);
      assert.equal(await page.locator('#use-form').count(), 0);
      await page.close();
    });
    await test('manager reviews both explicit exceptions before generating a manual food-only code', async () => {
      const page=await browser.newPage({viewport:{width:320,height:780}});const calls=[];
      await mockApi(page,{employee:employeeB,intercept:async({endpoint,request,route,send})=>{
        if(endpoint==='/manual-rewards/quote'){await send(route,200,{budgetCents:10000,usedCents:10000,reservedCents:0,valueCents:2000,projectedOverrunCents:2000,additionalExceptionalCents:2000,cooldownRequired:true,manualRewardsEnabled:true,quote:{month:'2026-11',budgetCents:10000,usedCents:10000,reservedCents:0,revision:0,lastRewardId:'previous'}});return true;}
        if(endpoint==='/manual-rewards'){calls.push(request.postDataJSON());await send(route,200,{reward:fixture({source:'manual',score:null,code:'GOAT-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'}),notification:{status:'disabled'}});return true;}
        return false;
      }});
      await page.goto(origin+'/admin/');await page.locator('.manual-panel').waitFor();
      for(const [key,value] of Object.entries({firstName:'Camille',lastName:'Essai',phone:'+15145551234',reason:'Décision du gestionnaire'}))await page.locator('.manual-form input[name="'+key+'"]').fill(value);
      await page.locator('.manual-form select').selectOption('2000');await page.locator('.manual-form button').click();
      const confirm=page.getByRole('button',{name:'Confirmer et générer le code unique'});await confirm.waitFor();await confirm.click();assert.equal(calls.length,0);
      assert.match(await page.locator('.manual-panel').innerText(),/Dépassement total après émission/);
      await page.locator('.manual-panel input[type=checkbox]').nth(0).check();await page.locator('.manual-panel input[type=checkbox]').nth(1).check();
      await page.locator('.manual-panel textarea').nth(0).fill('Budget exceptionnel autorisé');await page.locator('.manual-panel textarea').nth(1).fill('Délai exceptionnel autorisé');await confirm.click();
      await page.getByText('Code : GOAT-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',{exact:true}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0].authorizeBudgetOverrun,true);assert.equal(calls[0].authorizeCooldown,true);assert.equal(calls[0].valueCents,2000);
      assert.match(await page.locator('.page-intro').innerText(),/uniquement aux aliments.*boissons alcooliques/s);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'manual issuance overflows 320px');
      await page.screenshot({path:path.join(artifacts,'admin-manual-food-320.png'),fullPage:true});await page.close();
    });
    await test('Preview consumption explicitly records no invoice discount and needs no food value',async()=>{
      const page=await browser.newPage(),calls=[];
      const reward=fixture({status:'claimed',claimedBy:employeeA.sub,claimedByName:employeeA.name});
      await mockApi(page,{previewTestRedemption:true,record:{reward,claims:0,uses:0},intercept:async({endpoint,request,route,send})=>{
        if(!endpoint.endsWith('/use'))return false;calls.push(request.postDataJSON());await send(route,200,{reward:{...reward,status:'issued',issuedBy:employeeA.sub,previewTestConsumed:true,discountApplied:false}});return true;
      }});
      await openReward(page,origin);assert.equal(await page.locator('#eligible-food-amount').count(),0);
      assert.match(await page.locator('#use-form').innerText(),/aucun rabais dans Lightspeed/);
      await page.locator('#discount-confirm').check();await page.locator('#use-confirm').click();await page.locator('#notification').filter({hasText:'Code consommé pour l’essai Preview'}).waitFor();
      assert.deepEqual(calls,[{previewTestConsumed:true}]);await page.close();
    });
    await test('name and declared phone search finds every customer reward, with no SMS action at launch',async()=>{
      const page=await browser.newPage({viewport:{width:390,height:844}}),searches=[];
      const rows=[fixture({id:'emilie-pending',firstName:'Émilie',lastName:'Noël',code:'GOAT-EMILIE-1'}),fixture({id:'emilie-used',firstName:'Émilie',lastName:'Noël',code:'GOAT-EMILIE-2',status:'issued'}),fixture({id:'other',firstName:'Autre',lastName:'Client',phone:'+15145551235',code:'GOAT-OTHER'})];
      await mockApi(page,{rows,intercept:async({endpoint,url})=>{if(endpoint==='/rewards')searches.push(url.searchParams.get('search'));return false;}});
      await page.goto(origin+'/admin/');await page.locator('.reward-row').first().waitFor();
      await page.locator('#code-search').fill('emilie noel');await page.locator('#search-form button').click();
      await page.waitForFunction(()=>document.querySelectorAll('.reward-row').length===2);assert.equal(searches.at(-1),'emilie noel');
      await page.locator('.reward-row').first().click();assert.match(await page.locator('#detail-facts').innerText(),/Téléphone fourni.*\+15145551234/s);assert.match(await page.locator('#detail-facts').innerText(),/Numéro déclaré, non vérifié par SMS/);
      assert.equal(await page.getByRole('button',{name:'Renvoyer le SMS du code'}).count(),0);
      await page.locator('#code-search').fill('(514) 555-1234');await page.locator('#search-form button').click();
      await page.waitForFunction(()=>document.querySelectorAll('.reward-row').length===2);assert.equal(searches.at(-1),'(514) 555-1234');
      await page.locator('.reward-row').nth(1).click();assert.equal(await page.locator('#detail-code').innerText(),'GOAT-EMILIE-2');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.close();
    });
    await test('declared phone text is inert and SMS tools require explicit enabled metadata',async()=>{
      const page=await browser.newPage(),attack='<img src=x onerror="window.phoneXss=1">';
      await mockApi(page,{record:{reward:fixture({phone:attack}),claims:0,uses:0}});await openReward(page,origin);
      assert.ok((await page.locator('#detail-facts').innerText()).includes(attack));assert.equal(await page.evaluate(()=>window.phoneXss),undefined);assert.equal(await page.locator('#detail-facts img').count(),0);await page.close();
      const sms=await browser.newPage();await mockApi(sms,{notificationSmsEnabled:true,phoneVerificationMode:'sms'});await openReward(sms,origin);assert.equal(await sms.getByRole('button',{name:'Renvoyer le SMS du code'}).count(),1);await sms.close();
    });
    await test('manager sees eligibility and duplicate signals and authorizes a justified shared-device unlock',async()=>{
      const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[];let unlocked=false;
      await mockApi(page,{employee:employeeB,intercept:async({endpoint,request,route,send})=>{
        if(endpoint.endsWith('/eligibility')){await send(route,200,{potentialDuplicate:true,phone:{blocked:true,nextEligibleAt:'2026-12-14T12:00:00Z'},device:{tracked:true,blocked:!unlocked,nextEligibleAt:'2026-12-14T12:00:00Z',exceptionAvailable:unlocked,exceptionExpiresAt:'2026-11-16T12:00:00Z'},history:[{code:'GOAT-HISTORIQUE',fullName:'Camille Essai',valueCents:1000,confirmedAt:'2026-11-14T12:00:00Z'}],signals:[{createdAt:'2026-11-15T12:00:00Z',reason:'device_cooldown',differentName:true}]});return true;}
        if(endpoint.endsWith('/unlock')){calls.push(request.postDataJSON());unlocked=true;await send(route,200,{exceptions:[{scope:'device'}]});return true;}return false;
      }});
      await openReward(page,origin);await page.locator('#unlock-confirm').waitFor();assert.match(await page.locator('#eligibility-section').innerText(),/Doublon potentiel/);
      await page.locator('#unlock-confirm').click();assert.equal(calls.length,0);await page.locator('#unlock-scope').selectOption('device');await page.locator('#unlock-reason').fill('Appareil partagé au restaurant');await page.locator('#unlock-confirm').click();
      await page.locator('#notification').filter({hasText:'Déblocage exceptionnel enregistré'}).waitFor();await page.locator('#eligibility-section').filter({hasText:'déblocage autorisé'}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0].scope,'device');assert.equal(calls[0].reason,'Appareil partagé au restaurant');await page.close();
    });
    process.stdout.write(checks + ' admin browser checks passed. Screenshots: ' + artifacts + '\n');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
