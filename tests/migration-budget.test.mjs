import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { migrationFiles, migrationSql as fullMigrationSql, splitMigration } from './helpers/migrations.cjs';
import { changeBudget } from '../server/budget.mjs';

// Exercise the actual migrations and production budget store against local workerd D1.
// HTTP authentication and multi-process races are covered in budget-api.test.mjs.
const require = createRequire(import.meta.url);
const miniflarePath = process.env.MINIFLARE_MODULE || require.resolve('miniflare');
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflarePath).href);
const originalSql = readFileSync(new URL('../migrations/0001_rewards.sql', import.meta.url), 'utf8');
const migrationSql = readFileSync(new URL('../migrations/0002_configurable_budget.sql', import.meta.url), 'utf8');

// Preserve complete CREATE TRIGGER ... BEGIN ... CASE ... END ... END blocks.
// A plain split(';') would silently corrupt both the original and proposed SQL.
function statements(sql) {
  const tokenPattern = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|\b[A-Za-z_][A-Za-z_0-9]*\b|;/g;
  const result = [];
  let start = 0;
  let words = [];
  let depth = 0;
  for (const token of sql.matchAll(tokenPattern)) {
    const text = token[0];
    if (/^(?:--|\/\*|'|"|`|\[)/.test(text)) continue;
    const upper = text.toUpperCase();
    const trigger = words[0] === 'CREATE' && words[1] === 'TRIGGER';
    if (trigger && (upper === 'BEGIN' || upper === 'CASE')) depth++;
    if (trigger && upper === 'END') depth--;
    if (text === ';' && (!trigger || depth === 0)) {
      result.push(sql.slice(start, token.index + 1));
      start = token.index + 1;
      words = [];
      depth = 0;
    } else if (text !== ';') words.push(upper);
  }
  assert.equal(sql.slice(start).replace(/--[^\n]*/g, '').trim(), '', 'No incomplete final statement');
  return result;
}

const original = statements(originalSql);
const migration = statements(migrationSql);
const BASE_NOW = Date.parse('2026-11-15T12:00:00Z');
const originalTables = ['budgets', 'sessions', 'challenges', 'rewards', 'audit', 'sms_daily', 'employees', 'rate_limits'];

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'boreal-budget-d1-'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {}', compatibilityDate: '2026-11-15',
    d1Databases: { DB: 'budget-migration-test', EMPTY: 'budget-preview-empty' }, resourcePersistencePath: directory,
  }));
  const db = await mf.getD1Database('DB');
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const all = async sql => (await db.prepare(sql).all()).results;
  const snapshot = async () => Object.fromEntries(await Promise.all(originalTables.map(async table => [table, await all(`SELECT * FROM ${table} ORDER BY rowid`)])));
  const budget = async month => (await db.prepare('SELECT * FROM budgets WHERE month=?').bind(month).first());
  const settings = () => db.prepare('SELECT * FROM reward_budget_settings WHERE id=1').first();
  await db.batch(original.map(sql => db.prepare(sql)));
  await run("INSERT INTO employees(sub,email,name,role) VALUES('manager','test@example.invalid','Manager','manager')");
  await run("INSERT INTO employees(sub,email,name,role) VALUES('manager2','test2@example.invalid','Manager Two','manager')");
  await run("INSERT INTO rate_limits(key,window_start,count) VALUES('test',0,1)");
  await run("INSERT INTO sms_daily(day) VALUES('2026-11-15')");
  const seed = async (sid, month, phone) => {
    await run('INSERT OR IGNORE INTO budgets(month) VALUES(?)', month);
    await run(`INSERT INTO sessions(id,owner_hash,seed,width,height,mode,engine_version,month,cap_cents,created_at,expires_at,reservation_active,score,claim_deadline,bound_phone_hash,first_name,last_name,sms_day,sms_reserved,state)
      VALUES(?,?,1,360,640,'rewards','test',?,2000,${BASE_NOW},${BASE_NOW + 100000},1,10000,${BASE_NOW + 100000},?,'Jane','Doe','2026-11-15',1,'eligible')`, sid, 'owner-' + sid, month, phone);
  };
  const award = async (sid, month, phone) => {
    const modern=(await all('PRAGMA table_info(rewards)')).some(c=>c.name==='device_hash');
    return run(`INSERT INTO rewards(id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,last_actor_sub,last_actor_name${modern?',device_hash':''})
      VALUES(?,?,?,?,2000,?,'Jane','Doe',10000,${BASE_NOW+1000},${BASE_NOW+1000+2592000000},'test','Tester'${modern?',?':''})`, 'r-'+sid,sid,phone,'code-'+sid,month,...modern?['owner-'+sid]:[]);
  };
  await seed('past', '2026-10', 'past-phone');
  await award('past', '2026-10', 'past-phone');
  await seed('active', '2026-11', 'active-phone');
  await run(`INSERT INTO challenges(id,owner_hash,session_id,phone_hash,created_at,expires_at,state,consent_version,first_name,last_name)
    VALUES('c','owner-active','active','active-phone',${BASE_NOW},${BASE_NOW + 100000},'verified','v1','Jane','Doe')`);

  let requestNumber = 0;
  const change = async ({ limit, scope = 'month_only', monthRevision, defaultRevision, actor = 'manager', now = BASE_NOW + 2000, fail = false }) => {
    const changeDb = fail ? {
      prepare: sql => db.prepare(sql),
      batch: items => db.batch([...items, db.prepare('SELECT * FROM deliberately_missing_budget_test_table')]),
    } : db;
    try {
      await changeBudget(changeDb, { sub: actor, role: 'manager' }, {
        month: '2026-11', budgetCents: limit, scope, expectedRevision: monthRevision,
        expectedDefaultRevision: defaultRevision, requestId: 'migration-budget-request-' + (++requestNumber),
      }, now);
      return true;
    } catch (error) {
      if (error.status === 409 && ['budget_conflict', 'budget_below_committed'].includes(error.code)) return false;
      throw error;
    }
  };
  const createMonth = month => run(`INSERT INTO budgets(month,limit_cents)
    SELECT ?,default_monthly_limit_cents FROM reward_budget_settings WHERE id=1
    ON CONFLICT(month) DO NOTHING`, month);
  return { db, emptyDb: await mf.getD1Database('EMPTY'), run, all, snapshot, budget, settings, seed, award, change, createMonth,
    async close() { await mf.dispose(); rmSync(directory, { recursive: true, force: true }); } };
}

test('configurable budgets preserve data and enforce scopes in real local D1', async t => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    const triggers = await f.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name");
    const indexes = await f.all("SELECT name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name");
    await t.test('original SQL retains all 26 statements and 11 complete triggers', async () => {
      assert.equal(original.length, 26);
      assert.equal(triggers.length, 11);
      assert.equal(indexes.length, 6);
      assert.equal((await f.all('PRAGMA foreign_keys'))[0].foreign_keys, 1);
      assert.deepEqual(await f.all('SELECT * FROM pragma_foreign_key_check'), []);
    });
    await t.test('legacy NULL month and fractional balances abort without changing installed schema or data', async () => {
      for (const [introduce, repair] of [
        ['INSERT INTO budgets(month) VALUES(NULL)', 'DELETE FROM budgets WHERE month IS NULL'],
        ["UPDATE budgets SET used_cents=0.5 WHERE month='2026-11'", "UPDATE budgets SET used_cents=0 WHERE month='2026-11'"],
        ["UPDATE budgets SET reserved_cents=2000.5 WHERE month='2026-11'", "UPDATE budgets SET reserved_cents=2000 WHERE month='2026-11'"],
      ]) {
        await f.run(introduce);
        const invalidBefore = await f.snapshot();
        await assert.rejects(f.db.batch(migration.map(sql => f.db.prepare(sql))), /(?:CHECK|NOT NULL) constraint failed/);
        assert.deepEqual(await f.snapshot(), invalidBefore);
        assert.deepEqual(await f.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"), triggers);
        assert.deepEqual(await f.all("SELECT name FROM sqlite_schema WHERE name IN ('budgets_new','reward_budget_settings','_budget_migration_guard')"), []);
        await f.run(repair);
      }
    });
    await t.test('a missing copied parent fails SQL guard and rolls back every table and trigger', async () => {
      const fault = [...migration];
      const drop = fault.findIndex(sql => /^\s*DROP TABLE budgets;/.test(sql));
      assert.ok(drop >= 0);
      fault.splice(drop, 0, "DELETE FROM budgets_new WHERE month='2026-10';");
      await assert.rejects(f.db.batch(fault.map(sql => f.db.prepare(sql))), /CHECK constraint failed/);
      assert.deepEqual(await f.snapshot(), before);
      assert.deepEqual(await f.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"), triggers);
      assert.deepEqual(await f.all("SELECT name FROM sqlite_schema WHERE name IN ('budgets_new','reward_budget_settings','_budget_migration_guard')"), []);
      assert.equal((await f.all('PRAGMA foreign_keys'))[0].foreign_keys, 1);
    });
    await t.test('atomic migration preserves every record, all six indexes, and all eleven triggers', async () => {
      await f.db.batch(migration.map(sql => f.db.prepare(sql)));
      const after = await f.snapshot();
      for (const [table, rows] of Object.entries(before)) {
        assert.deepEqual(after[table], table === 'budgets' ? rows.map(row => ({ ...row, limit_cents: 10000, revision: 0, updated_at: 0, updated_by: null })) : rows, table);
      }
      assert.deepEqual(await f.settings(), { id: 1, default_monthly_limit_cents: 10000, revision: 0, updated_at: 0, updated_by: null });
      assert.deepEqual(await f.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"), triggers);
      assert.deepEqual(await f.all("SELECT name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL AND name<>'audit_budget_request' ORDER BY name"), indexes);
      assert.equal((await f.all("SELECT name FROM sqlite_schema WHERE name='audit_budget_request' AND type='index'")).length, 1);
      assert.deepEqual(await f.all('PRAGMA foreign_key_check'), []);
      assert.equal((await f.all('PRAGMA foreign_keys'))[0].foreign_keys, 1);
      t.diagnostic(JSON.stringify({ before: Object.fromEntries(Object.entries(before).map(([key, rows]) => [key, rows.length])), after: Object.fromEntries(Object.entries(after).map(([key, rows]) => [key, rows.length])) }));
    });
    await t.test('month_only changes the current snapshot and audit while leaving default unchanged', async () => {
      for(let i=2;i<fullMigrationSql.length;i++)await f.db.batch(splitMigration(fullMigrationSql[i]).map(sql=>f.db.prepare(sql)));
      const settingsBefore = await f.settings();
      assert.equal(await f.change({ limit: 25000, monthRevision: 0, defaultRevision: 0 }), true);
      assert.equal((await f.budget('2026-11')).limit_cents, 25000);
      assert.equal((await f.budget('2026-11')).revision, 1);
      assert.deepEqual(await f.settings(), settingsBefore);
      const rows = await f.all("SELECT * FROM audit WHERE action='budget_changed'");
      assert.equal(rows.length, 1);
      const audit = JSON.parse(rows[0].details);
      assert.equal(audit.scope, 'month_only');
      assert.equal(audit.oldLimitCents, 10000);
      assert.equal(audit.newLimitCents, 25000);
      assert.equal(audit.newDefaultCents, 10000);
      await f.createMonth('2026-12');
      assert.equal((await f.budget('2026-12')).limit_cents, 10000);
    });
    await t.test('current_and_future updates both limits and audit in the same transaction', async () => {
      const beforeState = { rows: await f.snapshot(), settings: await f.settings() };
      await assert.rejects(f.change({ limit: 25000, scope: 'current_and_future', monthRevision: 1, defaultRevision: 0, fail: true }), /deliberately_missing_budget_test_table/);
      assert.deepEqual({ rows: await f.snapshot(), settings: await f.settings() }, beforeState);
      assert.equal(await f.change({ limit: 25000, scope: 'current_and_future', monthRevision: 1, defaultRevision: 0 }), true);
      assert.equal((await f.budget('2026-11')).revision, 2);
      assert.deepEqual(await f.settings(), { id: 1, default_monthly_limit_cents: 25000, revision: 1, updated_at: BASE_NOW + 2000, updated_by: 'manager' });
      const rows = await f.all("SELECT * FROM audit WHERE action='budget_changed'");
      assert.equal(rows.length, 2);
      const audit = JSON.parse(rows[1].details);
      assert.equal(audit.scope, 'current_and_future');
      assert.equal(audit.newDefaultCents, 25000);
      assert.equal(audit.newDefaultRevision, 1);
      assert.equal((await f.budget('2026-12')).limit_cents, 25000, 'Precreated future months receive the selected recurring amount');
      assert.equal((await f.budget('2026-12')).revision, 1);
      assert.equal((await f.budget('2026-10')).limit_cents, 10000, 'Historical months stay unchanged');
      assert.deepEqual(audit.futureMonths, [{ month: '2026-12', oldLimitCents: 10000, oldRevision: 0 }]);
      await f.createMonth('2027-01');
      assert.deepEqual(await f.budget('2027-01'), { month: '2027-01', used_cents: 0, reserved_cents: 0, exceptional_cents:0, limit_cents: 25000, revision: 0, updated_at: 0, updated_by: null });
    });
    await t.test('a committed future month blocks an unsafe recurring reduction atomically', async () => {
      await f.createMonth('2027-02');
      for (let i = 1; i <= 4; i++) await f.seed('future' + i, '2027-02', 'future-phone' + i);
      assert.equal((await f.budget('2026-11')).reserved_cents, 2000);
      assert.equal((await f.budget('2027-02')).reserved_cents, 8000);
      const beforeState = { rows: await f.snapshot(), settings: await f.settings() };
      assert.equal(await f.change({ limit: 5000, scope: 'current_and_future', monthRevision: 2, defaultRevision: 1 }), false);
      assert.deepEqual({ rows: await f.snapshot(), settings: await f.settings() }, beforeState);
    });
    await t.test('both revisions reject stale managers without changing limits or audit', async () => {
      const beforeState = { rows: await f.snapshot(), settings: await f.settings() };
      assert.equal(await f.change({ limit: 30000, monthRevision: 1, defaultRevision: 1 }), false);
      assert.equal(await f.change({ limit: 30000, monthRevision: 2, defaultRevision: 0 }), false);
      assert.deepEqual({ rows: await f.snapshot(), settings: await f.settings() }, beforeState);
      const results = await Promise.all([
        f.change({ limit: 30000, monthRevision: 2, defaultRevision: 1 }),
        f.change({ limit: 35000, monthRevision: 2, defaultRevision: 1, actor: 'manager2' }),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await f.budget('2026-11')).revision, 3);
      assert.equal((await f.all("SELECT * FROM audit WHERE action='budget_changed'")).length, 3);
      assert.equal((await f.settings()).default_monthly_limit_cents, 25000);
      assert.equal(await f.change({ limit: 25000, monthRevision: 3, defaultRevision: 1 }), true);
    });
    await t.test('$250 supports reserves and awards above $100 without allowing overspend or unsafe reduction', async () => {
      for (let i = 1; i < 12; i++) await f.seed('new' + i, '2026-11', 'p' + i);
      assert.equal((await f.budget('2026-11')).reserved_cents, 24000);
      await assert.rejects(f.seed('over', '2026-11', 'over'), /CHECK constraint failed|normal_budget_exhausted/);
      await assert.rejects(f.run("UPDATE budgets SET limit_cents=10000 WHERE month='2026-11'"), /CHECK constraint failed/);
      const beforeState = { rows: await f.snapshot(), settings: await f.settings() };
      assert.equal(await f.change({ limit: 10000, scope: 'current_and_future', monthRevision: 4, defaultRevision: 1 }), false);
      assert.deepEqual({ rows: await f.snapshot(), settings: await f.settings() }, beforeState);
      for (let i = 1; i < 7; i++) await f.award('new' + i, '2026-11', 'p' + i);
      const current = await f.budget('2026-11');
      assert.equal(current.used_cents, 12000);
      assert.equal(current.reserved_cents, 12000);
      assert.equal(current.limit_cents, 25000);
      assert.deepEqual(await f.all('PRAGMA foreign_key_check'), []);
      assert.equal((await f.all('PRAGMA foreign_keys'))[0].foreign_keys, 1);
    });
    await t.test('production store retries recover the durable original D1 response without a second mutation', async () => {
      const body = { month: '2026-11', budgetCents: 25000, scope: 'month_only', expectedRevision: 4, expectedDefaultRevision: 1, requestId: 'workerd-idempotency-request-1' };
      const employee = { sub: 'manager', role: 'manager' };
      const first = await changeBudget(f.db, employee, body, BASE_NOW + 2000);
      assert.equal(first.revision, 5);
      assert.deepEqual(await changeBudget(f.db, employee, body, BASE_NOW + 3000), first);
      await assert.rejects(changeBudget(f.db, employee, { ...body, budgetCents: 30000 }, BASE_NOW + 3000), error => error.status === 409 && error.code === 'budget_request_conflict');
      assert.equal((await f.all("SELECT * FROM audit WHERE action='budget_changed'")).length, 5);
    });
    await t.test('new empty Preview bootstrap matches final 0001–0009 schema without destructive statements', async () => {
      const previewSql = readFileSync(new URL('../proposals/sql/preview_schema_development.sql', import.meta.url), 'utf8');
      const bootstrap = statements(previewSql);
      assert.equal(bootstrap.some(sql => /^\s*(?:DROP|ALTER|DELETE|UPDATE)\b/i.test(sql.replace(/--[^\n]*/g, ''))), false);
      // Exercise the user's requested one-console-command-at-a-time workflow.
      for (const sql of bootstrap) await f.emptyDb.prepare(sql).run();
      const schemaSql = "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name";
      assert.deepEqual((await f.emptyDb.prepare(schemaSql).all()).results, await f.all(schemaSql));
      assert.deepEqual((await f.emptyDb.prepare('PRAGMA foreign_key_check').all()).results, []);
      assert.equal((await f.emptyDb.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
      for (const table of originalTables) assert.equal((await f.emptyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0, table);
      assert.deepEqual(await f.emptyDb.prepare('SELECT * FROM reward_budget_settings').first(), { id: 1, default_monthly_limit_cents: 10000, revision: 0, updated_at: 0, updated_by: null });
      assert.equal((await f.emptyDb.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'").first()).count, 24);
    });
  } finally { await f.close(); }
});
