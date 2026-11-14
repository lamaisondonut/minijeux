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
const fixture = (overrides = {}) => ({ id: 'reward-test-1', code: 'NOEL-TEST-0001', firstName: 'Camille', lastName: 'Essai', score: 7500, valueCents: 1000, status: 'pending', confirmedAt: '2026-11-14T12:00:00Z', claimBy: '2026-12-14T12:00:00Z', claimedAt: null, claimedBy: null, issuedAt: null, issuedBy: null, lightspeedRef: null, ...overrides });
const budget = { month: '2026-11', usedCents: 1000, reservedCents: 1000, remainingCents: 98000, pendingCount: 1 };
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
  const record = options.record || { reward: fixture(), claims: 0, issues: 0 };
  const send = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.slice('/api/admin'.length);
    if (options.intercept && await options.intercept({ route, request, url, endpoint, send, record, employee })) return;
    if (endpoint === '/me') return send(route, options.meStatus || 200, options.meStatus ? { error: 'test', message: 'Accès indisponible pour ce test.' } : { employee });
    if (endpoint === '/identity') return send(route, 200, { sub: employee.sub, email: employee.email });
    if (endpoint === '/budget') return send(route, 200, budget);
    if (endpoint === '/rewards') {
      let rows = options.rows || [record.reward];
      const code = url.searchParams.get('code');
      const status = url.searchParams.get('status');
      if (code) rows = rows.filter((row) => row.code === code);
      if (status) rows = rows.filter((row) => row.status === status);
      return send(route, 200, { rewards: rows, nextCursor: null });
    }
    if (endpoint === '/audit') return send(route, 200, { audit: options.audit || [] });
    if (endpoint === '/export') return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: 'code,statut\nNOEL-TEST-0001,pending\n' });
    if (endpoint.endsWith('/claim') && request.method() === 'POST') {
      record.claims += 1;
      if (record.reward.status !== 'pending') return send(route, 409, { error: 'already_used', message: 'Ce code est déjà utilisé.' });
      record.reward = { ...record.reward, status: 'claimed', claimedBy: employee.sub, claimedAt: '2026-11-14T14:00:00Z' };
      const snapshot = { ...record.reward };
      if (options.claimGate) await options.claimGate.promise;
      return send(route, 200, { reward: snapshot });
    }
    if (endpoint.endsWith('/issue') && request.method() === 'POST') {
      record.issues += 1;
      if (record.reward.status !== 'claimed' || record.reward.claimedBy !== employee.sub) return send(route, 409, { error: 'claim_owner', message: 'Seul l’employé responsable peut terminer.' });
      const body = request.postDataJSON();
      assert.ok(body.lightspeedRef);
      record.reward = { ...record.reward, status: 'issued', issuedBy: employee.sub, issuedAt: '2026-11-14T14:05:00Z', lightspeedRef: body.lightspeedRef };
      if (options.issueGate) await options.issueGate.promise;
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
        await page.locator('#budget-remaining').filter({ hasText: '980' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page overflows at ' + viewport.width);
        assert.equal(await page.locator('.brand img').evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)), true, 'official logos did not load');
        await page.screenshot({ path: path.join(artifacts, 'admin-' + viewport.width + '.png'), fullPage: true });
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
        await page.close();
      }
    });

    await test('claim server success precedes Lightspeed form; concurrent employee receives 409; single issuance', async () => {
      const record = { reward: fixture(), claims: 0, issues: 0 };
      const claimGate = deferred(); const issueGate = deferred();
      const pageA = await browser.newPage(); const pageB = await browser.newPage();
      await mockApi(pageA, { record, claimGate, issueGate });
      await mockApi(pageB, { record, employee: employeeB });
      await openReward(pageA, origin); await openReward(pageB, origin);
      await pageA.locator('#claim-button').click();
      assert.match(await pageA.locator('#claim-summary').innerText(), /Ariane Test/);
      assert.match(await pageA.locator('#claim-summary').innerText(), /10,00/);
      await pageA.locator('#claim-confirm').click();
      await pageA.waitForFunction(() => document.getElementById('claim-confirm').disabled);
      assert.equal(await pageA.locator('#issue-form').count(), 0, 'issue form shown before claim server success');
      assert.equal(await pageA.locator('#notification').isVisible(), false);
      await pageA.keyboard.press('Escape');
      assert.equal(await pageA.locator('#claim-dialog').evaluate((dialog) => dialog.open), true, 'in-flight dialog escaped');
      await pageB.locator('#claim-button').click(); await pageB.locator('#claim-confirm').click();
      await pageB.locator('#notification.error').waitFor();
      await pageB.locator('#detail-action').filter({ hasText: 'Remise déjà prise en charge' }).waitFor();
      assert.equal(await pageB.locator('#issue-form').count(), 0, 'another employee can issue');
      assert.equal(await pageB.locator('#claim-button').count(), 0);
      claimGate.resolve();
      await pageA.locator('#issue-confirm').waitFor({ state: 'visible' });
      await pageA.waitForFunction(() => !document.getElementById('issue-confirm').disabled);
      await pageA.locator('#issue-confirm').click();
      assert.equal(record.issues, 0, 'blank issue confirmation accepted');
      await pageA.locator('#lightspeed-ref').fill('LS-TEST-001');
      await pageA.locator('#issue-confirm').click();
      assert.equal(record.issues, 0, 'actual handover was not required');
      await pageA.locator('#handover-confirm').check();
      await pageA.locator('#issue-confirm').click();
      await pageA.waitForFunction(() => document.getElementById('issue-confirm').disabled);
      assert.doesNotMatch(await pageA.locator('#notification').innerText(), /remise.*enregistrée/);
      issueGate.resolve();
      await pageA.locator('#detail-action').filter({ hasText: 'Carte remise et enregistrée' }).waitFor();
      assert.equal(record.claims, 2); assert.equal(record.issues, 1); assert.equal(record.reward.status, 'issued');
      assert.equal(record.reward.claimedBy, employeeA.sub); assert.equal(record.reward.issuedBy, employeeA.sub);
      assert.equal(await pageA.locator('#claim-button').count(), 0); assert.equal(await pageA.locator('#issue-form').count(), 0);
      await pageB.locator('#refresh-button').click();
      await pageB.locator('#detail-status').filter({ hasText: 'Carte remise' }).waitFor();
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
      await page.locator('#budget-error').waitFor();
      assert.equal(await page.locator('#budget-remaining').innerText(), '—');
      failList = false; await page.locator('#list-state button').click();
      await page.locator('.reward-row').click();
      await page.locator('#audit-state').filter({ hasText: 'momentanément indisponible' }).waitFor();
      await page.locator('#code-search').fill('NOT-A-CODE'); await page.locator('#search-form button').click();
      await page.locator('#list-state').filter({ hasText: 'Aucune récompense trouvée' }).waitFor();
      await page.locator('#code-search').fill(''); await page.locator('#status-filter').selectOption('issued');
      await page.locator('#list-state').filter({ hasText: 'Aucune récompense trouvée' }).waitFor();
      await page.locator('#status-filter').selectOption('pending');
      await page.locator('.reward-row').waitFor();
      await page.close();
    });

    await test('claim failure and cancel never report success or expose issuance', async () => {
      const page = await browser.newPage(); let claims = 0;
      await mockApi(page, { intercept: async ({ endpoint, route, send }) => {
        if (endpoint.endsWith('/claim')) { claims += 1; await send(route, 500, { message: 'Validation temporairement indisponible.' }); return true; }
        return false;
      } });
      await openReward(page, origin); await page.locator('#claim-button').click(); await page.keyboard.press('Escape');
      assert.equal(claims, 0); assert.equal(await page.locator('#claim-dialog').evaluate((dialog) => dialog.open), false);
      await page.locator('#claim-button').click(); await page.locator('#claim-confirm').click();
      await page.locator('#claim-dialog-error').filter({ hasText: 'temporairement indisponible' }).waitFor();
      assert.equal(await page.locator('#issue-form').count(), 0); assert.equal(await page.locator('#notification').isVisible(), false);
      await page.close();
    });

    await test('issue failure preserves reference, warns against second card, and never reports success', async () => {
      const page = await browser.newPage();
      await mockApi(page, { record: { reward: fixture({ status: 'claimed', claimedBy: employeeA.sub, claimedAt: '2026-11-14T14:00:00Z' }), claims: 0, issues: 0 }, intercept: async ({ endpoint, route, send }) => {
        if (endpoint.endsWith('/issue')) { await send(route, 500, { message: 'Enregistrement indisponible.' }); return true; } return false;
      } });
      await openReward(page, origin); await page.locator('#lightspeed-ref').fill('LS-EXISTING-TEST'); await page.locator('#handover-confirm').check(); await page.locator('#issue-confirm').click();
      await page.locator('#issue-error').filter({ hasText: 'ne créez pas de nouvelle carte' }).waitFor();
      assert.equal(await page.locator('#lightspeed-ref').inputValue(), 'LS-EXISTING-TEST');
      assert.equal(await page.locator('#notification').isVisible(), false);
      await page.close();
    });

    await test('untrusted customer, code, audit actor, and Lightspeed text remain inert', async () => {
      const page = await browser.newPage();
      const attack = '<img src=x onerror="window.adminXss=1">';
      await mockApi(page, { record: { reward: fixture({ firstName: attack, code: '</button><script>window.adminXss=2</script>', status: 'issued', lightspeedRef: attack }), claims: 0, issues: 0 }, audit: [{ id: 'event-test', action: 'issued', actorName: attack, createdAt: '2026-11-14T14:00:00Z' }] });
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
    process.stdout.write(checks + ' admin browser checks passed. Screenshots: ' + artifacts + '\n');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
