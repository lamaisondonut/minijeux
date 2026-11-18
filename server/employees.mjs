import { ApiError } from './common.mjs';

const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const columns = 'sub,email,name,role,active';
const view = row => ({ sub: row.sub, email: row.email, name: row.name, role: row.role, active: row.active === 1 });

async function manager(db, actor) {
  if (actor?.role !== 'manager' || typeof actor.sub !== 'string') {
    throw new ApiError(403, 'manager_required', 'Cette opération est réservée à un gestionnaire.');
  }
  const row = await statement(db, `SELECT ${columns} FROM employees WHERE sub=? AND role='manager' AND active=1`, actor.sub).first();
  if (!row) throw new ApiError(403, 'manager_required', 'Votre accès gestionnaire doit être vérifié.');
  return row;
}

function bodyFields(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
    throw new ApiError(400, 'invalid_employee', 'Vérifiez les renseignements de l’employé.');
  }
}

function invitation(body) {
  bodyFields(body, ['email', 'name', 'role']);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const [local, domain, extra] = email.split('@');
  const validEmail = email.length <= 254 && !extra && local && local.length <= 64 &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    domain && domain.includes('.') && domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!validEmail || !name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) || (body.role !== undefined && body.role !== 'staff')) {
    throw new ApiError(400, 'invalid_employee', 'Saisissez un nom et un courriel valides. Les nouveaux employés ont le rôle employé.');
  }
  return { sub: 'invite:' + email, email, name };
}

export async function listEmployees(db, actor) {
  await manager(db, actor);
  const result = await statement(db, `SELECT ${columns} FROM employees
    WHERE EXISTS(SELECT 1 FROM employees m WHERE m.sub=? AND m.role='manager' AND m.active=1)
    ORDER BY active DESC,role='manager' DESC,name COLLATE NOCASE,email`, actor.sub).all();
  // A revocation between the initial check and query must not return the roster.
  await manager(db, actor);
  return { employees: result.results.map(view) };
}

export async function createEmployee(db, actor, body, now = Date.now()) {
  await manager(db, actor);
  const target = invitation(body);
  const result = await db.batch([
    statement(db, `INSERT INTO employees(sub,email,name,role,active)
      SELECT ?,?,?,'staff',1 FROM employees m WHERE m.sub=? AND m.active=1 AND m.role='manager'
      AND NOT EXISTS(SELECT 1 FROM employees WHERE lower(email)=? OR sub=?)`,
    target.sub, target.email, target.name, actor.sub, target.email, target.sub),
    statement(db, `INSERT INTO audit(action,actor_sub,actor_name,created_at,details)
      SELECT 'employee_created',m.sub,m.name,?,json_object('employeeSub',e.sub,'email',e.email,'name',e.name,'role',e.role,'active',e.active)
      FROM employees e JOIN employees m ON m.sub=? AND m.active=1 AND m.role='manager'
      WHERE e.sub=? AND changes()=1`, now, actor.sub, target.sub),
    statement(db, `SELECT ${columns} FROM employees WHERE lower(email)=?
      AND EXISTS(SELECT 1 FROM employees m WHERE m.sub=? AND m.active=1 AND m.role='manager')`, target.email, actor.sub),
  ]);
  const employee = result[2].results?.[0];
  if (!employee) {
    await manager(db, actor);
    throw new ApiError(409, 'employee_exists', 'Ce compte existe déjà. Actualisez la liste des employés.');
  }
  // A repeated request returns the same invitation, without reactivating an
  // employee or changing an existing role/name behind the manager’s back.
  if (employee.role !== 'staff' || employee.name !== target.name) {
    throw new ApiError(409, 'employee_exists', 'Ce courriel est déjà autorisé. Utilisez sa fiche existante.');
  }
  return { employee: view(employee) };
}

export async function changeEmployee(db, actor, body, now = Date.now()) {
  await manager(db, actor);
  bodyFields(body, ['sub', 'active']);
  if (typeof body.sub !== 'string' || !body.sub || body.sub.length > 320 || /[\u0000-\u001f\u007f]/.test(body.sub) || typeof body.active !== 'boolean') {
    throw new ApiError(400, 'invalid_employee', 'Choisissez un employé et son nouvel état.');
  }
  if (body.sub === actor.sub && !body.active) {
    throw new ApiError(409, 'employee_self_deactivation', 'Vous ne pouvez pas désactiver votre propre compte.');
  }
  const active = body.active ? 1 : 0;
  const result = await db.batch([
    statement(db, `UPDATE employees SET active=? WHERE sub=? AND active<>?
      AND EXISTS(SELECT 1 FROM employees m WHERE m.sub=? AND m.active=1 AND m.role='manager')
      AND NOT (sub=? AND ?=0)
      AND (?=1 OR role<>'manager' OR (SELECT COUNT(*) FROM employees WHERE role='manager' AND active=1)>1)`,
    active, body.sub, active, actor.sub, actor.sub, active, active),
    statement(db, `INSERT INTO audit(action,actor_sub,actor_name,created_at,details)
      SELECT CASE WHEN e.active=1 THEN 'employee_activated' ELSE 'employee_deactivated' END,m.sub,m.name,?,
        json_object('employeeSub',e.sub,'email',e.email,'name',e.name,'role',e.role,'active',e.active,'previousActive',1-e.active)
      FROM employees e JOIN employees m ON m.sub=? AND m.active=1 AND m.role='manager'
      WHERE e.sub=? AND changes()=1`, now, actor.sub, body.sub),
    statement(db, `SELECT ${columns} FROM employees WHERE sub=?
      AND EXISTS(SELECT 1 FROM employees m WHERE m.sub=? AND m.active=1 AND m.role='manager')`, body.sub, actor.sub),
  ]);
  const employee = result[2].results?.[0];
  if (!employee) {
    await manager(db, actor);
    throw new ApiError(404, 'employee_not_found', 'Cet employé est introuvable.');
  }
  if (employee.active !== active) {
    throw new ApiError(409, 'last_manager_required', 'Conservez au moins un gestionnaire actif.');
  }
  return { employee: view(employee) };
}
