import test from 'node:test';
import assert from 'node:assert/strict';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { migrateSqlite } from './helpers/migrations.cjs';
import { getDashboard } from '../server/dashboard.mjs';
import { createManual, quoteManual } from '../server/manual-rewards.mjs';
import { startSession } from '../server/store.mjs';
import { monthWindow, secureId } from '../server/common.mjs';

const NOW = Date.parse('2026-11-18T17:00:00Z');
const MANAGER = { sub:'dashboard-manager',name:'Responsable',email:'manager@example.invalid',role:'manager' };

function fixture() {
  const f = openReviewDatabase(':memory:');
  migrateSqlite(f.sqlite);
  f.sqlite.prepare('INSERT INTO employees(sub,email,name,role,active) VALUES(?,?,?,?,1)')
    .run(MANAGER.sub, MANAGER.email, MANAGER.name, MANAGER.role);
  return { ...f, env:{DB:f.DB,REWARDS_HMAC_SECRET:'dashboard-test-secret'.repeat(3),
    MANUAL_REWARDS_ENABLED:'true',TERMS_APPROVED:'true'} };
}

async function manual(f, valueCents, index, when = NOW, overrides = {}) {
  const phone = '+1514555' + String(index).padStart(4,'0');
  const body = { requestId:'dashboard-manual-request-' + index,
    firstName:'Client',lastName:'Registre',phone,valueCents,reason:'Don au client enregistré',
    authorizeBudgetOverrun:false,authorizeCooldown:false,...overrides };
  body.quote = (await quoteManual(f.env, MANAGER, body, when)).quote;
  return (await createManual(f.env, MANAGER, body, when)).reward;
}

test('empty real schema returns zero counts, the configured budget and explicit incomplete collection', async () => {
  const f = fixture();
  try {
    const result = await getDashboard(f.DB, NOW);
    assert.deepEqual(result.totals, {registeredPlayers:0,rewardsCount:0,usedCount:0,
      activeCount:0,expiredCount:0,cancelledCount:0,valueCents:0,usedValueCents:0,
      appliedValueCents:0,expiredValueCents:0,recordedGames:0});
    assert.equal(result.budget.budgetCents, 10000);
    assert.equal(result.budget.remainingCents, 10000);
    assert.deepEqual(result.tiers.map(t => [t.valueCents,t.count]), [[500,0],[1000,0],[2000,0]]);
    assert.equal(result.coverage.gamesComplete, false);
    assert.equal(result.coverage.firstRecordedGameAt, null);
    assert.match(result.coverage.note, /parties libres ne sont pas enregistrées/);
  } finally { f.sqlite.close(); }
});

test('dashboard aggregates actual allocations and statuses without refunding used, expired or cancelled rewards', async () => {
  const f = fixture();
  try {
    const pending = await manual(f, 500, 1);
    const used = await manual(f, 2000, 2);
    const cancelled = await manual(f, 1000, 3);
    const expired = await manual(f, 1000, 4, NOW - 40*864e5);
    const taken = await manual(f, 500, 5, NOW - 40*864e5);
    const claim = f.sqlite.prepare(`UPDATE rewards SET status='claimed',claimed_by=?,claimed_by_name=?,
      claimed_at=?,last_actor_sub=?,last_actor_name=? WHERE id=?`);
    claim.run(MANAGER.sub,MANAGER.name,NOW,MANAGER.sub,MANAGER.name,used.id);
    f.sqlite.prepare(`UPDATE rewards SET status='issued',discount_applied=1,food_only_confirmed=1,
      eligible_food_cents=1200,applied_value_cents=1200,issued_by=?,issued_by_name=?,issued_at=?,
      last_actor_sub=?,last_actor_name=? WHERE id=?`)
      .run(MANAGER.sub,MANAGER.name,NOW,MANAGER.sub,MANAGER.name,used.id);
    f.sqlite.prepare(`UPDATE rewards SET status='cancelled',cancelled_by_name=?,cancelled_at=?,
      cancel_reason='Erreur corrigée sans effacer le registre',last_actor_sub=?,last_actor_name=? WHERE id=?`)
      .run(MANAGER.name,NOW,MANAGER.sub,MANAGER.name,cancelled.id);
    claim.run(MANAGER.sub,MANAGER.name,NOW-35*864e5,MANAGER.sub,MANAGER.name,taken.id);
    await startSession(f.DB,{id:secureId(),ownerHash:'unregistered-browser',seed:1,width:390,height:844,
      engineVersion:'test',month:monthWindow(NOW).month,now:NOW,expiresAt:NOW+60000,
      allowRewards:false,phoneVerificationMode:'unverified'});

    const before = f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets WHERE month=?').get('2026-11');
    const result = await getDashboard(f.DB, NOW);
    assert.deepEqual(result.totals, {registeredPlayers:5,rewardsCount:5,usedCount:1,
      activeCount:2,expiredCount:1,cancelledCount:1,valueCents:5000,usedValueCents:2000,
      appliedValueCents:1200,expiredValueCents:1000,recordedGames:1});
    assert.equal(result.month.rewardsCount, 3);
    assert.equal(result.month.valueCents, 3500);
    assert.equal(result.month.expiredCount, 0);
    assert.equal(result.month.usedValueCents, 2000);
    assert.equal(result.budget.usedCents, 3500);
    assert.equal(result.budget.remainingCents, 6500);
    assert.deepEqual(result.tiers.map(t => [t.valueCents,t.count]), [[500,2],[1000,2],[2000,1]]);
    assert.deepEqual(result.month.tiers.map(t => [t.valueCents,t.count]), [[500,1],[1000,1],[2000,1]]);
    assert.equal(result.tiers[1].expiredCount, 1);
    assert.equal(result.tiers[0].activeCount, 2);
    assert.equal(result.coverage.firstRecordedGameAt, new Date(NOW).toISOString());
    assert.equal(result.totals.registeredPlayers, 5, 'an anonymous tracked game is not invented as a registered player');
    assert.deepEqual(f.sqlite.prepare('SELECT used_cents,reserved_cents FROM budgets WHERE month=?').get('2026-11'), before);
    assert.ok(pending.id && expired.id);
  } finally { f.sqlite.close(); }
});

test('registered players count declared phones once across multiple authorized rewards', async () => {
  const f = fixture();
  try {
    await manual(f, 500, 20, NOW - 40*864e5);
    await manual(f, 1000, 21, NOW, {phone:'+15145550020'});
    const result = await getDashboard(f.DB, NOW);
    assert.equal(result.totals.rewardsCount, 2);
    assert.equal(result.totals.registeredPlayers, 1);
  } finally { f.sqlite.close(); }
});
