import { ApiError, iso, monthWindow } from './common.mjs';

const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const FIELDS = new Set(['month', 'budgetCents', 'scope', 'expectedRevision', 'expectedDefaultRevision', 'requestId']);
const SCOPES = new Set(['month_only', 'current_and_future']);

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.has(key)) ||
      typeof body.month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(body.month) ||
      !Number.isSafeInteger(body.budgetCents) || body.budgetCents < 0 || !SCOPES.has(body.scope) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(body.expectedDefaultRevision) || body.expectedDefaultRevision < 0 || body.expectedDefaultRevision >= Number.MAX_SAFE_INTEGER ||
      typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId)) {
    throw new ApiError(400, 'invalid_budget', 'Vérifiez le montant, la portée et la version du budget.');
  }
  return JSON.stringify({ month: body.month, budgetCents: body.budgetCents, scope: body.scope,
    expectedRevision: body.expectedRevision, expectedDefaultRevision: body.expectedDefaultRevision });
}

export async function getBudget(db, { month, now = Date.now() }) {
  const row = await statement(db, `SELECT
    COALESCE(b.limit_cents,s.default_monthly_limit_cents) AS budget_cents,
    COALESCE(b.used_cents,0) AS used_cents,COALESCE(b.reserved_cents,0) AS reserved_cents,
    COALESCE(b.exceptional_cents,0) AS exceptional_cents,
    COALESCE(b.revision,0) AS revision,COALESCE(b.updated_at,0) AS updated_at,b.updated_by,
    (SELECT actor_name FROM audit a WHERE a.action='budget_changed' AND a.actor_sub=b.updated_by AND a.created_at=b.updated_at ORDER BY a.id DESC LIMIT 1) AS updated_by_name,
    s.default_monthly_limit_cents,s.revision AS default_revision,
    COALESCE((SELECT MAX(MAX(0,used_cents+reserved_cents-exceptional_cents)) FROM budgets WHERE month>=?),0) AS future_minimum,
    (SELECT COUNT(*) FROM rewards WHERE status='pending' AND claim_by>?) AS pending_count,
    (SELECT COUNT(*) FROM rewards WHERE status IN ('claimed','issued')) AS used_count
    FROM reward_budget_settings s LEFT JOIN budgets b ON b.month=? WHERE s.id=1`, month, now, month).first();
  if (!row) throw new ApiError(503, 'schema_unavailable', 'La configuration du budget est indisponible.');
  return { month, budgetCents: row.budget_cents, usedCents: row.used_cents, reservedCents: row.reserved_cents,
    remainingCents: Math.max(0, row.budget_cents - row.used_cents - row.reserved_cents),
    authorizedExceptionalCents: row.exceptional_cents, overrunCents: Math.max(0, row.used_cents + row.reserved_cents - row.budget_cents),
    pendingCount: row.pending_count, usedCount: row.used_count, countScope: 'all',
    defaultBudgetCents: row.default_monthly_limit_cents, revision: row.revision, defaultRevision: row.default_revision,
    minimumBudgetCents: Math.max(0, row.used_cents + row.reserved_cents - row.exceptional_cents), minimumFutureBudgetCents: row.future_minimum,
    updatedAt: row.updated_at ? iso(row.updated_at) : null, updatedBy: row.updated_by ?? null, updatedByName: row.updated_by_name ?? null };
}

async function previousChange(db, requestId, actor, fingerprint) {
  const row = await statement(db, "SELECT actor_sub,details FROM audit WHERE action='budget_changed' AND json_extract(details,'$.requestId')=?", requestId).first();
  if (!row) return null;
  const details = JSON.parse(row.details);
  if (row.actor_sub !== actor || details.requestFingerprint !== fingerprint || !details.response) {
    throw new ApiError(409, 'budget_request_conflict', 'Cet identifiant de demande a déjà été utilisé pour une autre modification.');
  }
  return details.response;
}

export async function changeBudget(db, employee, body, now = null) {
  if (employee?.role !== 'manager') throw new ApiError(403, 'manager_required', 'Seul un responsable peut modifier le budget.');
  const fingerprint = validate(body);
  const manager = await statement(db, "SELECT sub,name FROM employees WHERE sub=? AND active=1 AND role='manager'", employee.sub).first();
  if (!manager) throw new ApiError(403, 'manager_required', 'Seul un responsable actif peut modifier le budget.');
  const prior = await previousChange(db, body.requestId, manager.sub, fingerprint);
  if (prior) return prior;
  // Re-read the clock after authentication/idempotency reads. Identical retries
  // above retain their original result even after the Toronto month changes.
  const mutationNow = now ?? Date.now();
  if (body.month !== monthWindow(mutationNow).month) {
    throw new ApiError(409, 'budget_month_changed', 'Le mois a changé. Rechargez le budget avant de le modifier.');
  }
  const future = body.scope === 'current_and_future' ? 1 : 0;
  const args = body;
  const batch = [
    statement(db, "UPDATE sessions SET reservation_active=0,state=CASE WHEN state='awarded' THEN state ELSE 'lost' END WHERE reservation_active=1 AND (expires_at<=? OR (state='eligible' AND claim_deadline<=?))", mutationNow, mutationNow),
    statement(db, `INSERT INTO budgets(month,limit_cents)
      SELECT ?,s.default_monthly_limit_cents FROM reward_budget_settings s JOIN employees e ON e.sub=?
      WHERE s.id=1 AND s.revision=? AND ?=0 AND e.active=1 AND e.role='manager'
        AND NOT EXISTS(SELECT 1 FROM budgets f WHERE (f.month=? OR (?=1 AND f.month>?)) AND f.used_cents+f.reserved_cents-f.exceptional_cents>?)
      ON CONFLICT(month) DO NOTHING`, body.month, manager.sub, body.expectedDefaultRevision, body.expectedRevision, body.month, future, body.month, body.budgetCents),
    statement(db, `INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
      SELECT NULL,'budget_changed',e.sub,e.name,?,json_object(
        'requestId',?,'requestFingerprint',?,'month',b.month,'scope',?,
        'oldLimitCents',b.limit_cents,'newLimitCents',?,
        'oldDefaultCents',s.default_monthly_limit_cents,'newDefaultCents',CASE WHEN ?=1 THEN ? ELSE s.default_monthly_limit_cents END,
        'oldMonthRevision',b.revision,'newMonthRevision',b.revision+1,
        'oldDefaultRevision',s.revision,'newDefaultRevision',s.revision+?,
        'futureMonths',json((SELECT json_group_array(json_object('month',f.month,'oldLimitCents',f.limit_cents,'oldRevision',f.revision)) FROM budgets f WHERE f.month>b.month AND ?=1)),
        'response',json_object('month',b.month,'budgetCents',?,'usedCents',b.used_cents,'reservedCents',b.reserved_cents,
          'remainingCents',MAX(0,?-b.used_cents-b.reserved_cents),
          'authorizedExceptionalCents',b.exceptional_cents,'overrunCents',MAX(0,b.used_cents+b.reserved_cents-?),
          'pendingCount',(SELECT COUNT(*) FROM rewards WHERE status='pending' AND claim_by>?),
          'usedCount',(SELECT COUNT(*) FROM rewards WHERE status IN ('claimed','issued')),'countScope','all',
          'defaultBudgetCents',CASE WHEN ?=1 THEN ? ELSE s.default_monthly_limit_cents END,
          'revision',b.revision+1,'defaultRevision',s.revision+?,
          'minimumBudgetCents',MAX(0,b.used_cents+b.reserved_cents-b.exceptional_cents),
          'minimumFutureBudgetCents',COALESCE((SELECT MAX(MAX(0,used_cents+reserved_cents-exceptional_cents)) FROM budgets WHERE month>=b.month),0),
          'updatedAt',?,'updatedBy',e.sub,'updatedByName',e.name))
      FROM budgets b CROSS JOIN reward_budget_settings s JOIN employees e ON e.sub=?
      WHERE b.month=? AND s.id=1 AND e.active=1 AND e.role='manager' AND b.revision=? AND s.revision=?
        AND NOT EXISTS(SELECT 1 FROM budgets f WHERE (f.month=b.month OR (?=1 AND f.month>b.month)) AND f.used_cents+f.reserved_cents-f.exceptional_cents>?)
      RETURNING details`, mutationNow, args.requestId, fingerprint, args.scope, args.budgetCents,
      future, args.budgetCents, future, future, args.budgetCents, args.budgetCents, args.budgetCents, mutationNow,
      future, args.budgetCents, future, iso(mutationNow), manager.sub, args.month, args.expectedRevision, args.expectedDefaultRevision, future, args.budgetCents),
    statement(db, `UPDATE budgets SET limit_cents=?,revision=revision+1,updated_at=?,updated_by=?
      WHERE (month=? OR (?=1 AND month>?)) AND changes()=1`, body.budgetCents, mutationNow, manager.sub, body.month, future, body.month),
    statement(db, `UPDATE reward_budget_settings SET default_monthly_limit_cents=?,revision=revision+1,updated_at=?,updated_by=?
      WHERE id=1 AND revision=? AND ?=1 AND changes()>0`, body.budgetCents, mutationNow, manager.sub, body.expectedDefaultRevision, future),
  ];
  let result;
  try { result = await db.batch(batch); }
  catch (error) {
    // A concurrent same-key request may have committed first; the expression
    // index enforces durable uniqueness. A lost reply can also be recovered.
    const completed = await previousChange(db, body.requestId, manager.sub, fingerprint);
    if (completed) return completed;
    throw error;
  }
  const details = result[2].results?.[0]?.details;
  if (details) return JSON.parse(details).response;
  const completed = await previousChange(db, body.requestId, manager.sub, fingerprint);
  if (completed) return completed;
  const current = await getBudget(db, { month: body.month, now: mutationNow });
  if (current.revision !== body.expectedRevision || current.defaultRevision !== body.expectedDefaultRevision) {
    throw new ApiError(409, 'budget_conflict', 'Un autre responsable a modifié le budget. Rechargez les montants.');
  }
  const floor = future ? current.minimumFutureBudgetCents : current.minimumBudgetCents;
  if (body.budgetCents < floor) {
    throw new ApiError(409, 'budget_below_committed', 'Le montant doit couvrir les récompenses et les réservations déjà engagées.');
  }
  throw new ApiError(403, 'manager_required', 'Seul un responsable actif peut modifier le budget.');
}
