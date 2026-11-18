-- Apply AFTER 0003. ENTIRE file in ONE atomic D1 migration/batch.
-- Do not execute the rebuild statement by statement in the console.
-- Preserves all rewards, balances, references and historical attestations.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER session_reserve;
DROP TRIGGER session_release;
DROP TRIGGER reward_validate;
DROP TRIGGER reward_allocate;
DROP TRIGGER reward_initial_state;
DROP TRIGGER reward_transition;
DROP TRIGGER reward_audit;
CREATE TABLE budgets_new (
 month TEXT PRIMARY KEY NOT NULL,
 used_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(used_cents)='integer' AND used_cents>=0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved_cents)='integer' AND reserved_cents>=0),
 limit_cents INTEGER NOT NULL DEFAULT 10000 CHECK(typeof(limit_cents)='integer' AND limit_cents BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
 updated_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(updated_at)='integer' AND updated_at>=0),
 updated_by TEXT,
 exceptional_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(exceptional_cents)='integer' AND exceptional_cents BETWEEN 0 AND 9007199254740991),
 CHECK(used_cents+reserved_cents<=limit_cents+exceptional_cents)
);
INSERT INTO budgets_new(month,used_cents,reserved_cents,limit_cents,revision,updated_at,updated_by) SELECT month,used_cents,reserved_cents,limit_cents,revision,updated_at,updated_by FROM budgets;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;
CREATE TABLE rewards_new (
 id TEXT PRIMARY KEY, session_id TEXT UNIQUE REFERENCES sessions(id), phone_hash TEXT NOT NULL,
 code TEXT NOT NULL UNIQUE, value_cents INTEGER NOT NULL CHECK(value_cents IN (500,1000,2000)), month TEXT NOT NULL REFERENCES budgets(month),
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, score INTEGER CHECK(score>=5000), confirmed_at INTEGER NOT NULL, claim_by INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','issued','cancelled')),
 claimed_by TEXT, claimed_by_name TEXT, claimed_at INTEGER, issued_by TEXT, issued_by_name TEXT, issued_at INTEGER, cancelled_by_name TEXT, cancelled_at INTEGER,
 lightspeed_ref TEXT, cancel_reason TEXT, last_actor_sub TEXT NOT NULL, last_actor_name TEXT NOT NULL
, discount_applied INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(discount_applied)='integer' AND discount_applied IN (0,1)),
 source TEXT NOT NULL DEFAULT 'game' CHECK(source IN ('game','manual')),
 manual_reason TEXT, manual_request_id TEXT, manual_fingerprint TEXT,
 budget_override INTEGER NOT NULL DEFAULT 0 CHECK(budget_override IN (0,1)), budget_override_reason TEXT,
 exceptional_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(exceptional_cents)='integer' AND exceptional_cents BETWEEN 0 AND 2000),
 cooldown_override INTEGER NOT NULL DEFAULT 0 CHECK(cooldown_override IN (0,1)), cooldown_override_reason TEXT,
 food_only_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(food_only_confirmed IN (0,1)),
 eligible_food_cents INTEGER CHECK(eligible_food_cents IS NULL OR (typeof(eligible_food_cents)='integer' AND eligible_food_cents BETWEEN 1 AND 9007199254740991)),
 applied_value_cents INTEGER CHECK(applied_value_cents IS NULL OR (typeof(applied_value_cents)='integer' AND applied_value_cents BETWEEN 1 AND value_cents)),
 CHECK((source='game' AND session_id IS NOT NULL AND score IS NOT NULL) OR (source='manual' AND session_id IS NULL AND score IS NULL))
);
INSERT INTO rewards_new(id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,status,claimed_by,claimed_by_name,claimed_at,issued_by,issued_by_name,issued_at,cancelled_by_name,cancelled_at,lightspeed_ref,cancel_reason,last_actor_sub,last_actor_name,discount_applied) SELECT id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,status,claimed_by,claimed_by_name,claimed_at,issued_by,issued_by_name,issued_at,cancelled_by_name,cancelled_at,lightspeed_ref,cancel_reason,last_actor_sub,last_actor_name,discount_applied FROM rewards;
DROP TABLE rewards;
ALTER TABLE rewards_new RENAME TO rewards;
CREATE INDEX rewards_phone ON rewards(phone_hash,confirmed_at DESC);
CREATE INDEX rewards_page ON rewards(confirmed_at DESC,id);
CREATE UNIQUE INDEX rewards_manual_request ON rewards(manual_request_id) WHERE source='manual';
CREATE TRIGGER session_reserve AFTER INSERT ON sessions WHEN NEW.reservation_active=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND used_cents+reserved_cents+NEW.cap_cents<=limit_cents) THEN RAISE(ABORT,'normal_budget_exhausted') END;
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.cap_cents WHERE month=NEW.month;
END;
CREATE TRIGGER session_release AFTER UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=1 AND NEW.reservation_active=0 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents-OLD.cap_cents WHERE month=OLD.month;
 UPDATE sessions SET sms_reserved=0 WHERE id=NEW.id AND sms_reserved=1;
END;
CREATE TRIGGER reward_validate BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.claim_by IS NOT NEW.confirmed_at+2592000000 THEN RAISE(ABORT,'reward_expiry_required') END;
 SELECT CASE WHEN NEW.source='game' AND (NEW.manual_reason IS NOT NULL OR NEW.manual_request_id IS NOT NULL OR NEW.manual_fingerprint IS NOT NULL OR NEW.budget_override<>0 OR NEW.budget_override_reason IS NOT NULL OR NEW.exceptional_cents<>0 OR NEW.cooldown_override<>0 OR NEW.cooldown_override_reason IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND state='eligible' AND reservation_active=1 AND bound_phone_hash=NEW.phone_hash AND score=NEW.score AND month=NEW.month AND expires_at>NEW.confirmed_at AND claim_deadline>NEW.confirmed_at AND cap_cents>=NEW.value_cents AND score>=CASE NEW.value_cents WHEN 2000 THEN 10000 WHEN 1000 THEN 7500 ELSE 5000 END)) THEN RAISE(ABORT,'session_not_eligible') END;
 SELECT CASE WHEN NEW.source='manual' AND (NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.last_actor_sub AND name=NEW.last_actor_name AND role='manager' AND active=1) OR length(trim(COALESCE(NEW.manual_reason,''))) NOT BETWEEN 8 AND 500 OR length(COALESCE(NEW.manual_request_id,'')) NOT BETWEEN 16 AND 128 OR length(COALESCE(NEW.manual_fingerprint,''))<16) THEN RAISE(ABORT,'manual_manager_required') END;
 SELECT CASE WHEN NEW.source='manual' AND NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND NEW.exceptional_cents=MAX(0,used_cents+reserved_cents+NEW.value_cents-limit_cents)-MAX(0,used_cents+reserved_cents-limit_cents) AND ((used_cents+reserved_cents+NEW.value_cents>limit_cents AND NEW.budget_override=1 AND length(trim(COALESCE(NEW.budget_override_reason,''))) BETWEEN 8 AND 500) OR (used_cents+reserved_cents+NEW.value_cents<=limit_cents AND NEW.budget_override=0 AND NEW.budget_override_reason IS NULL))) THEN RAISE(ABORT,'budget_override_required') END;
 SELECT CASE WHEN NEW.source='manual' AND ((NEW.cooldown_override=1 AND length(trim(COALESCE(NEW.cooldown_override_reason,''))) NOT BETWEEN 8 AND 500) OR (NEW.cooldown_override=0 AND NEW.cooldown_override_reason IS NOT NULL)) THEN RAISE(ABORT,'cooldown_reason_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT(NEW.source='manual' AND NEW.cooldown_override=1) THEN RAISE(ABORT,'phone_cooldown') END;
END;
CREATE TRIGGER reward_allocate AFTER INSERT ON rewards BEGIN
 UPDATE sessions SET state='awarded',reservation_active=0 WHERE NEW.source='game' AND id=NEW.session_id;
 UPDATE budgets SET used_cents=used_cents+NEW.value_cents,exceptional_cents=exceptional_cents+NEW.exceptional_cents WHERE month=NEW.month;
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE NEW.source WHEN 'manual' THEN 'manual_confirmed' ELSE 'confirmed' END,NEW.last_actor_sub,NEW.last_actor_name,NEW.confirmed_at,
 json_object('source',NEW.source,'valueCents',NEW.value_cents,'reason',NEW.manual_reason,'budgetOverride',json(CASE NEW.budget_override WHEN 1 THEN 'true' ELSE 'false' END),'budgetOverrideReason',NEW.budget_override_reason,'exceptionalCents',NEW.exceptional_cents,'cooldownOverride',json(CASE NEW.cooldown_override WHEN 1 THEN 'true' ELSE 'false' END),'cooldownOverrideReason',NEW.cooldown_override_reason,'requestId',NEW.manual_request_id));
END;
CREATE TRIGGER reward_initial_state BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(trim(NEW.id))=0 OR NEW.status<>'pending'
  OR NEW.discount_applied IS NOT 0 OR NEW.food_only_confirmed IS NOT 0 OR NEW.eligible_food_cents IS NOT NULL OR NEW.applied_value_cents IS NOT NULL
  OR typeof(NEW.confirmed_at)<>'integer' OR typeof(NEW.claim_by)<>'integer'
  OR NEW.confirmed_at<0 OR NEW.claim_by<=NEW.confirmed_at
  OR NEW.claimed_by IS NOT NULL OR NEW.claimed_by_name IS NOT NULL OR NEW.claimed_at IS NOT NULL
  OR NEW.issued_by IS NOT NULL OR NEW.issued_by_name IS NOT NULL OR NEW.issued_at IS NOT NULL
  OR NEW.cancelled_by_name IS NOT NULL OR NEW.cancelled_at IS NOT NULL
  OR NEW.lightspeed_ref IS NOT NULL OR NEW.cancel_reason IS NOT NULL
  THEN RAISE(ABORT,'reward_initial_state') END;
END;
CREATE TRIGGER reward_transition BEFORE UPDATE ON rewards BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.phone_hash IS NOT OLD.phone_hash
  OR NEW.code IS NOT OLD.code OR NEW.value_cents IS NOT OLD.value_cents OR NEW.score IS NOT OLD.score OR NEW.month IS NOT OLD.month
  OR NEW.confirmed_at IS NOT OLD.confirmed_at OR NEW.claim_by IS NOT OLD.claim_by
  OR NEW.first_name IS NOT OLD.first_name OR NEW.last_name IS NOT OLD.last_name
  OR NEW.lightspeed_ref IS NOT OLD.lightspeed_ref
  OR NEW.source IS NOT OLD.source OR NEW.manual_reason IS NOT OLD.manual_reason OR NEW.manual_request_id IS NOT OLD.manual_request_id OR NEW.manual_fingerprint IS NOT OLD.manual_fingerprint OR NEW.budget_override IS NOT OLD.budget_override OR NEW.budget_override_reason IS NOT OLD.budget_override_reason OR NEW.exceptional_cents IS NOT OLD.exceptional_cents OR NEW.cooldown_override IS NOT OLD.cooldown_override OR NEW.cooldown_override_reason IS NOT OLD.cooldown_override_reason
  THEN RAISE(ABORT,'reward_immutable') END;
 SELECT CASE WHEN NOT ((OLD.status='pending' AND NEW.status IN ('claimed','cancelled')) OR (OLD.status='claimed' AND NEW.status IN ('issued','cancelled')))
  THEN RAISE(ABORT,'invalid_transition') END;
 SELECT CASE WHEN OLD.status='claimed' AND (NEW.claimed_by IS NOT OLD.claimed_by OR NEW.claimed_by_name IS NOT OLD.claimed_by_name OR NEW.claimed_at IS NOT OLD.claimed_at)
  THEN RAISE(ABORT,'claim_immutable') END;
 SELECT CASE WHEN NEW.status='issued' AND (NEW.food_only_confirmed IS NOT 1 OR NEW.eligible_food_cents IS NULL OR NEW.applied_value_cents IS NULL OR NEW.applied_value_cents IS NOT MIN(NEW.value_cents,NEW.eligible_food_cents)) THEN RAISE(ABORT,'food_confirmation_required') END;
 SELECT CASE WHEN NEW.status<>'issued' AND (NEW.food_only_confirmed IS NOT OLD.food_only_confirmed OR NEW.eligible_food_cents IS NOT OLD.eligible_food_cents OR NEW.applied_value_cents IS NOT OLD.applied_value_cents) THEN RAISE(ABORT,'food_confirmation_immutable') END;
 SELECT CASE WHEN NEW.status='issued' AND NEW.discount_applied IS NOT 1
  THEN RAISE(ABORT,'discount_confirmation_required') END;
 SELECT CASE WHEN NEW.status<>'issued' AND NEW.discount_applied IS NOT OLD.discount_applied
  THEN RAISE(ABORT,'discount_immutable') END;
 SELECT CASE WHEN NEW.status='claimed' AND (
  length(trim(COALESCE(NEW.claimed_by,''))) NOT BETWEEN 1 AND 256
  OR length(trim(COALESCE(NEW.claimed_by_name,''))) NOT BETWEEN 1 AND 120
  OR NEW.claimed_at IS NULL OR typeof(NEW.claimed_at)<>'integer' OR NEW.claimed_at<OLD.confirmed_at OR NEW.claimed_at>=OLD.claim_by
  OR NEW.last_actor_sub IS NOT NEW.claimed_by OR NEW.last_actor_name IS NOT NEW.claimed_by_name
  OR NEW.issued_by IS NOT NULL OR NEW.issued_by_name IS NOT NULL OR NEW.issued_at IS NOT NULL
  OR NEW.cancelled_by_name IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL)
  THEN RAISE(ABORT,'invalid_claim') END;
 SELECT CASE WHEN NEW.status='issued' AND (
  NEW.issued_by IS NOT OLD.claimed_by OR length(trim(COALESCE(NEW.issued_by,''))) NOT BETWEEN 1 AND 256
  OR length(trim(COALESCE(OLD.claimed_by_name,''))) NOT BETWEEN 1 AND 120
  OR OLD.claimed_at IS NULL OR typeof(OLD.claimed_at)<>'integer'
  OR OLD.claimed_at<OLD.confirmed_at OR OLD.claimed_at>=OLD.claim_by
  OR length(trim(COALESCE(NEW.issued_by_name,''))) NOT BETWEEN 1 AND 120
  OR NEW.issued_at IS NULL OR typeof(NEW.issued_at)<>'integer' OR NEW.issued_at<OLD.claimed_at
  OR NEW.last_actor_sub IS NOT NEW.issued_by OR NEW.last_actor_name IS NOT NEW.issued_by_name
  OR NEW.cancelled_by_name IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL)
  THEN RAISE(ABORT,'claim_owner_required') END;
 SELECT CASE WHEN NEW.status='cancelled' AND (
  length(trim(COALESCE(NEW.cancel_reason,''))) NOT BETWEEN 1 AND 500
  OR length(trim(COALESCE(NEW.cancelled_by_name,''))) NOT BETWEEN 1 AND 120
  OR length(trim(COALESCE(NEW.last_actor_sub,''))) NOT BETWEEN 1 AND 256
  OR NEW.cancelled_at IS NULL OR typeof(NEW.cancelled_at)<>'integer' OR NEW.cancelled_at<COALESCE(OLD.claimed_at,OLD.confirmed_at)
  OR NEW.last_actor_name IS NOT NEW.cancelled_by_name
  OR NEW.claimed_by IS NOT OLD.claimed_by OR NEW.claimed_by_name IS NOT OLD.claimed_by_name OR NEW.claimed_at IS NOT OLD.claimed_at
  OR NEW.issued_by IS NOT NULL OR NEW.issued_by_name IS NOT NULL OR NEW.issued_at IS NOT NULL)
  THEN RAISE(ABORT,'invalid_cancellation') END;
END;
CREATE TRIGGER reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,NEW.status,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('valueCents',NEW.value_cents,'discountApplied',json(CASE NEW.discount_applied WHEN 1 THEN 'true' ELSE 'false' END),'foodOnlyConfirmed',json(CASE NEW.food_only_confirmed WHEN 1 THEN 'true' ELSE 'false' END),'eligibleFoodCents',NEW.eligible_food_cents,'appliedValueCents',NEW.applied_value_cents,'unusedCents',CASE WHEN NEW.applied_value_cents IS NOT NULL THEN NEW.value_cents-NEW.applied_value_cents ELSE NULL END,'reason',NEW.cancel_reason));
END;
CREATE TABLE _manual_migration_guard(violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO _manual_migration_guard SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE _manual_migration_guard;
PRAGMA defer_foreign_keys=OFF;
