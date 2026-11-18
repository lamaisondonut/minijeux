import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openReviewDatabase } from './helpers/review-d1.mjs';

const original = readFileSync(new URL('../migrations/0001_rewards.sql', import.meta.url), 'utf8');
const budgetMigration = readFileSync(new URL('../migrations/0002_configurable_budget.sql', import.meta.url), 'utf8');
const discountMigration = readFileSync(new URL('../migrations/0003_manual_discounts.sql', import.meta.url), 'utf8');
// Trigger bodies contain semicolons and nested CASE ... END expressions.
function sqlStatements(sql) {
  const tokens = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|\b[A-Za-z_][A-Za-z_0-9]*\b|;/g;
  const result = [];
  let start = 0, words = [], depth = 0;
  for (const token of sql.matchAll(tokens)) {
    const word = token[0];
    if (/^(?:--|\/\*|'|")/.test(word)) continue;
    const upper = word.toUpperCase();
    const trigger = words[0] === 'CREATE' && words[1] === 'TRIGGER';
    if (trigger && (upper === 'BEGIN' || upper === 'CASE')) depth++;
    if (trigger && upper === 'END') depth--;
    if (word === ';' && (!trigger || depth === 0)) {
      result.push(sql.slice(start, token.index + 1));
      start = token.index + 1; words = []; depth = 0;
    } else if (word !== ';') words.push(upper);
  }
  assert.equal(sql.slice(start).replace(/--[^\n]*/g, '').trim(), '');
  return result;
}
const statements = sqlStatements(discountMigration);
assert.equal(statements.length, 8, 'the migration must be one eight-statement batch');
const now = Date.parse('2026-11-15T17:00:00Z');

async function migrate(DB) {
  await DB.batch(statements.map(sql => DB.prepare(sql)));
}

async function fixture(t, { hardened = true, file = ':memory:' } = {}) {
  const db = openReviewDatabase(file);
  t.after(() => db.sqlite.close());
  db.sqlite.exec(original);
  await db.DB.batch(sqlStatements(budgetMigration).map(sql => db.DB.prepare(sql)));
  db.sqlite.prepare("INSERT INTO budgets(month) VALUES('2026-11')").run();
  db.sqlite.prepare("INSERT INTO sms_daily(day) VALUES('2026-11-15')").run();
  if (hardened) await migrate(db.DB);
  let sequence = 0;
  return {
    ...db,
    reward(overrides = {}) {
      const id = `reward-${++sequence}`;
      const session = `session-${sequence}`;
      const phone = `phone-${sequence}`;
      db.sqlite.prepare(`INSERT INTO sessions(id,owner_hash,seed,width,height,mode,engine_version,month,cap_cents,
        created_at,expires_at,state,reservation_active,score,claim_deadline,bound_phone_hash,first_name,last_name,sms_day,sms_reserved)
        VALUES(?,'owner',1,320,600,'rewards','test','2026-11',2000,?,?,'eligible',1,10000,?,?,'Camille','Essai','2026-11-15',1)`)
        .run(session, now - 1000, now + 600000, now + 600000, phone);
      const row = {
        id, session_id: session, phone_hash: phone, code: `GOAT-${sequence}`, value_cents: 2000,
        month: '2026-11', first_name: 'Camille', last_name: 'Essai', score: 10000,
        confirmed_at: now, claim_by: now + 2592000000, last_actor_sub: 'owner', last_actor_name: 'Joueur vérifié',
        ...overrides,
      };
      const columns = Object.keys(row);
      db.sqlite.prepare(`INSERT INTO rewards(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row));
      return row.id;
    },
    update(id, fields) {
      const columns = Object.keys(fields);
      return db.sqlite.prepare(`UPDATE rewards SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`)
        .run(...Object.values(fields), id);
    },
    row(id) { return db.sqlite.prepare('SELECT * FROM rewards WHERE id=?').get(id); },
    audit(id) { return db.sqlite.prepare('SELECT * FROM audit WHERE reward_id=? ORDER BY id').all(id); },
  };
}

const claim = (overrides = {}) => ({
  status: 'claimed', claimed_by: 'alice', claimed_by_name: 'Alice Noël', claimed_at: now + 1,
  last_actor_sub: 'alice', last_actor_name: 'Alice Noël', ...overrides,
});
const issue = (overrides = {}) => ({
  status: 'issued', issued_by: 'alice', issued_by_name: 'Alice Noël', issued_at: now + 2,
  discount_applied: 1, last_actor_sub: 'alice', last_actor_name: 'Alice Noël', ...overrides,
});
const legacyIssue = () => ({
  status: 'issued', issued_by: 'alice', issued_by_name: 'Alice Noël', issued_at: now + 2,
  lightspeed_ref: 'LS-LEGACY', last_actor_sub: 'alice', last_actor_name: 'Alice Noël',
});
const cancel = (overrides = {}) => ({
  status: 'cancelled', cancelled_by_name: 'Responsable', cancelled_at: now + 3,
  cancel_reason: 'Erreur confirmée en magasin', last_actor_sub: 'manager', last_actor_name: 'Responsable', ...overrides,
});

test('manual discount migration preserves legacy records and never fabricates a discount attestation', async t => {
  const db = await fixture(t, { hardened: false });
  db.reward();
  const claimed = db.reward(); db.update(claimed, claim());
  const issued = db.reward(); db.update(issued, claim()); db.update(issued, legacyIssue());
  const cancelled = db.reward(); db.update(cancelled, cancel());
  const snapshot = () => ['budgets', 'sessions', 'rewards', 'audit'].map(table => db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })));
  const before = snapshot();
  await migrate(db.DB);
  const after = snapshot();
  assert.deepEqual(after.map((rows, index) => index === 2 ? rows.map(({ discount_applied, ...row }) => row) : rows), before);
  assert.ok(after[2].every(row => row.discount_applied === 0));
  assert.equal(db.row(issued).status, 'issued');
  assert.equal(db.row(issued).lightspeed_ref, 'LS-LEGACY');
  const oldAudit = db.audit(issued);
  assert.equal(JSON.parse(oldAudit.at(-1).details).lightspeedRef, 'LS-LEGACY');
  assert.equal(Object.hasOwn(JSON.parse(oldAudit.at(-1).details), 'discountApplied'), false);
  for (const fields of [issue(), cancel(), claim(), { discount_applied: 1 }, { lightspeed_ref: 'changed' }]) {
    assert.throws(() => db.update(issued, fields), /invalid_transition|reward_immutable/);
  }
  assert.deepEqual(db.audit(issued), oldAudit);
  assert.equal(db.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger'").get().count, 12);
});

test('a failed final statement rolls back the column and every trigger replacement together', async t => {
  const db = await fixture(t, { hardened: false });
  const previous = db.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='reward_transition'").get().sql;
  const failed = [...statements.slice(0, -1), 'CREATE TRIGGER reward_allocate invalid'];
  await assert.rejects(db.DB.batch(failed.map(sql => db.DB.prepare(sql))));
  assert.equal(db.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='reward_transition'").get().sql, previous);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE name='reward_initial_state'").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger'").get().count, 11);
  assert.equal(db.sqlite.prepare('PRAGMA table_info(rewards)').all().some(row => row.name === 'discount_applied'), false);
});

test('new rewards must start pending with an ID, valid timestamps and no lifecycle metadata', async t => {
  const db = await fixture(t);
  for (const overrides of [
    { id: null }, { id: '  ' }, { status: 'claimed' }, { status: 'issued' }, { status: 'cancelled' },
    { discount_applied: 1 }, { discount_applied: null },
    { confirmed_at: -1 }, { confirmed_at: 'invalid' }, { claim_by: now }, { claim_by: now + 0.5 },
    { claimed_by: 'alice' }, { claimed_by_name: 'Alice' }, { claimed_at: now },
    { issued_by: 'alice' }, { issued_by_name: 'Alice' }, { issued_at: now },
    { cancelled_by_name: 'Manager' }, { cancelled_at: now }, { lightspeed_ref: 'LS-1' }, { cancel_reason: 'Reason' },
  ]) {
    db.sqlite.exec('SAVEPOINT invalid_insert');
    assert.throws(() => db.reward(overrides), /reward_initial_state/);
    db.sqlite.exec('ROLLBACK TO invalid_insert; RELEASE invalid_insert');
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM rewards').get().count, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM audit').get().count, 0);
});

test('IDs, customer names and award facts remain immutable even during a valid claim', async t => {
  const db = await fixture(t);
  const id = db.reward();
  const initial = db.row(id);
  for (const changes of [
    { id: null }, { id: 'different' }, { first_name: 'Other' }, { last_name: 'Other' },
    { session_id: 'different' }, { phone_hash: 'different' }, { code: 'different' }, { value_cents: 500 },
    { score: 11000 }, { month: '2026-12' }, { confirmed_at: now - 1 }, { claim_by: now + 1000 },
    { lightspeed_ref: 'new-reference' },
  ]) assert.throws(() => db.update(id, claim(changes)), /reward_immutable/);
  assert.deepEqual(db.row(id), initial);
  assert.equal(db.audit(id).length, 1);
});

test('issuance and cancellation preserve the established claim identity, name and time', async t => {
  const db = await fixture(t);
  for (const finish of [issue, cancel]) {
    const id = db.reward();
    db.update(id, claim());
    const established = db.row(id);
    for (const changes of [
      { claimed_by: null }, { claimed_by: 'bob' }, { claimed_by_name: null },
      { claimed_by_name: 'Bob' }, { claimed_at: null }, { claimed_at: now },
    ]) assert.throws(() => db.update(id, finish(changes)), /claim_immutable/);
    assert.deepEqual(db.row(id), established);
    db.update(id, finish());
    const result = db.row(id);
    assert.deepEqual([result.claimed_by, result.claimed_by_name, result.claimed_at], ['alice', 'Alice Noël', now + 1]);
    assert.deepEqual(db.audit(id).map(row => row.action), ['confirmed', 'claimed', finish === issue ? 'issued' : 'cancelled']);
  }
});

test('claim requires an actor, integer time before expiry and matching audit identity', async t => {
  const db = await fixture(t);
  const id = db.reward();
  for (const changes of [
    { claimed_by: null }, { claimed_by: '' }, { claimed_by_name: ' ' }, { claimed_at: null },
    { claimed_at: now - 1 }, { claimed_at: now + 2592000000 }, { claimed_at: now + 0.5 },
    { last_actor_sub: 'bob' }, { last_actor_name: 'Bob' },
    { issued_at: now + 2 }, { cancel_reason: 'premature' },
  ]) assert.throws(() => db.update(id, claim(changes)), /invalid_claim/);
  assert.throws(() => db.update(id, claim({ discount_applied: 1 })), /discount_immutable/);
  assert.equal(db.row(id).status, 'pending');
  assert.equal(db.audit(id).length, 1);
});

test('only the original claimant can confirm an applied manual discount without a POS reference', async t => {
  const db = await fixture(t);
  const id = db.reward(); db.update(id, claim());
  for (const changes of [
    { issued_by: 'bob', last_actor_sub: 'bob' }, { issued_by: null }, { issued_by_name: ' ' },
    { issued_at: null }, { issued_at: now }, { issued_at: now + 1.5 },
    { last_actor_sub: 'bob' }, { last_actor_name: 'Bob' }, { cancel_reason: 'unexpected' },
  ]) assert.throws(() => db.update(id, issue(changes)), /claim_owner_required/);
  for (const discount_applied of [0, null, 2]) {
    assert.throws(() => db.update(id, issue({ discount_applied })), /discount_confirmation_required/);
  }
  const withoutConfirmation = issue(); delete withoutConfirmation.discount_applied;
  assert.throws(() => db.update(id, withoutConfirmation), /discount_confirmation_required/);
  assert.equal(db.row(id).status, 'claimed');
  db.update(id, issue());
  assert.equal(db.row(id).lightspeed_ref, null);
  assert.equal(db.row(id).discount_applied, 1);
  assert.deepEqual(db.audit(id).map(row => [row.action, row.created_at]), [['confirmed', now], ['claimed', now + 1], ['issued', now + 2]]);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 2000, reserved_cents: 0 });
  const audit = db.audit(id).map(row => JSON.parse(row.details));
  assert.deepEqual(audit.map(row => [row.valueCents, row.discountApplied]), [[2000, false], [2000, false], [2000, true]]);
});

test('cancellation requires coherent metadata and preserves usage without claiming DB authentication', async t => {
  const db = await fixture(t);
  const pending = db.reward();
  for (const changes of [
    { cancel_reason: null }, { cancel_reason: '' }, { cancel_reason: '  ' }, { cancel_reason: 'x'.repeat(501) },
    { cancelled_by_name: null }, { cancelled_at: null }, { cancelled_at: now - 1 }, { cancelled_at: now + 0.5 },
    { last_actor_sub: '' }, { last_actor_name: 'Other' }, { claimed_by: 'alice' },
  ]) assert.throws(() => db.update(pending, cancel(changes)), /invalid_cancellation/);
  db.update(pending, cancel());
  const claimed = db.reward(); db.update(claimed, claim());
  assert.throws(() => db.update(claimed, cancel({ cancelled_at: now })), /invalid_cancellation/);
  db.update(claimed, cancel());
  assert.throws(() => db.update(claimed, claim()), /invalid_transition/);
  assert.throws(() => db.update(claimed, issue()), /invalid_transition/);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 4000, reserved_cents: 0 });
  // The SQL layer validates supplied data; only the API authenticates a manager.
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) count FROM employees').get().count, 0);
});

test('invalid transitions and repeated SQL updates create no additional audit event', async t => {
  const db = await fixture(t);
  const id = db.reward();
  assert.throws(() => db.update(id, issue()), /invalid_transition/);
  assert.throws(() => db.update(id, { status: 'pending' }), /invalid_transition/);
  db.update(id, claim());
  assert.throws(() => db.update(id, claim()), /invalid_transition/);
  db.update(id, issue());
  assert.throws(() => db.update(id, issue()), /invalid_transition/);
  assert.throws(() => db.update(id, cancel()), /invalid_transition/);
  assert.deepEqual(db.audit(id).map(row => row.action), ['confirmed', 'claimed', 'issued']);
});

test('manual discount completion fails closed on the original schema', async t => {
  const db = await fixture(t, { hardened: false });
  const id = db.reward(); db.update(id, claim());
  assert.throws(() => db.update(id, issue()), /no such column: discount_applied/);
  assert.equal(db.row(id).status, 'claimed');
  assert.deepEqual(db.audit(id).map(row => row.action), ['confirmed', 'claimed']);
});

test('malformed legacy claims cannot become an attested manual discount', async t => {
  const db = await fixture(t, { hardened: false });
  const id = db.reward({ status: 'claimed', claimed_by: 'alice', claimed_by_name: 'Alice Noël' });
  await migrate(db.DB);
  assert.throws(() => db.update(id, issue()), /claim_owner_required/);
  assert.equal(db.row(id).discount_applied, 0);
  assert.deepEqual(db.audit(id).map(row => row.action), ['confirmed']);
});

test('each 5, 10 and 20 dollar discount records its exact amount and explicit completion', async t => {
  const db = await fixture(t);
  for (const value_cents of [500, 1000, 2000]) {
    const id = db.reward({ value_cents });
    assert.equal(db.row(id).discount_applied, 0);
    db.update(id, claim()); db.update(id, issue());
    assert.deepEqual(JSON.parse(db.audit(id).at(-1).details), {
      valueCents: value_cents, discountApplied: true, reason: null,
    });
  }
  assert.deepEqual({ ...db.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets').get() }, { used_cents: 3500, reserved_cents: 0 });
});

test('two staff connections race for one code; only its claimant can complete it once', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boreal-manual-discount-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'rewards.sqlite');
  const db = await fixture(t, { file });
  db.sqlite.exec('PRAGMA journal_mode=WAL');
  const id = db.reward();
  const barrier = new SharedArrayBuffer(4);
  const workers = [];
  let ready = 0;
  const workerSource = `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const db = new DatabaseSync(workerData.file);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
    try {
      const { actor, name, now, id } = workerData;
      const row = db.prepare("UPDATE rewards SET status='claimed',claimed_by=?,claimed_by_name=?,claimed_at=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='pending' AND claim_by>? RETURNING id")
        .get(actor, name, now + 1, actor, name, id, now + 1);
      parentPort.postMessage({ claimed: !!row, actor, name });
    } catch (error) { parentPort.postMessage({ error: error.message }); }
    finally { db.close(); }
  `;
  try {
    const results = await Promise.all([
      { actor: 'alice', name: 'Alice Noël' }, { actor: 'bob', name: 'Bob Hiver' },
    ].map(employee => new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, { eval: true, workerData: { ...employee, file, barrier, now, id } });
      workers.push(worker);
      let result;
      worker.on('message', message => {
        if (message.ready) {
          if (++ready === 2) {
            Atomics.store(new Int32Array(barrier), 0, 1);
            Atomics.notify(new Int32Array(barrier), 0, 2);
          }
        } else result = message;
      });
      worker.once('error', reject);
      worker.once('exit', code => {
        if (code || !result || result.error) reject(new Error(result?.error || `Claim worker exited ${code}`));
        else resolve(result);
      });
    })));
    assert.deepEqual(results.map(result => result.claimed).sort(), [false, true]);
    const winner = results.find(result => result.claimed);
    const loser = results.find(result => !result.claimed);
    assert.equal(db.row(id).claimed_by, winner.actor);
    assert.throws(() => db.update(id, issue({
      issued_by: loser.actor, issued_by_name: loser.name, last_actor_sub: loser.actor, last_actor_name: loser.name,
    })), /claim_owner_required/);
    const completion = issue({
      issued_by: winner.actor, issued_by_name: winner.name, last_actor_sub: winner.actor, last_actor_name: winner.name,
    });
    db.update(id, completion);
    assert.throws(() => db.update(id, completion), /invalid_transition/);
    assert.equal(db.row(id).status, 'issued');
    assert.equal(db.row(id).discount_applied, 1);
    assert.deepEqual(db.audit(id).map(row => row.action), ['confirmed', 'claimed', 'issued']);
  } finally {
    await Promise.allSettled(workers.map(worker => worker.terminate()));
  }
});
