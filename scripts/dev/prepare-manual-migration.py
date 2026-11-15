"""Build the checked-in upgrade from the preceding, immutable schemas."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
db = sqlite3.connect(':memory:')
for name in ('0001_rewards.sql', '0002_configurable_budget.sql', '0003_manual_discounts.sql'):
    db.executescript((root/'migrations'/name).read_text())
schema = {row[0]: row[1] for row in db.execute("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL")}
columns = [row[1] for row in db.execute('PRAGMA table_info(rewards)')]
budget = schema['budgets'].replace('CREATE TABLE "budgets"', 'CREATE TABLE budgets_new').replace('CREATE TABLE budgets (', 'CREATE TABLE budgets_new (')
budget = budget.replace('CHECK(used_cents+reserved_cents<=limit_cents)', "exceptional_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(exceptional_cents)='integer' AND exceptional_cents BETWEEN 0 AND 9007199254740991),\n CHECK(used_cents+reserved_cents<=limit_cents+exceptional_cents)")
reward = schema['rewards'].replace('CREATE TABLE rewards (', 'CREATE TABLE rewards_new (').replace('session_id TEXT NOT NULL UNIQUE', 'session_id TEXT UNIQUE').replace('score INTEGER NOT NULL CHECK(score>=5000)', 'score INTEGER CHECK(score>=5000)')
extra = """
 source TEXT NOT NULL DEFAULT 'game' CHECK(source IN ('game','manual')),
 manual_reason TEXT, manual_request_id TEXT, manual_fingerprint TEXT,
 budget_override INTEGER NOT NULL DEFAULT 0 CHECK(budget_override IN (0,1)), budget_override_reason TEXT,
 exceptional_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(exceptional_cents)='integer' AND exceptional_cents BETWEEN 0 AND 2000),
 cooldown_override INTEGER NOT NULL DEFAULT 0 CHECK(cooldown_override IN (0,1)), cooldown_override_reason TEXT,
 food_only_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(food_only_confirmed IN (0,1)),
 eligible_food_cents INTEGER CHECK(eligible_food_cents IS NULL OR (typeof(eligible_food_cents)='integer' AND eligible_food_cents BETWEEN 1 AND 9007199254740991)),
 applied_value_cents INTEGER CHECK(applied_value_cents IS NULL OR (typeof(applied_value_cents)='integer' AND applied_value_cents BETWEEN 1 AND value_cents)),
 CHECK((source='game' AND session_id IS NOT NULL AND score IS NOT NULL) OR (source='manual' AND session_id IS NULL AND score IS NULL))
"""
reward = reward.rstrip().removesuffix(')') + ',' + extra + ')'
initial = schema['reward_initial_state'].replace("OR NEW.discount_applied IS NOT 0", "OR NEW.discount_applied IS NOT 0 OR NEW.food_only_confirmed IS NOT 0 OR NEW.eligible_food_cents IS NOT NULL OR NEW.applied_value_cents IS NOT NULL")
transition = schema['reward_transition'].replace('OR NEW.lightspeed_ref IS NOT OLD.lightspeed_ref', 'OR NEW.lightspeed_ref IS NOT OLD.lightspeed_ref\n  OR ' + ' OR '.join('NEW.'+c+' IS NOT OLD.'+c for c in ('source','manual_reason','manual_request_id','manual_fingerprint','budget_override','budget_override_reason','exceptional_cents','cooldown_override','cooldown_override_reason')))
transition = transition.replace("SELECT CASE WHEN NEW.status='issued' AND NEW.discount_applied IS NOT 1", "SELECT CASE WHEN NEW.status='issued' AND (NEW.food_only_confirmed IS NOT 1 OR NEW.eligible_food_cents IS NULL OR NEW.applied_value_cents IS NULL OR NEW.applied_value_cents IS NOT MIN(NEW.value_cents,NEW.eligible_food_cents)) THEN RAISE(ABORT,'food_confirmation_required') END;\n SELECT CASE WHEN NEW.status<>'issued' AND (NEW.food_only_confirmed IS NOT OLD.food_only_confirmed OR NEW.eligible_food_cents IS NOT OLD.eligible_food_cents OR NEW.applied_value_cents IS NOT OLD.applied_value_cents) THEN RAISE(ABORT,'food_confirmation_immutable') END;\n SELECT CASE WHEN NEW.status='issued' AND NEW.discount_applied IS NOT 1")
validate = """CREATE TRIGGER reward_validate BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.claim_by IS NOT NEW.confirmed_at+2592000000 THEN RAISE(ABORT,'reward_expiry_required') END;
 SELECT CASE WHEN NEW.source='game' AND (NEW.manual_reason IS NOT NULL OR NEW.manual_request_id IS NOT NULL OR NEW.manual_fingerprint IS NOT NULL OR NEW.budget_override<>0 OR NEW.budget_override_reason IS NOT NULL OR NEW.exceptional_cents<>0 OR NEW.cooldown_override<>0 OR NEW.cooldown_override_reason IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND state='eligible' AND reservation_active=1 AND bound_phone_hash=NEW.phone_hash AND score=NEW.score AND month=NEW.month AND expires_at>NEW.confirmed_at AND claim_deadline>NEW.confirmed_at AND cap_cents>=NEW.value_cents AND score>=CASE NEW.value_cents WHEN 2000 THEN 10000 WHEN 1000 THEN 7500 ELSE 5000 END)) THEN RAISE(ABORT,'session_not_eligible') END;
 SELECT CASE WHEN NEW.source='manual' AND (NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.last_actor_sub AND name=NEW.last_actor_name AND role='manager' AND active=1) OR length(trim(COALESCE(NEW.manual_reason,''))) NOT BETWEEN 8 AND 500 OR length(COALESCE(NEW.manual_request_id,'')) NOT BETWEEN 16 AND 128 OR length(COALESCE(NEW.manual_fingerprint,''))<16) THEN RAISE(ABORT,'manual_manager_required') END;
 SELECT CASE WHEN NEW.source='manual' AND NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND NEW.exceptional_cents=MAX(0,used_cents+reserved_cents+NEW.value_cents-limit_cents)-MAX(0,used_cents+reserved_cents-limit_cents) AND ((used_cents+reserved_cents+NEW.value_cents>limit_cents AND NEW.budget_override=1 AND length(trim(COALESCE(NEW.budget_override_reason,''))) BETWEEN 8 AND 500) OR (used_cents+reserved_cents+NEW.value_cents<=limit_cents AND NEW.budget_override=0 AND NEW.budget_override_reason IS NULL))) THEN RAISE(ABORT,'budget_override_required') END;
 SELECT CASE WHEN NEW.source='manual' AND ((NEW.cooldown_override=1 AND length(trim(COALESCE(NEW.cooldown_override_reason,''))) NOT BETWEEN 8 AND 500) OR (NEW.cooldown_override=0 AND NEW.cooldown_override_reason IS NOT NULL)) THEN RAISE(ABORT,'cooldown_reason_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT(NEW.source='manual' AND NEW.cooldown_override=1) THEN RAISE(ABORT,'phone_cooldown') END;
END"""
allocate = """CREATE TRIGGER reward_allocate AFTER INSERT ON rewards BEGIN
 UPDATE sessions SET state='awarded',reservation_active=0 WHERE NEW.source='game' AND id=NEW.session_id;
 UPDATE budgets SET used_cents=used_cents+NEW.value_cents,exceptional_cents=exceptional_cents+NEW.exceptional_cents WHERE month=NEW.month;
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE NEW.source WHEN 'manual' THEN 'manual_confirmed' ELSE 'confirmed' END,NEW.last_actor_sub,NEW.last_actor_name,NEW.confirmed_at,
 json_object('source',NEW.source,'valueCents',NEW.value_cents,'reason',NEW.manual_reason,'budgetOverride',json(CASE NEW.budget_override WHEN 1 THEN 'true' ELSE 'false' END),'budgetOverrideReason',NEW.budget_override_reason,'exceptionalCents',NEW.exceptional_cents,'cooldownOverride',json(CASE NEW.cooldown_override WHEN 1 THEN 'true' ELSE 'false' END),'cooldownOverrideReason',NEW.cooldown_override_reason,'requestId',NEW.manual_request_id));
END"""
audit = """CREATE TRIGGER reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,NEW.status,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('valueCents',NEW.value_cents,'discountApplied',json(CASE NEW.discount_applied WHEN 1 THEN 'true' ELSE 'false' END),'foodOnlyConfirmed',json(CASE NEW.food_only_confirmed WHEN 1 THEN 'true' ELSE 'false' END),'eligibleFoodCents',NEW.eligible_food_cents,'appliedValueCents',NEW.applied_value_cents,'unusedCents',CASE WHEN NEW.applied_value_cents IS NOT NULL THEN NEW.value_cents-NEW.applied_value_cents ELSE NULL END,'reason',NEW.cancel_reason));
END"""
reserve = """CREATE TRIGGER session_reserve AFTER INSERT ON sessions WHEN NEW.reservation_active=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND used_cents+reserved_cents+NEW.cap_cents<=limit_cents) THEN RAISE(ABORT,'normal_budget_exhausted') END;
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.cap_cents WHERE month=NEW.month;
END"""
parts = ['-- Apply AFTER 0003. ENTIRE file in ONE atomic D1 migration/batch.\n-- Do not execute the rebuild statement by statement in the console.\n-- Preserves all rewards, balances, references and historical attestations.\nPRAGMA defer_foreign_keys=ON']
parts += ['DROP TRIGGER '+n for n in ('session_reserve','session_release','reward_validate','reward_allocate','reward_initial_state','reward_transition','reward_audit')]
parts += [budget, 'INSERT INTO budgets_new(month,used_cents,reserved_cents,limit_cents,revision,updated_at,updated_by) SELECT month,used_cents,reserved_cents,limit_cents,revision,updated_at,updated_by FROM budgets', 'DROP TABLE budgets', 'ALTER TABLE budgets_new RENAME TO budgets', reward, 'INSERT INTO rewards_new('+','.join(columns)+') SELECT '+','.join(columns)+' FROM rewards', 'DROP TABLE rewards', 'ALTER TABLE rewards_new RENAME TO rewards']
parts += [schema[n] for n in ('rewards_phone','rewards_page')]
parts += ["CREATE UNIQUE INDEX rewards_manual_request ON rewards(manual_request_id) WHERE source='manual'", reserve, schema['session_release'], validate, allocate, initial, transition, audit, 'CREATE TABLE _manual_migration_guard(violations INTEGER NOT NULL CHECK(violations=0))','INSERT INTO _manual_migration_guard SELECT COUNT(*) FROM pragma_foreign_key_check','DROP TABLE _manual_migration_guard','PRAGMA defer_foreign_keys=OFF']
(root/'migrations/0004_manual_rewards_food_only.sql').write_text(';\n'.join(parts)+';\n')
