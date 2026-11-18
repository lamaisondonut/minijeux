-- Configurable monthly budgets in integer CAD cents.
-- Upgrade only in ONE atomic D1 batch / migration transaction for this ENTIRE file.
-- NEVER execute statement-by-statement in the D1 console. D1 owns BEGIN/COMMIT.
-- Validate on an isolated Preview database before any production migration.
-- Existing valid integer balances/reservations remain unchanged with a $100 limit.
-- Invalid legacy data aborts the transaction; future months snapshot settings.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER session_reserve;
DROP TRIGGER session_release;
DROP TRIGGER reward_allocate;
CREATE TABLE budgets_new (
 month TEXT PRIMARY KEY NOT NULL,
 used_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(used_cents)='integer' AND used_cents>=0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved_cents)='integer' AND reserved_cents>=0),
 limit_cents INTEGER NOT NULL DEFAULT 10000 CHECK(typeof(limit_cents)='integer' AND limit_cents BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
 updated_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(updated_at)='integer' AND updated_at>=0),
 updated_by TEXT,
 CHECK(used_cents+reserved_cents<=limit_cents)
);
INSERT INTO budgets_new(month,used_cents,reserved_cents,limit_cents) SELECT month,used_cents,reserved_cents,10000 FROM budgets;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;
CREATE TRIGGER session_reserve AFTER INSERT ON sessions WHEN NEW.reservation_active=1 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.cap_cents WHERE month=NEW.month;
END;
CREATE TRIGGER session_release AFTER UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=1 AND NEW.reservation_active=0 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents-OLD.cap_cents WHERE month=OLD.month;
 UPDATE sessions SET sms_reserved=0 WHERE id=NEW.id AND sms_reserved=1;
END;
CREATE TRIGGER reward_allocate AFTER INSERT ON rewards BEGIN
 UPDATE sessions SET state='awarded',reservation_active=0 WHERE id=NEW.session_id;
 UPDATE budgets SET used_cents=used_cents+NEW.value_cents WHERE month=NEW.month;
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.id,'confirmed',NEW.last_actor_sub,NEW.last_actor_name,NEW.confirmed_at,'{}');
END;
CREATE TABLE reward_budget_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 default_monthly_limit_cents INTEGER NOT NULL DEFAULT 10000
   CHECK(typeof(default_monthly_limit_cents)='integer' AND default_monthly_limit_cents BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
 updated_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(updated_at)='integer' AND updated_at>=0),
 updated_by TEXT
);
INSERT INTO reward_budget_settings(id) VALUES(1);
CREATE UNIQUE INDEX audit_budget_request
 ON audit(json_extract(details,'$.requestId')) WHERE action='budget_changed';
CREATE TABLE _budget_migration_guard (violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO _budget_migration_guard(violations) SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE _budget_migration_guard;
-- DROP of the referenced parent can leave deferred violation counters even when
-- the final FK graph is valid. The SQL assertion above MUST succeed before reset.
PRAGMA defer_foreign_keys=OFF;
