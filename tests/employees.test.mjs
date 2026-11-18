import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { migrateSqlite } from './helpers/migrations.cjs';
import { listEmployees, createEmployee, changeEmployee } from '../server/employees.mjs';

const manager = { sub: 'manager', role: 'manager', name: 'Gestionnaire' };
const staff = { sub: 'staff', role: 'staff', name: 'Employé' };
function fixture(t) {
  const f = openReviewDatabase(':memory:');
  migrateSqlite(f.sqlite);
  f.sqlite.prepare('INSERT INTO employees VALUES(?,?,?,?,1)').run(manager.sub, 'manager@example.com', manager.name, 'manager');
  f.sqlite.prepare('INSERT INTO employees VALUES(?,?,?,?,1)').run(staff.sub, 'staff@example.com', staff.name, 'staff');
  t.after(() => f.sqlite.close());
  return f;
}
const newStaff = { email: '  Louise@Example.com ', name: ' Louise Tremblay ', role: 'staff' };

test('only an active manager may list, invite, or change staff', async t => {
  const f = fixture(t);
  for (const actor of [null, staff, { ...staff, role: 'manager' }]) {
    await assert.rejects(listEmployees(f.DB, actor), { status: 403, code: 'manager_required' });
    await assert.rejects(createEmployee(f.DB, actor, newStaff), { status: 403 });
    await assert.rejects(changeEmployee(f.DB, actor, { sub: 'staff', active: false }), { status: 403 });
  }
  f.sqlite.prepare('UPDATE employees SET active=0 WHERE sub=?').run(manager.sub);
  await assert.rejects(listEmployees(f.DB, manager), { status: 403 });
});

test('invitation normalizes the email, uses staff role and audits the verified manager', async t => {
  const f = fixture(t);
  const { employee } = await createEmployee(f.DB, manager, newStaff, 1234);
  assert.deepEqual(employee, { sub: 'invite:louise@example.com', email: 'louise@example.com', name: 'Louise Tremblay', role: 'staff', active: true });
  const audit = f.sqlite.prepare("SELECT * FROM audit WHERE action='employee_created'").get();
  assert.equal(audit.actor_sub, 'manager');
  assert.equal(audit.actor_name, 'Gestionnaire');
  assert.equal(audit.created_at, 1234);
  assert.equal(JSON.parse(audit.details).email, 'louise@example.com');
  assert.equal((await listEmployees(f.DB, manager)).employees.length, 3);
});

test('invalid fields and manager role injection never create invitations', async t => {
  const f = fixture(t);
  for (const body of [null, [], { ...newStaff, role: 'manager' }, { ...newStaff, email: 'bad' },
    { ...newStaff, email: '.a@example.com' }, { ...newStaff, email: 'a@example..com' },
    { ...newStaff, name: '\n' }, { ...newStaff, name: 'A\nB' }, { ...newStaff, active: true }]) {
    await assert.rejects(createEmployee(f.DB, manager, body), { status: 400, code: 'invalid_employee' });
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 2);
});

test('repeated invitations do not duplicate, rename or reactivate an existing account', async t => {
  const f = fixture(t);
  const a = await createEmployee(f.DB, manager, newStaff);
  assert.deepEqual(await createEmployee(f.DB, manager, newStaff), a);
  await assert.rejects(createEmployee(f.DB, manager, { ...newStaff, name: 'Autre nom' }), { status: 409 });
  await assert.rejects(createEmployee(f.DB, manager, { email: 'manager@example.com', name: manager.name }), { status: 409 });
  await changeEmployee(f.DB, manager, { sub: a.employee.sub, active: false });
  assert.equal((await createEmployee(f.DB, manager, newStaff)).employee.active, false);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='employee_created'").get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM employees WHERE lower(email)=?').get('louise@example.com').n, 1);
});

test('deactivation preserves the account and reward history, is auditable and idempotent', async t => {
  const f = fixture(t);
  const row = await changeEmployee(f.DB, manager, { sub: staff.sub, active: false }, 2345);
  assert.equal(row.employee.active, false);
  await changeEmployee(f.DB, manager, { sub: staff.sub, active: false }, 2346);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='employee_deactivated'").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT created_at FROM audit WHERE action='employee_deactivated'").get().created_at, 2345);
  assert.equal((await changeEmployee(f.DB, manager, { sub: staff.sub, active: true })).employee.active, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='employee_activated'").get().n, 1);
});

test('self deactivation and invalid state changes are refused', async t => {
  const f = fixture(t);
  await assert.rejects(changeEmployee(f.DB, manager, { sub: manager.sub, active: false }), { status: 409, code: 'employee_self_deactivation' });
  await assert.rejects(changeEmployee(f.DB, manager, { sub: 'missing', active: false }), { status: 404 });
  for (const body of [{ sub: staff.sub, active: 0 }, { sub: staff.sub, active: false, role: 'manager' }, { sub: '', active: false }]) {
    await assert.rejects(changeEmployee(f.DB, manager, body), { status: 400 });
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM employees WHERE active=1 AND role='manager'").get().n, 1);
});

test('a manager revocation before the mutation prevents changes and auditing', async t => {
  const f = fixture(t);
  let batchCalls = 0;
  const DB = { prepare: f.DB.prepare, async batch(statements) {
    batchCalls++;
    f.sqlite.prepare('UPDATE employees SET active=0 WHERE sub=?').run(manager.sub);
    return f.DB.batch(statements);
  } };
  await assert.rejects(createEmployee(DB, manager, newStaff), { status: 403 });
  assert.equal(batchCalls, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 2);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 0);
});

test('failed audit rolls the employee change back with its transaction', async t => {
  const f = fixture(t);
  f.sqlite.exec("CREATE TRIGGER reject_employee_audit BEFORE INSERT ON audit WHEN NEW.action LIKE 'employee_%' BEGIN SELECT RAISE(ABORT,'audit_down'); END;");
  await assert.rejects(createEmployee(f.DB, manager, newStaff), /audit_down/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 2);
  await assert.rejects(changeEmployee(f.DB, manager, { sub: staff.sub, active: false }), /audit_down/);
  assert.equal(f.sqlite.prepare('SELECT active FROM employees WHERE sub=?').get(staff.sub).active, 1);
});

test('independent connections cannot create duplicate emails or disable every manager', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boreal-employees-'));
  const first = openReviewDatabase(join(directory, 'review.sqlite'));
  migrateSqlite(first.sqlite);
  first.sqlite.prepare('INSERT INTO employees VALUES(?,?,?,?,1)').run('manager', 'manager@example.com', 'Gestionnaire', 'manager');
  first.sqlite.prepare('INSERT INTO employees VALUES(?,?,?,?,1)').run('other', 'other@example.com', 'Autre responsable', 'manager');
  const second = openReviewDatabase(join(directory, 'review.sqlite'));
  t.after(() => { second.sqlite.close(); first.sqlite.close(); rmSync(directory, { recursive: true, force: true }); });
  let b;
  const concurrentCreate = { prepare: first.DB.prepare, async batch(statements) {
    // The second request commits after the first request authenticated, before
    // its mutation. SQLite executes each D1 batch as one transaction.
    b = await createEmployee(second.DB, manager, newStaff);
    return first.DB.batch(statements);
  } };
  const a = await createEmployee(concurrentCreate, manager, newStaff);
  assert.equal(a.employee.sub, b.employee.sub);
  assert.equal(first.sqlite.prepare('SELECT COUNT(*) AS n FROM employees WHERE lower(email)=?').get('louise@example.com').n, 1);
  assert.equal(first.sqlite.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='employee_created'").get().n, 1);
  const concurrentChange = { prepare: first.DB.prepare, async batch(statements) {
    await changeEmployee(second.DB, { sub: 'other', role: 'manager' }, { sub: 'manager', active: false });
    return first.DB.batch(statements);
  } };
  await assert.rejects(changeEmployee(concurrentChange, manager, { sub: 'other', active: false }), { status: 403 });
  assert.equal(first.sqlite.prepare("SELECT COUNT(*) AS n FROM employees WHERE role='manager' AND active=1").get().n, 1);
});
