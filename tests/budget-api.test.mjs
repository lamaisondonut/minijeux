import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import test from 'node:test';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { getBudget, changeBudget } from '../server/budget.mjs';
import { startSession } from '../server/store.mjs';
import { handleRequest } from '../server/api.mjs';
import { secureId } from '../server/common.mjs';

const NOW = Date.parse('2026-11-14T17:00:00Z');
const ORIGIN = 'https://budget-tests.example';
const MANAGER = { sub: 'budget-manager', email: 'manager@example.invalid', name: 'Manager', role: 'manager', active: 1 };
const OTHER_MANAGER = { sub: 'budget-manager-two', email: 'manager2@example.invalid', name: 'Second Manager', role: 'manager', active: 1 };
const STAFF = { sub: 'budget-staff', email: 'staff@example.invalid', name: 'Staff', role: 'staff', active: 1 };
const INACTIVE = { sub: 'budget-inactive', email: 'inactive@example.invalid', name: 'Inactive', role: 'manager', active: 0 };

if (!isMainThread) {
  const { file, barrier, actor, body, now } = workerData;
  const f = openReviewDatabase(file);
  parentPort.postMessage({ ready: true });
  Atomics.wait(new Int32Array(barrier), 0, 0);
  try {
    parentPort.postMessage({ ok: true, value: await changeBudget(f.DB, actor, body, now) });
  } catch (error) {
    parentPort.postMessage({ ok: false, status: error.status, code: error.code, message: error.message });
  } finally { f.sqlite.close(); }
} else {
  let requestCounter = 0;
  function body(overrides = {}) {
    return { month: '2026-11', budgetCents: 25000, scope: 'month_only', expectedRevision: 0, expectedDefaultRevision: 0, requestId: `budget-request-${String(++requestCounter).padStart(20, '0')}`, ...overrides };
  }
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'boreal-budget-api-'));
    const file = join(directory, 'budget.sqlite');
    const f = openReviewDatabase(file);
    f.sqlite.exec('PRAGMA journal_mode=WAL;');
    const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    assert.ok(migrations.includes('0002_configurable_budget.sql'), 'Use the actual configurable-budget migration');
    assert.ok(migrations.includes('0003_manual_discounts.sql'), 'Use the complete integrated reward schema');
    for (const name of migrations) {
      f.sqlite.exec('BEGIN IMMEDIATE');
      try {
        f.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
        f.sqlite.exec('COMMIT');
      } catch (error) {
        f.sqlite.exec('ROLLBACK');
        throw error;
      }
    }
    for (const actor of [MANAGER, OTHER_MANAGER, STAFF, INACTIVE]) {
      f.sqlite.prepare('INSERT INTO employees(sub,email,name,role,active) VALUES(?,?,?,?,?)').run(actor.sub, actor.email, actor.name, actor.role, actor.active);
    }
    const row = month => ({ ...f.sqlite.prepare('SELECT * FROM budgets WHERE month=?').get(month) });
    const settings = () => ({ ...f.sqlite.prepare('SELECT * FROM reward_budget_settings WHERE id=1').get() });
    const audit = () => f.sqlite.prepare("SELECT * FROM audit WHERE action='budget_changed' ORDER BY id").all().map(row => ({ ...row, details: JSON.parse(row.details) }));
    const snapshot = () => ({ budgets: f.sqlite.prepare('SELECT * FROM budgets ORDER BY month').all().map(row => ({ ...row })), settings: settings(), audit: audit() });
    return { ...f, file, row, settings, audit, snapshot, close() { f.sqlite.close(); rmSync(directory, { recursive: true, force: true }); } };
  }
  async function withFixture(fn) {
    const f = fixture();
    try { return await fn(f); } finally { f.close(); }
  }
  const status = code => error => error?.status === code;
  const get = f => getBudget(f.DB, { month: '2026-11', now: NOW });
  async function race(file, inputs) {
    const barrier = new SharedArrayBuffer(4);
    const workers = [];
    let ready = 0;
    try {
      return await Promise.all(inputs.map(input => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { file, barrier, actor: MANAGER, now: NOW, ...input } });
        workers.push(worker);
        let result;
        worker.on('message', message => {
          if (message.ready) {
            if (++ready === inputs.length) {
              Atomics.store(new Int32Array(barrier), 0, 1);
              Atomics.notify(new Int32Array(barrier), 0, inputs.length);
            }
          } else result = message;
        });
        worker.once('error', reject);
        worker.once('exit', code => code === 0 && result ? resolve(result) : reject(new Error(`Budget worker exited without a result (${code})`)));
      })));
    } finally { await Promise.allSettled(workers.map(worker => worker.terminate())); }
  }

  test('budget GET exposes the current limit, recurring default, revisions, and commitment floors', () => withFixture(async f => {
    f.sqlite.prepare("INSERT INTO budgets(month,used_cents,reserved_cents) VALUES('2026-11',1000,2000),('2026-12',7000,1000),('2026-10',9000,0)").run();
    const result = await get(f);
    assert.equal(result.month, '2026-11');
    assert.equal(result.budgetCents, 10000);
    assert.equal(result.defaultBudgetCents, 10000);
    assert.equal(result.usedCents, 1000);
    assert.equal(result.reservedCents, 2000);
    assert.equal(result.remainingCents, 7000);
    assert.equal(result.minimumBudgetCents, 3000);
    assert.equal(result.minimumFutureBudgetCents, 8000);
    assert.equal(result.revision, 0);
    assert.equal(result.defaultRevision, 0);
    assert.equal(result.pendingCount, 0);
    assert.equal(result.usedCount, 0);
    assert.equal(result.countScope, 'all');
  }));

  test('month_only changes this month and audit while preserving default, future rows, and history', () => withFixture(async f => {
    f.sqlite.prepare("INSERT INTO budgets(month) VALUES('2026-10'),('2026-12')").run();
    const settings = f.settings();
    const past = f.row('2026-10');
    const future = f.row('2026-12');
    const result = await changeBudget(f.DB, MANAGER, body(), NOW);
    assert.equal(result.budgetCents, 25000);
    assert.equal(result.defaultBudgetCents, 10000);
    assert.equal(result.revision, 1);
    assert.equal(result.defaultRevision, 0);
    assert.equal(f.row('2026-11').limit_cents, 25000);
    assert.deepEqual(f.settings(), settings);
    assert.deepEqual(f.row('2026-10'), past);
    assert.deepEqual(f.row('2026-12'), future);
    assert.equal(f.audit().length, 1);
    assert.equal(f.audit()[0].actor_sub, MANAGER.sub);
  }));

  test('current_and_future updates current, precreated future months, and default in one audit', () => withFixture(async f => {
    f.sqlite.prepare("INSERT INTO budgets(month) VALUES('2026-10'),('2026-12'),('2027-01')").run();
    const past = f.row('2026-10');
    const result = await changeBudget(f.DB, MANAGER, body({ scope: 'current_and_future' }), NOW);
    assert.equal(result.defaultBudgetCents, 25000);
    assert.equal(result.revision, 1);
    assert.equal(result.defaultRevision, 1);
    for (const month of ['2026-11', '2026-12', '2027-01']) {
      assert.equal(f.row(month).limit_cents, 25000, month);
      assert.equal(f.row(month).revision, 1, month);
    }
    assert.deepEqual(f.row('2026-10'), past);
    assert.equal(f.settings().default_monthly_limit_cents, 25000);
    assert.equal(f.audit().length, 1);
    assert.equal(f.audit()[0].details.scope, 'current_and_future');
  }));

  test('new sessions snapshot only the configured limit and never carry unused money forward', () => withFixture(async f => {
    await changeBudget(f.DB, MANAGER, body({ scope: 'current_and_future' }), NOW);
    f.sqlite.prepare("UPDATE budgets SET used_cents=5000 WHERE month='2026-11'").run();
    const startAt = Date.parse('2026-12-02T17:00:00Z');
    await startSession(f.DB, { id: secureId(), ownerHash: secureId(), seed: 1, width: 360, height: 640, engineVersion: 'budget-test', month: '2026-12', now: startAt, expiresAt: startAt + 30 * 60000, allowRewards: false });
    const next = f.row('2026-12');
    assert.equal(next.limit_cents, 25000);
    assert.equal(next.used_cents, 0);
    assert.equal(next.reserved_cents, 0);
    assert.equal(f.row('2026-11').used_cents, 5000);
  }));

  test('recurring reduction checks every affected commitment, while month_only checks only this month', () => withFixture(async f => {
    f.sqlite.prepare("INSERT INTO budgets(month,used_cents,reserved_cents) VALUES('2026-11',1000,2000)").run();
    f.sqlite.prepare("INSERT INTO budgets(month,used_cents,reserved_cents) VALUES('2026-12',7000,1000)").run();
    const before = f.snapshot();
    await assert.rejects(changeBudget(f.DB, MANAGER, body({ budgetCents: 5000, scope: 'current_and_future' }), NOW), status(409));
    assert.deepEqual(f.snapshot(), before);
    const result = await changeBudget(f.DB, MANAGER, body({ budgetCents: 5000 }), NOW);
    assert.equal(result.budgetCents, 5000);
    assert.equal(f.row('2026-12').limit_cents, 10000);
    assert.equal(f.settings().default_monthly_limit_cents, 10000);
    const beforeLow = f.snapshot();
    await assert.rejects(changeBudget(f.DB, MANAGER, body({ budgetCents: 2500, expectedRevision: 1 }), NOW), status(409));
    assert.deepEqual(f.snapshot(), beforeLow);
  }));

  test('stale current or default revisions cannot change either budget or append audit', () => withFixture(async f => {
    await changeBudget(f.DB, MANAGER, body({ scope: 'current_and_future' }), NOW);
    const before = f.snapshot();
    await assert.rejects(changeBudget(f.DB, MANAGER, body({ budgetCents: 30000, expectedRevision: 0, expectedDefaultRevision: 1 }), NOW), status(409));
    await assert.rejects(changeBudget(f.DB, MANAGER, body({ budgetCents: 30000, expectedRevision: 1, expectedDefaultRevision: 0 }), NOW), status(409));
    assert.deepEqual(f.snapshot(), before);
  }));

  test('validation rejects noninteger money and malformed scope, revisions, month, or request ID', () => withFixture(async f => {
    await get(f);
    const before = f.snapshot();
    for (const invalid of [
      { budgetCents: -1 }, { budgetCents: 1.5 }, { budgetCents: '25000' }, { budgetCents: Number.MAX_SAFE_INTEGER + 1 },
      { scope: 'forever' }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedDefaultRevision: '0' },
      { month: '2026-1' }, { requestId: '' }, { requestId: 'invalid request id' },
    ]) await assert.rejects(changeBudget(f.DB, MANAGER, body(invalid), NOW), status(400), JSON.stringify(invalid));
    assert.deepEqual(f.snapshot(), before);
  }));

  test('manager authority is rechecked in the database, including inactive or spoofed staff', () => withFixture(async f => {
    await get(f);
    const before = f.snapshot();
    await assert.rejects(changeBudget(f.DB, STAFF, body(), NOW), status(403));
    await assert.rejects(changeBudget(f.DB, { ...STAFF, role: 'manager' }, body(), NOW), status(403));
    await assert.rejects(changeBudget(f.DB, { ...INACTIVE, active: 1 }, body(), NOW), status(403));
    assert.deepEqual(f.snapshot(), before);
  }));

  test('durable retries return the original snapshot after later edits and Toronto month rollover', () => withFixture(async f => {
    const request = body();
    const original = await changeBudget(f.DB, MANAGER, request, NOW);
    await changeBudget(f.DB, MANAGER, body({ budgetCents: 30000, expectedRevision: 1 }), NOW + 1000);
    const beforeRetry = f.snapshot();
    const reordered = Object.fromEntries(Object.entries(request).reverse());
    assert.deepEqual(await changeBudget(f.DB, MANAGER, reordered, NOW + 2000), original);
    const december = Date.parse('2026-12-01T05:00:01Z');
    assert.deepEqual(await changeBudget(f.DB, MANAGER, request, december), original);
    assert.deepEqual(f.snapshot(), beforeRetry);
    assert.equal(f.audit().length, 2);
    await assert.rejects(changeBudget(f.DB, MANAGER, { ...request, requestId: secureId() }, december), status(409));
    assert.deepEqual(f.snapshot(), beforeRetry);
  }));

  test('a Toronto month change during database reads rejects the stale form before any mutation', () => withFixture(async f => {
    await get(f);
    const before = f.snapshot();
    const realNow = Date.now;
    let clock = Date.parse('2026-12-01T04:59:59.900Z');
    const nextMonth = Date.parse('2026-12-01T05:00:00.100Z');
    const wrap = statement => ({
      bind(...args) { return wrap(statement.bind(...args)); },
      async first() { const value = await statement.first(); clock = nextMonth; return value; },
      async all() { const value = await statement.all(); clock = nextMonth; return value; },
      run() { return statement.run(); },
    });
    const crossingDb = { prepare(sql) { return wrap(f.DB.prepare(sql)); }, batch(items) { return f.DB.batch(items); } };
    Date.now = () => clock;
    try {
      await assert.rejects(changeBudget(crossingDb, MANAGER, body()), error => error?.status === 409 && error?.code === 'budget_month_changed');
      assert.deepEqual(f.snapshot(), before);
    } finally { Date.now = realNow; }
  }));

  test('a reused request ID with different payload or actor returns conflict without mutation', () => withFixture(async f => {
    const request = body();
    await changeBudget(f.DB, MANAGER, request, NOW);
    const before = f.snapshot();
    await assert.rejects(changeBudget(f.DB, MANAGER, { ...request, budgetCents: 30000 }, NOW), status(409));
    await assert.rejects(changeBudget(f.DB, MANAGER, { ...request, scope: 'current_and_future' }, NOW), status(409));
    await assert.rejects(changeBudget(f.DB, OTHER_MANAGER, request, NOW), status(409));
    assert.deepEqual(f.snapshot(), before);
  }));

  test('SQL failure rolls back audit, current and future limits, and recurring settings together', () => withFixture(async f => {
    await get(f);
    f.sqlite.prepare("INSERT INTO budgets(month) VALUES('2026-12')").run();
    f.sqlite.exec("CREATE TRIGGER test_budget_settings_failure BEFORE UPDATE ON reward_budget_settings BEGIN SELECT RAISE(ABORT,'injected_settings_failure'); END;");
    const before = f.snapshot();
    await assert.rejects(changeBudget(f.DB, MANAGER, body({ scope: 'current_and_future' }), NOW));
    assert.deepEqual(f.snapshot(), before);
  }));

  test('independent connections sharing one request ID commit one change and return one original response', () => withFixture(async f => {
    await get(f);
    const request = body({ scope: 'current_and_future' });
    const result = await race(f.file, Array.from({ length: 8 }, () => ({ body: request })));
    assert.equal(result.filter(item => item.ok).length, 8, JSON.stringify(result));
    for (const item of result) assert.deepEqual(item.value, result[0].value);
    assert.equal(f.audit().length, 1);
    assert.equal(f.row('2026-11').revision, 1);
    assert.equal(f.settings().revision, 1);
  }));

  test('independent managers with distinct request IDs and the same revisions cannot overwrite each other', () => withFixture(async f => {
    await get(f);
    const result = await race(f.file, [
      { actor: MANAGER, body: body({ budgetCents: 25000, scope: 'current_and_future' }) },
      { actor: OTHER_MANAGER, body: body({ budgetCents: 30000, scope: 'current_and_future' }) },
    ]);
    assert.equal(result.filter(item => item.ok).length, 1, JSON.stringify(result));
    assert.equal(result.filter(item => !item.ok && item.status === 409).length, 1, JSON.stringify(result));
    assert.equal(f.audit().length, 1);
    assert.equal(f.row('2026-11').revision, 1);
    assert.equal(f.settings().revision, 1);
    assert.equal(f.row('2026-11').limit_cents, f.settings().default_monthly_limit_cents);
  }));

  test('HTTP budget PATCH requires active manager authentication and existing CSRF protection', async () => {
    const f = fixture();
    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const publicJwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'budget-http-test', alg: 'RS256', use: 'sig' };
    let providerCalls = 0;
    Date.now = () => NOW;
    globalThis.fetch = async input => {
      if (String(input) === 'https://budget-tests.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [publicJwk] });
      providerCalls++;
      throw new Error('Budget operations must not contact reward or SMS providers');
    };
    const env = { DB: f.DB, APP_ORIGIN: ORIGIN, REWARDS_ENABLED: 'false', SMS_APPROVED: 'false', TERMS_APPROVED: 'false', REWARDS_HMAC_SECRET: 'budget-test-private-hmac-secret-32-bytes', ACCESS_TEAM_DOMAIN: 'budget-tests.cloudflareaccess.com', ACCESS_AUD: 'budget-audience' };
    const jwt = async actor => {
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const content = `${encode({ alg: 'RS256', kid: 'budget-http-test' })}.${encode({ iss: 'https://budget-tests.cloudflareaccess.com', aud: ['budget-audience'], sub: actor.sub, email: actor.email, exp: Math.floor(NOW / 1000) + 600, iat: Math.floor(NOW / 1000) })}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(content));
      return `${content}.${Buffer.from(signature).toString('base64url')}`;
    };
    const request = async ({ actor, method = 'PATCH', origin = ORIGIN, payload = body() } = {}) => handleRequest(new Request(`${ORIGIN}/api/admin/budget`, {
      method, headers: { ...actor ? { 'Cf-Access-Jwt-Assertion': await jwt(actor) } : {}, ...method === 'GET' ? {} : { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' } },
      ...method === 'GET' ? {} : { body: JSON.stringify(payload) },
    }), env);
    try {
      assert.equal((await request()).status, 401);
      assert.equal((await request({ actor: STAFF })).status, 403);
      assert.equal((await request({ actor: INACTIVE })).status, 403);
      assert.equal((await request({ actor: MANAGER, origin: 'https://untrusted.example' })).status, 403);
      const readable = await request({ actor: STAFF, method: 'GET' });
      assert.equal(readable.status, 200);
      assert.equal((await readable.json()).defaultBudgetCents, 10000);
      const updated = await request({ actor: MANAGER, payload: body({ scope: 'current_and_future' }) });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).budgetCents, 25000);
      assert.equal(f.audit().length, 1);
      assert.equal(providerCalls, 0);
      assert.equal(env.REWARDS_ENABLED, 'false');
      assert.equal(env.SMS_APPROVED, 'false');
    } finally {
      Date.now = realNow;
      globalThis.fetch = realFetch;
      f.close();
    }
  });
}
