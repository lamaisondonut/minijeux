import { iso, monthWindow, TIERS } from './common.mjs';
import { getBudget } from './budget.mjs';

const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);

// Expiration follows the register: a code already taken in charge remains
// assigned to that employee; only an unclaimed, overdue code is expired.
const AGGREGATES = `COUNT(*) AS rewards_count,
  COUNT(DISTINCT phone_hash) AS registered_players,
  COALESCE(SUM(value_cents),0) AS value_cents,
  COALESCE(SUM(status='issued'),0) AS used_count,
  COALESCE(SUM(status='claimed' OR (status='pending' AND claim_by>?)),0) AS active_count,
  COALESCE(SUM(status='pending' AND claim_by<=?),0) AS expired_count,
  COALESCE(SUM(status='cancelled'),0) AS cancelled_count,
  COALESCE(SUM(CASE WHEN status='issued' THEN value_cents ELSE 0 END),0) AS used_value_cents,
  COALESCE(SUM(CASE WHEN status='issued' AND discount_applied=1 THEN applied_value_cents ELSE 0 END),0) AS applied_value_cents,
  COALESCE(SUM(CASE WHEN status='pending' AND claim_by<=? THEN value_cents ELSE 0 END),0) AS expired_value_cents`;

function totals(row) {
  return {
    registeredPlayers: row.registered_players, rewardsCount: row.rewards_count,
    usedCount: row.used_count, activeCount: row.active_count,
    expiredCount: row.expired_count, cancelledCount: row.cancelled_count,
    valueCents: row.value_cents, usedValueCents: row.used_value_cents,
    appliedValueCents: row.applied_value_cents, expiredValueCents: row.expired_value_cents,
  };
}

function tiers(rows) {
  return TIERS.map(({ valueCents }) => {
    const row = rows.find(value => value.value_cents === valueCents);
    return { valueCents, count: row?.rewards_count ?? 0,
      totalCents: row?.total_cents ?? 0, usedCount: row?.used_count ?? 0,
      activeCount: row?.active_count ?? 0, expiredCount: row?.expired_count ?? 0 };
  });
}

export async function getDashboard(db, now = Date.now()) {
  const { month } = monthWindow(now);
  const tierSql = `SELECT value_cents,COUNT(*) AS rewards_count,
    COALESCE(SUM(value_cents),0) AS total_cents,
    COALESCE(SUM(status='issued'),0) AS used_count,
    COALESCE(SUM(status='claimed' OR (status='pending' AND claim_by>?)),0) AS active_count,
    COALESCE(SUM(status='pending' AND claim_by<=?),0) AS expired_count
    FROM rewards`;
  const results = await db.batch([
    statement(db, `SELECT ${AGGREGATES} FROM rewards`, now, now, now),
    statement(db, `SELECT ${AGGREGATES} FROM rewards WHERE month=?`, now, now, now, month),
    statement(db, `${tierSql} GROUP BY value_cents`, now, now),
    statement(db, `${tierSql} WHERE month=? GROUP BY value_cents`, now, now, month),
    statement(db, 'SELECT COUNT(*) AS recorded_games,MIN(created_at) AS first_recorded_at FROM sessions'),
  ]);
  const games = results[4].results[0];
  return {
    checkedAt: iso(now),
    totals: { ...totals(results[0].results[0]), recordedGames: games.recorded_games },
    tiers: tiers(results[2].results),
    month: { month, ...totals(results[1].results[0]), tiers: tiers(results[3].results) },
    budget: await getBudget(db, { month, now }),
    coverage: {
      players: 'reward_recipients_by_declared_phone', games: 'retained_sessions',
      gamesComplete: false, firstRecordedGameAt: iso(games.first_recorded_at),
      note: 'Seuls les joueurs ayant une récompense sont enregistrés. Les parties libres ne sont pas enregistrées ; les statistiques portent sur les données conservées.',
    },
  };
}
