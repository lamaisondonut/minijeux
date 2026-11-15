import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import test from 'node:test';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { award, cleanup, reserveSmsQuota, reserveSmsSend, startSession } from '../server/store.mjs';
import { handleRequest } from '../server/api.mjs';
import { POLICY_VERSION, secureId, torontoDay } from '../server/common.mjs';
import { privateHmac, signChallenge } from '../server/sms.mjs';

const ORIGIN = 'https://rewards-concurrency.example';
const baseEnv = {
  APP_ORIGIN: ORIGIN,
  REWARDS_ENABLED: 'true', SMS_APPROVED: 'true', TERMS_APPROVED: 'true',
  SMS_PROVIDER: 'twilio', SMS_DAILY_LIMIT: '8',
  REWARDS_HMAC_SECRET: 'independent-concurrency-test-hmac-secret-32-bytes',
  TURNSTILE_SECRET: 'concurrency-turnstile-secret', TURNSTILE_SITE_KEY: 'concurrency-site-key',
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'concurrency-test-provider-token',
  TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`,
  ACCESS_TEAM_DOMAIN: 'rewards-concurrency.cloudflareaccess.com', ACCESS_AUD: 'concurrency-audience',
};

function request(path, body, headers = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Each worker has its own connection, Node runtime, production module imports,
// and transaction. The shared barrier releases all requests together.
if (!isMainThread) {
  const { file, barrier, operation, args, env = {}, fetchResponse } = workerData;
  const { sqlite, DB } = openReviewDatabase(file);
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return Response.json(fetchResponse);
  };
  parentPort.postMessage({ ready: true });
  Atomics.wait(new Int32Array(barrier), 0, 0);
  try {
    let value;
    if (operation === 'start') value = await startSession(DB, args);
    else if (operation === 'award') value = await award(DB, args);
    else if (operation === 'cleanup') value = await cleanup(DB, args.now);
    else if (operation === 'quota') value = await reserveSmsQuota(DB, args.day, args.limit);
    else if (operation === 'sendSlot') value = await reserveSmsSend(DB, args);
    else if (operation === 'api') {
      const response = await handleRequest(request(args.path, args.body, args.headers), { ...baseEnv, ...env, DB });
      value = { status: response.status, body: await response.json(), providerCalls };
    } else throw new Error('Unknown worker operation');
    parentPort.postMessage({ ok: true, value });
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error.message, code: error.code });
  } finally {
    sqlite.close();
  }
} else {
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'boreal-d1-concurrency-'));
    const file = join(directory, 'rewards.sqlite');
    const database = openReviewDatabase(file);
    database.sqlite.exec('PRAGMA journal_mode=WAL;');
    database.sqlite.exec(readFileSync(new URL('../migrations/0001_rewards.sql', import.meta.url), 'utf8'));
    return { ...database, file, close() { database.sqlite.close(); rmSync(directory, { recursive: true, force: true }); } };
  }

  async function race(file, operations) {
    const barrier = new SharedArrayBuffer(4);
    const workers = [];
    let ready = 0;
    try {
      return await Promise.all(operations.map(operation => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { file, barrier, ...operation } });
        workers.push(worker);
        let result;
        worker.on('message', message => {
          if (message.ready) {
            if (++ready === operations.length) {
              Atomics.store(new Int32Array(barrier), 0, 1);
              Atomics.notify(new Int32Array(barrier), 0, operations.length);
            }
          } else result = message;
        });
        worker.once('error', reject);
        worker.once('exit', code => {
          if (code !== 0 || !result) reject(new Error(`SQLite worker exited without a result (${code})`));
          else resolve(result);
        });
      })));
    } finally {
      await Promise.allSettled(workers.map(worker => worker.terminate()));
    }
  }

  function startArgs(now, overrides = {}) {
    return { id: secureId(), ownerHash: secureId(), seed: 1, width: 360, height: 640,
      engineVersion: 'concurrency-fixture', month: '2026-11', now,
      expiresAt: now + 30 * 60000, allowRewards: true, quotaDay: torontoDay(now), quotaLimit: 100, ...overrides };
  }

  async function eligible(f, now, overrides = {}) {
    const args = startArgs(now, overrides);
    const row = await startSession(f.DB, args);
    f.sqlite.prepare("UPDATE sessions SET state='eligible',score=10000,claim_deadline=?,bound_phone_hash=?,first_name='Test',last_name='Player' WHERE id=?")
      .run(now + 10 * 60000, overrides.phoneHash ?? 'same-verified-phone', row.id);
    return { ...args, sessionId: row.id, phoneHash: overrides.phoneHash ?? 'same-verified-phone' };
  }

  async function signedJwt(key, payload) {
    const body = [{ alg: 'RS256', kid: 'concurrency-key' }, payload]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(signature).toString('base64url')}`;
  }

  test('32 real SQLite connections reserve the $100 cap once, and expiry releases once', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      const results = await race(f.file, Array.from({ length: 32 }, () => ({ operation: 'start', args: startArgs(now) })));
      assert.equal(results.filter(result => !result.ok).length, 0);
      assert.equal(results.filter(result => result.value.mode === 'rewards').length, 5);
      assert.equal(results.filter(result => result.value.mode === 'extreme').length, 27);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 0, reserved_cents: 10000 });
      const expired = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'cleanup', args: { now: now + 30 * 60000 } })));
      assert.ok(expired.every(result => result.ok));
      assert.equal(f.sqlite.prepare('SELECT reserved_cents FROM budgets').get().reserved_cents, 0);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE reservation_active=1').get().n, 0);
    } finally { f.close(); }
  });

  test('16 starts from one owner create exactly one reserved game', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      const results = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'start', args: startArgs(now, { ownerHash: 'same-owner' }) })));
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(results.filter(result => result.code === 'session_pending').length, 15);
      assert.equal(f.sqlite.prepare('SELECT reserved_cents FROM budgets').get().reserved_cents, 2000);
    } finally { f.close(); }
  });

  test('24 award retries return one code; competing sessions for one phone award only once', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      const one = await eligible(f, now);
      const retries = await race(f.file, Array.from({ length: 24 }, () => ({ operation: 'award', args: { ...one, now } })));
      assert.ok(retries.every(result => result.ok && result.value.reward));
      assert.equal(new Set(retries.map(result => result.value.reward.id)).size, 1);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rewards').get().n, 1);
      const two = await eligible(f, now);
      const competitors = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'award', args: { ...two, now } })));
      assert.ok(competitors.every(result => result.ok && result.value.reason === 'phone_cooldown'));
      assert.deepEqual({ ...f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 2000, reserved_cents: 2000 });
    } finally { f.close(); }
  });

  test('two winning sessions racing for the same phone produce one reward', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      const runs = [await eligible(f, now), await eligible(f, now)];
      const results = await race(f.file, Array.from({ length: 24 }, (_, index) => ({
        operation: 'award', args: { ...runs[index % 2], now },
      })));
      assert.ok(results.every(result => result.ok));
      assert.equal(results.filter(result => result.value.reward).length, 12);
      assert.equal(results.filter(result => result.value.reason === 'phone_cooldown').length, 12);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rewards').get().n, 1);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 2000, reserved_cents: 2000 });
    } finally { f.close(); }
  });

  test('racing starts reserve the largest affordable cap and awards honor that announced cap', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      f.sqlite.prepare("INSERT INTO budgets(month,used_cents) VALUES('2026-11',8500)").run();
      const results = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'start', args: startArgs(now) })));
      assert.ok(results.every(result => result.ok));
      assert.equal(results.filter(result => result.value.cap_cents === 1000).length, 1);
      assert.equal(results.filter(result => result.value.cap_cents === 500).length, 1);
      assert.equal(results.filter(result => result.value.mode === 'extreme').length, 14);
      const winningRuns = results.filter(result => result.value.cap_cents > 0).map(result => result.value);
      for (const run of winningRuns) {
        f.sqlite.prepare("UPDATE sessions SET state='eligible',score=10000,claim_deadline=?,bound_phone_hash=?,first_name='Test',last_name='Player' WHERE id=?")
          .run(now + 600000, run.id, run.id);
      }
      const awards = await race(f.file, winningRuns.map(run => ({ operation: 'award', args: {
        sessionId: run.id, ownerHash: run.owner_hash, phoneHash: run.id, now,
      } })));
      assert.ok(awards.every(result => result.ok && result.value.reward));
      assert.deepEqual(awards.map(result => result.value.reward.value_cents).sort((a, b) => a - b), [500, 1000]);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 10000, reserved_cents: 0 });
    } finally { f.close(); }
  });

  test('the actual SMS quota SQL admits exactly 8 of 32 simultaneous callers', async () => {
    const f = fixture();
    try {
      const results = await race(f.file, Array.from({ length: 32 }, () => ({ operation: 'quota', args: { day: '2026-11-14', limit: 8 } })));
      assert.ok(results.every(result => result.ok));
      assert.equal(results.filter(result => result.value).length, 8);
      assert.equal(f.sqlite.prepare('SELECT count FROM sms_daily').get().count, 8);
      assert.equal((await reserveSmsQuota(f.DB, '2026-11-15', 8)).count, 1);
      assert.equal(f.sqlite.prepare('SELECT count FROM sms_daily WHERE day=?').get('2026-11-14').count, 8);
    } finally { f.close(); }
  });

  test('a reserved first SMS survives quota saturation and midnight; competing sends consume it once', async () => {
    const f = fixture();
    try {
      const now = Date.parse('2026-11-15T04:59:00Z');
      const run = await eligible(f, now, { quotaLimit: 1 });
      assert.deepEqual({ ...f.sqlite.prepare('SELECT day,count,reserved FROM sms_daily').get() },
        { day: '2026-11-14', count: 0, reserved: 1 });
      // Saturate the dispatch day too: the reserved first slot still belongs
      // to this already-promised game and is charged to its allocation day.
      f.sqlite.prepare("INSERT INTO sms_daily(day,count) VALUES('2026-11-15',1)").run();
      const results = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'sendSlot', args: {
        sessionId: run.sessionId, ownerHash: run.ownerHash, dispatchDay: '2026-11-15', limit: 1, now: now + 120000,
      } })));
      assert.ok(results.every(result => result.ok));
      assert.equal(results.filter(result => result.value).length, 1);
      assert.deepEqual(results.find(result => result.value).value, { day: '2026-11-14', reserved: true });
      assert.deepEqual({ ...f.sqlite.prepare("SELECT count,reserved FROM sms_daily WHERE day='2026-11-14'").get() }, { count: 1, reserved: 0 });
      assert.equal(f.sqlite.prepare("SELECT count FROM sms_daily WHERE day='2026-11-15'").get().count, 1);
      await cleanup(f.DB, now + 31 * 60000);
      assert.deepEqual({ ...f.sqlite.prepare("SELECT count,reserved FROM sms_daily WHERE day='2026-11-14'").get() }, { count: 1, reserved: 0 });
    } finally { f.close(); }
  });

  test('SMS slots bound simultaneous starts and unused slots release exactly once on expiry', async () => {
    const f = fixture();
    try {
      const now = Date.now(), day = torontoDay(now);
      const results = await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'start', args: startArgs(now, { quotaLimit: 2 }) })));
      assert.equal(results.filter(result => result.ok).length, 2);
      assert.equal(results.filter(result => result.code === 'sms_daily_limit').length, 14);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT count,reserved FROM sms_daily WHERE day=?').get(day) }, { count: 0, reserved: 2 });
      await race(f.file, Array.from({ length: 16 }, () => ({ operation: 'cleanup', args: { now: now + 30 * 60000 } })));
      assert.deepEqual({ ...f.sqlite.prepare('SELECT count,reserved FROM sms_daily WHERE day=?').get(day) }, { count: 0, reserved: 0 });
      const next = await startSession(f.DB, startArgs(now + 30 * 60000, { quotaLimit: 2 }));
      assert.equal(next.mode, 'rewards');
      assert.equal(f.sqlite.prepare('SELECT reserved_cents FROM budgets').get().reserved_cents, 2000);
    } finally { f.close(); }
  });

  test('24 authenticated claim requests use the code once and lock issuance to that employee', async () => {
    const f = fixture();
    try {
      const now = Date.now();
      const run = await eligible(f, now);
      const { reward } = await award(f.DB, { ...run, now });
      const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
      const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'concurrency-key', alg: 'RS256', use: 'sig' };
      const tokens = [];
      for (let index = 0; index < 24; index++) {
        const sub = `employee-${index}`, email = `employee${index}@example.com`;
        f.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,'staff')").run(sub, email, `Employee ${index}`);
        tokens.push(await signedJwt(keys.privateKey, { iss: `https://${baseEnv.ACCESS_TEAM_DOMAIN}`,
          aud: [baseEnv.ACCESS_AUD], sub, email, exp: Math.floor(now / 1000) + 300 }));
      }
      const results = await race(f.file, tokens.map(token => ({ operation: 'api', fetchResponse: { keys: [jwk] },
        args: { path: `/api/admin/rewards/${reward.id}/claim`, body: {}, headers: { 'Cf-Access-Jwt-Assertion': token } } })));
      assert.ok(results.every(result => result.ok));
      assert.equal(results.filter(result => result.value.status === 200).length, 1);
      assert.equal(results.filter(result => result.value.status === 409).length, 23);
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM audit WHERE action='claimed'").get().n, 1);
      const claimed = f.sqlite.prepare('SELECT * FROM rewards').get();
      const winner = Number(claimed.claimed_by.split('-')[1]);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json({ keys: [jwk] });
      try {
        const issue = async index => handleRequest(request(`/api/admin/rewards/${reward.id}/issue`, { lightspeedRef: 'LS-UNIQUE' },
          { 'Cf-Access-Jwt-Assertion': tokens[index] }), { ...baseEnv, DB: f.DB });
        assert.equal((await issue((winner + 1) % 24)).status, 409);
        assert.equal((await issue(winner)).status, 200);
        assert.equal((await issue(winner)).status, 200);
      } finally { globalThis.fetch = originalFetch; }
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM audit WHERE action='issued'").get().n, 1);
      const issued = f.sqlite.prepare('SELECT * FROM rewards').get();
      assert.equal(issued.issued_by, claimed.claimed_by);
      assert.equal(issued.claimed_by_name, `Employee ${winner}`);
      assert.equal(issued.issued_by_name, `Employee ${winner}`);
    } finally { f.close(); }
  });

  test('concurrent OTP checks cannot exceed five provider attempts', async () => {
    const f = fixture();
    try {
      const now = Date.now(), phone = '+15145551234', rawOwner = secureId(32);
      const ownerHash = await privateHmac(baseEnv, 'owner', rawOwner);
      const phoneHash = await privateHmac(baseEnv, 'phone', phone);
      const run = await eligible(f, now, { ownerHash, phoneHash });
      const challengeId = secureId(), providerSid = `VE${'3'.repeat(32)}`;
      f.sqlite.prepare("INSERT INTO challenges(id,owner_hash,session_id,phone_hash,created_at,expires_at,state,provider_sid,consent_version,first_name,last_name) VALUES(?,?,?,?,?,?,'pending',?,?, 'Test','Player')")
        .run(challengeId, ownerHash, run.sessionId, phoneHash, now, now + 600000, providerSid, POLICY_VERSION);
      const token = await signChallenge(baseEnv, { challengeId, ownerHash, sessionId: run.sessionId, phoneHash, expiresAt: Math.floor((now + 600000) / 1000) });
      const args = { path: '/api/rewards/sms/verify', body: { challengeId: token, phone, code: '000000' },
        headers: { Cookie: `__Host-rewards-owner=${rawOwner}`, 'CF-Connecting-IP': '192.0.2.10' } };
      const fetchResponse = { service_sid: baseEnv.TWILIO_VERIFY_SERVICE_SID, sid: providerSid, to: phone, status: 'pending', valid: false };
      const results = await race(f.file, Array.from({ length: 12 }, () => ({ operation: 'api', args, fetchResponse })));
      assert.ok(results.every(result => result.ok));
      let calls = results.reduce((sum, result) => sum + result.value.providerCalls, 0);
      assert.ok(calls <= 5);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => { calls++; return Response.json(fetchResponse); };
      try {
        // Finish the bounded allowance if the race mostly found an active lease.
        for (let retry = 0; retry < 5; retry++) {
          const challenge = f.sqlite.prepare('SELECT attempts,state FROM challenges').get();
          if (challenge.attempts === 5) break;
          // Use a separate owner rate window after concurrent requests; this
          // does not alter the challenge attempt counter under review.
          f.sqlite.prepare('DELETE FROM rate_limits').run();
          await handleRequest(request(args.path, args.body, args.headers), { ...baseEnv, DB: f.DB });
        }
      } finally { globalThis.fetch = originalFetch; }
      const challenge = f.sqlite.prepare('SELECT attempts,state FROM challenges').get();
      assert.equal(challenge.attempts, 5);
      assert.equal(challenge.state, 'failed');
      assert.equal(calls, 5);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rewards').get().n, 0);
    } finally { f.close(); }
  });

  test('different approved phones racing for one session bind one phone and issue one code', async () => {
    const f = fixture();
    try {
      const now = Date.now(), rawOwner = secureId(32);
      const ownerHash = await privateHmac(baseEnv, 'owner', rawOwner);
      const run = await eligible(f, now, { ownerHash });
      f.sqlite.prepare('UPDATE sessions SET bound_phone_hash=NULL WHERE id=?').run(run.sessionId);
      const operations = [];
      const phones = ['+15145551234', '+15145551235'];
      const hashes = [];
      for (let index = 0; index < phones.length; index++) {
        const phone = phones[index];
        const phoneHash = await privateHmac(baseEnv, 'phone', phone);
        hashes.push(phoneHash);
        const challengeId = secureId(), providerSid = `VE${String(index + 3).repeat(32)}`;
        f.sqlite.prepare("INSERT INTO challenges(id,owner_hash,session_id,phone_hash,created_at,expires_at,state,provider_sid,consent_version,first_name,last_name) VALUES(?,?,?,?,?,?,'pending',?,?,?, 'Player')")
          .run(challengeId, ownerHash, run.sessionId, phoneHash, now, now + 600000, providerSid, POLICY_VERSION, `Phone ${index}`);
        const token = await signChallenge(baseEnv, { challengeId, ownerHash, sessionId: run.sessionId, phoneHash,
          expiresAt: Math.floor((now + 600000) / 1000) });
        operations.push({ operation: 'api', args: { path: '/api/rewards/sms/verify',
          body: { challengeId: token, phone, code: '123456' },
          headers: { Cookie: `__Host-rewards-owner=${rawOwner}`, 'CF-Connecting-IP': '192.0.2.10' } },
          fetchResponse: { service_sid: baseEnv.TWILIO_VERIFY_SERVICE_SID, sid: providerSid, to: phone,
            status: 'approved', valid: true } });
      }
      const results = await race(f.file, operations);
      assert.ok(results.every(result => result.ok && [200, 409].includes(result.value.status)));
      assert.equal(results.filter(result => result.value.body.awarded === true).length, 1);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rewards').get().n, 1);
      const reward = f.sqlite.prepare('SELECT * FROM rewards').get();
      const winner = hashes.indexOf(reward.phone_hash);
      assert.ok(winner >= 0);
      assert.equal(reward.first_name, `Phone ${winner}`);
      assert.equal(f.sqlite.prepare('SELECT bound_phone_hash FROM sessions').get().bound_phone_hash, reward.phone_hash);
      assert.deepEqual({ ...f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 2000, reserved_cents: 0 });
    } finally { f.close(); }
  });
}
