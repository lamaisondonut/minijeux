-- NEW EMPTY PREVIEW DATABASE ONLY. Never run on production or an existing schema.

-- Run the first PRAGMA and SELECT: application_tables MUST be 0.

-- Then execute each complete statement in order, keeping each whole trigger intact.

PRAGMA foreign_keys=ON;

SELECT COUNT(*) AS application_tables FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*';

CREATE TABLE audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, reward_id TEXT, action TEXT NOT NULL, actor_sub TEXT NOT NULL, actor_name TEXT NOT NULL,
 created_at INTEGER NOT NULL, details TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE "budgets" (
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

CREATE TABLE challenges (
 id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id), phone_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 state TEXT NOT NULL CHECK(state IN ('sending','pending','checking','verified','failed')), lease_until INTEGER,
 provider_sid TEXT, consent_version TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL
, revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0));

CREATE TABLE employees (
 sub TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 role TEXT NOT NULL CHECK(role IN ('staff','manager')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE notification_sms (
 id TEXT PRIMARY KEY NOT NULL,
 reward_id TEXT NOT NULL REFERENCES rewards(id),
 request_id TEXT NOT NULL UNIQUE,
 actor_sub TEXT NOT NULL,
 phone_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('initial','resend')),
 state TEXT NOT NULL CHECK(state IN ('sending','accepted','failed','uncertain')),
 created_at INTEGER NOT NULL,
 provider_sid TEXT,
 sent_at INTEGER,
 error_code TEXT
);

CREATE TABLE notification_sms_daily (
 day TEXT PRIMARY KEY NOT NULL,
 count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(count)='integer' AND count BETWEEN 0 AND 100)
);

CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count>=0)
);

CREATE TABLE reward_budget_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 default_monthly_limit_cents INTEGER NOT NULL DEFAULT 10000
   CHECK(typeof(default_monthly_limit_cents)='integer' AND default_monthly_limit_cents BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
 updated_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(updated_at)='integer' AND updated_at>=0),
 updated_by TEXT
);

CREATE TABLE reward_exceptions (
 id TEXT PRIMARY KEY NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('phone','device')),
 subject_hash TEXT NOT NULL,
 blocked_reward_id TEXT NOT NULL REFERENCES rewards(id),
 request_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 approved_by_name TEXT NOT NULL,
 approved_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>approved_at AND expires_at<=approved_at+86400000),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 used_reward_id TEXT REFERENCES rewards(id),
 used_at INTEGER,
 UNIQUE(request_id,scope),
 CHECK((used_reward_id IS NULL AND used_at IS NULL) OR (used_reward_id IS NOT NULL AND typeof(used_at)='integer' AND used_at>=approved_at))
);

CREATE TABLE "rewards" (
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
 applied_value_cents INTEGER CHECK(applied_value_cents IS NULL OR (typeof(applied_value_cents)='integer' AND applied_value_cents BETWEEN 1 AND value_cents)), preview_test_consumed INTEGER NOT NULL DEFAULT 0 CHECK(preview_test_consumed IN (0,1)), phone_ciphertext TEXT CHECK(phone_ciphertext IS NULL OR (typeof(phone_ciphertext)='text' AND length(phone_ciphertext) BETWEEN 32 AND 256 AND phone_ciphertext GLOB 'v1.*')), phone_last4 TEXT CHECK(phone_last4 IS NULL OR (typeof(phone_last4)='text' AND length(phone_last4)=4 AND phone_last4 NOT GLOB '*[^0-9]*')), name_search TEXT NOT NULL DEFAULT '' CHECK(length(name_search)<=1024), phone_verified INTEGER NOT NULL DEFAULT 1 CHECK(typeof(phone_verified)='integer' AND phone_verified IN (0,1)), device_hash TEXT,
 CHECK((source='game' AND session_id IS NOT NULL AND score IS NOT NULL) OR (source='manual' AND session_id IS NULL AND score IS NULL))
);

CREATE TABLE sessions (
 id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, seed INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('rewards','extreme')), engine_version TEXT NOT NULL,
 month TEXT NOT NULL REFERENCES budgets(month), cap_cents INTEGER NOT NULL CHECK(cap_cents IN (0,500,1000,2000)),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'started' CHECK(state IN ('started','eligible','lost','awarded')),
 reservation_active INTEGER NOT NULL CHECK(reservation_active IN (0,1)), score INTEGER, finish_json TEXT, claim_deadline INTEGER,
 bound_phone_hash TEXT, first_name TEXT, last_name TEXT,
 sms_day TEXT, sms_reserved INTEGER NOT NULL DEFAULT 0 CHECK(sms_reserved IN (0,1)), sms_consumed INTEGER NOT NULL DEFAULT 0 CHECK(sms_consumed IN (0,1)), active_challenge_id TEXT, verification_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_revision)='integer' AND verification_revision>=0), verification_next_send_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_next_send_at)='integer' AND verification_next_send_at>=0), verification_send_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_send_count)='integer' AND verification_send_count BETWEEN 0 AND 5), phone_verification_mode TEXT NOT NULL DEFAULT 'sms' CHECK(phone_verification_mode IN ('sms','unverified')),
 CHECK(sms_reserved=0 OR (sms_day IS NOT NULL AND sms_consumed=0)),
 CHECK((cap_cents=0 AND mode='extreme' AND reservation_active=0) OR (cap_cents>0 AND mode='rewards'))
);

CREATE TABLE sms_daily (day TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),CHECK(count+reserved<=100));

CREATE UNIQUE INDEX audit_budget_request
 ON audit(json_extract(details,'$.requestId')) WHERE action='budget_changed';

CREATE INDEX audit_reward ON audit(reward_id,id DESC);

CREATE INDEX challenges_session ON challenges(session_id,created_at DESC);

CREATE UNIQUE INDEX notification_sms_initial ON notification_sms(reward_id) WHERE kind='initial';

CREATE INDEX notification_sms_reward ON notification_sms(reward_id,created_at DESC);

CREATE INDEX reward_exceptions_subject ON reward_exceptions(scope,subject_hash,expires_at);

CREATE INDEX rewards_device ON rewards(device_hash,confirmed_at DESC);

CREATE UNIQUE INDEX rewards_manual_request ON rewards(manual_request_id) WHERE source='manual';

CREATE INDEX rewards_page ON rewards(confirmed_at DESC,id);

CREATE INDEX rewards_phone ON rewards(phone_hash,confirmed_at DESC);

CREATE INDEX sessions_expiry ON sessions(reservation_active,expires_at);

CREATE INDEX sessions_owner ON sessions(owner_hash,created_at DESC);

CREATE TRIGGER challenge_verification_identity BEFORE UPDATE ON challenges BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.owner_hash IS NOT OLD.owner_hash OR NEW.session_id IS NOT OLD.session_id OR NEW.phone_hash IS NOT OLD.phone_hash OR NEW.revision IS NOT OLD.revision THEN RAISE(ABORT,'challenge_identity_immutable') END;
END;

CREATE TRIGGER reward_allocate AFTER INSERT ON rewards BEGIN
 UPDATE sessions SET state='awarded',reservation_active=0 WHERE NEW.source='game' AND id=NEW.session_id;
 UPDATE budgets SET used_cents=used_cents+NEW.value_cents,exceptional_cents=exceptional_cents+NEW.exceptional_cents WHERE month=NEW.month;
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE NEW.source WHEN 'manual' THEN 'manual_confirmed' ELSE 'confirmed' END,NEW.last_actor_sub,NEW.last_actor_name,NEW.confirmed_at,
 json_object('source',NEW.source,'valueCents',NEW.value_cents,'reason',NEW.manual_reason,'budgetOverride',json(CASE NEW.budget_override WHEN 1 THEN 'true' ELSE 'false' END),'budgetOverrideReason',NEW.budget_override_reason,'exceptionalCents',NEW.exceptional_cents,'cooldownOverride',json(CASE NEW.cooldown_override WHEN 1 THEN 'true' ELSE 'false' END),'cooldownOverrideReason',NEW.cooldown_override_reason,'requestId',NEW.manual_request_id));
END;

CREATE TRIGGER reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=1 THEN 'preview_test_used' ELSE NEW.status END,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('valueCents',NEW.value_cents,'previewTestConsumed',json(CASE NEW.preview_test_consumed WHEN 1 THEN 'true' ELSE 'false' END),'discountApplied',json(CASE NEW.discount_applied WHEN 1 THEN 'true' ELSE 'false' END),'foodOnlyConfirmed',json(CASE NEW.food_only_confirmed WHEN 1 THEN 'true' ELSE 'false' END),'eligibleFoodCents',NEW.eligible_food_cents,'appliedValueCents',CASE WHEN NEW.preview_test_consumed=1 THEN 0 ELSE NEW.applied_value_cents END,'unusedCents',CASE WHEN NEW.applied_value_cents IS NOT NULL THEN NEW.value_cents-NEW.applied_value_cents ELSE NULL END,'reason',NEW.cancel_reason));
END;

CREATE TRIGGER reward_customer_immutable BEFORE UPDATE ON rewards WHEN NEW.phone_ciphertext IS NOT OLD.phone_ciphertext OR NEW.phone_last4 IS NOT OLD.phone_last4 OR NEW.name_search IS NOT OLD.name_search OR NEW.phone_verified IS NOT OLD.phone_verified BEGIN
 SELECT RAISE(ABORT,'reward_customer_immutable');
END;

CREATE TRIGGER reward_customer_initial BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN (NEW.phone_ciphertext IS NULL)<>(NEW.phone_last4 IS NULL) THEN RAISE(ABORT,'customer_phone_incomplete') END;
 SELECT CASE WHEN NEW.source='manual' AND NEW.phone_verified<>0 THEN RAISE(ABORT,'manual_phone_not_verified') END;
 SELECT CASE WHEN NEW.source='game' AND EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND phone_verification_mode='unverified') AND (NEW.phone_verified<>0 OR NEW.phone_ciphertext IS NULL OR length(trim(NEW.name_search))<1) THEN RAISE(ABORT,'unverified_customer_required') END;
 SELECT CASE WHEN NEW.source='game' AND EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND phone_verification_mode='sms') AND NEW.phone_verified<>1 THEN RAISE(ABORT,'verified_phone_required') END;
END;

CREATE TRIGGER reward_device_immutable BEFORE UPDATE ON rewards WHEN NEW.device_hash IS NOT OLD.device_hash BEGIN
 SELECT RAISE(ABORT,'reward_device_immutable');
END;

CREATE TRIGGER reward_device_validate BEFORE INSERT ON rewards WHEN NEW.source='game' BEGIN
 SELECT CASE WHEN NEW.device_hash IS NULL OR NEW.device_hash IS NOT(SELECT owner_hash FROM sessions WHERE id=NEW.session_id) THEN RAISE(ABORT,'device_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT EXISTS(SELECT 1 FROM reward_exceptions e WHERE e.scope='device' AND e.subject_hash=NEW.device_hash AND e.used_reward_id IS NULL AND e.approved_at<=NEW.confirmed_at AND e.expires_at>NEW.confirmed_at AND e.blocked_reward_id=(SELECT id FROM rewards WHERE device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)) THEN RAISE(ABORT,'device_cooldown') END;
END;

CREATE TRIGGER reward_exception_audit AFTER INSERT ON reward_exceptions BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.blocked_reward_id,'manager_exception_granted',NEW.approved_by,NEW.approved_by_name,NEW.approved_at,json_object('exceptionId',NEW.id,'scope',NEW.scope,'reason',NEW.reason,'expiresAt',NEW.expires_at,'requestId',NEW.request_id));
END;

CREATE TRIGGER reward_exception_consume AFTER INSERT ON rewards WHEN NEW.source='game' BEGIN
 UPDATE reward_exceptions SET used_reward_id=NEW.id,used_at=NEW.confirmed_at WHERE used_reward_id IS NULL AND approved_at<=NEW.confirmed_at AND expires_at>NEW.confirmed_at AND ((scope='phone' AND subject_hash=NEW.phone_hash AND blocked_reward_id=(SELECT id FROM rewards WHERE id<>NEW.id AND phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)) OR (scope='device' AND subject_hash=NEW.device_hash AND blocked_reward_id=(SELECT id FROM rewards WHERE id<>NEW.id AND device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)));
END;

CREATE TRIGGER reward_exception_immutable BEFORE UPDATE ON reward_exceptions BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.subject_hash IS NOT OLD.subject_hash OR NEW.blocked_reward_id IS NOT OLD.blocked_reward_id OR NEW.request_id IS NOT OLD.request_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_by_name IS NOT OLD.approved_by_name OR NEW.approved_at IS NOT OLD.approved_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.reason IS NOT OLD.reason OR OLD.used_reward_id IS NOT NULL OR NEW.used_reward_id IS NULL OR NOT EXISTS(SELECT 1 FROM rewards r WHERE r.id=NEW.used_reward_id AND r.confirmed_at=NEW.used_at AND r.confirmed_at<OLD.expires_at AND CASE OLD.scope WHEN 'phone' THEN r.phone_hash ELSE r.device_hash END=OLD.subject_hash) THEN RAISE(ABORT,'exception_immutable') END;
END;

CREATE TRIGGER reward_exception_used_audit AFTER UPDATE ON reward_exceptions BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.used_reward_id,'manager_exception_consumed',NEW.approved_by,NEW.approved_by_name,NEW.used_at,json_object('exceptionId',NEW.id,'scope',NEW.scope,'reason',NEW.reason,'previousRewardId',NEW.blocked_reward_id,'valueCents',(SELECT value_cents FROM rewards WHERE id=NEW.used_reward_id)));
END;

CREATE TRIGGER reward_exception_validate BEFORE INSERT ON reward_exceptions BEGIN
 SELECT CASE WHEN NEW.used_reward_id IS NOT NULL OR NEW.used_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.approved_by AND name=NEW.approved_by_name AND role='manager' AND active=1) THEN RAISE(ABORT,'exception_manager_required') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rewards r WHERE r.id=NEW.blocked_reward_id AND r.confirmed_at>NEW.approved_at-2592000000 AND CASE NEW.scope WHEN 'phone' THEN r.phone_hash ELSE r.device_hash END=NEW.subject_hash) THEN RAISE(ABORT,'exception_subject_invalid') END;
END;

CREATE TRIGGER reward_initial_state BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.id IS NULL OR length(trim(NEW.id))=0 OR NEW.status<>'pending'
  OR NEW.preview_test_consumed IS NOT 0 OR NEW.discount_applied IS NOT 0 OR NEW.food_only_confirmed IS NOT 0 OR NEW.eligible_food_cents IS NOT NULL OR NEW.applied_value_cents IS NOT NULL
  OR typeof(NEW.confirmed_at)<>'integer' OR typeof(NEW.claim_by)<>'integer'
  OR NEW.confirmed_at<0 OR NEW.claim_by<=NEW.confirmed_at
  OR NEW.claimed_by IS NOT NULL OR NEW.claimed_by_name IS NOT NULL OR NEW.claimed_at IS NOT NULL
  OR NEW.issued_by IS NOT NULL OR NEW.issued_by_name IS NOT NULL OR NEW.issued_at IS NOT NULL
  OR NEW.cancelled_by_name IS NOT NULL OR NEW.cancelled_at IS NOT NULL
  OR NEW.lightspeed_ref IS NOT NULL OR NEW.cancel_reason IS NOT NULL
  THEN RAISE(ABORT,'reward_initial_state') END;
END;

CREATE TRIGGER reward_transition BEFORE UPDATE ON rewards BEGIN
 SELECT CASE WHEN NEW.status<>'issued' AND NEW.preview_test_consumed IS NOT OLD.preview_test_consumed THEN RAISE(ABORT,'test_consumption_immutable') END;
 SELECT CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=1 AND (NEW.discount_applied<>0 OR NEW.food_only_confirmed<>0 OR NEW.eligible_food_cents IS NOT NULL OR NEW.applied_value_cents IS NOT NULL) THEN RAISE(ABORT,'test_discount_not_applied') END;
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
 SELECT CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=0 AND (NEW.food_only_confirmed IS NOT 1 OR NEW.eligible_food_cents IS NULL OR NEW.applied_value_cents IS NULL OR NEW.applied_value_cents IS NOT MIN(NEW.value_cents,NEW.eligible_food_cents)) THEN RAISE(ABORT,'food_confirmation_required') END;
 SELECT CASE WHEN NEW.status<>'issued' AND (NEW.food_only_confirmed IS NOT OLD.food_only_confirmed OR NEW.eligible_food_cents IS NOT OLD.eligible_food_cents OR NEW.applied_value_cents IS NOT OLD.applied_value_cents) THEN RAISE(ABORT,'food_confirmation_immutable') END;
 SELECT CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=0 AND NEW.discount_applied IS NOT 1
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

CREATE TRIGGER reward_validate BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.claim_by IS NOT NEW.confirmed_at+2592000000 THEN RAISE(ABORT,'reward_expiry_required') END;
 SELECT CASE WHEN NEW.source='game' AND (NEW.manual_reason IS NOT NULL OR NEW.manual_request_id IS NOT NULL OR NEW.manual_fingerprint IS NOT NULL OR NEW.budget_override<>0 OR NEW.budget_override_reason IS NOT NULL OR NEW.exceptional_cents<>0 OR NEW.cooldown_override<>0 OR NEW.cooldown_override_reason IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND state='eligible' AND reservation_active=1 AND bound_phone_hash=NEW.phone_hash AND score=NEW.score AND month=NEW.month AND expires_at>NEW.confirmed_at AND claim_deadline>NEW.confirmed_at AND cap_cents>=NEW.value_cents AND score>=CASE NEW.value_cents WHEN 2000 THEN 10000 WHEN 1000 THEN 7500 ELSE 5000 END)) THEN RAISE(ABORT,'session_not_eligible') END;
 SELECT CASE WHEN NEW.source='manual' AND (NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.last_actor_sub AND name=NEW.last_actor_name AND role='manager' AND active=1) OR length(trim(COALESCE(NEW.manual_reason,''))) NOT BETWEEN 8 AND 500 OR length(COALESCE(NEW.manual_request_id,'')) NOT BETWEEN 16 AND 128 OR length(COALESCE(NEW.manual_fingerprint,''))<16) THEN RAISE(ABORT,'manual_manager_required') END;
 SELECT CASE WHEN NEW.source='manual' AND NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND NEW.exceptional_cents=MAX(0,used_cents+reserved_cents+NEW.value_cents-limit_cents)-MAX(0,used_cents+reserved_cents-limit_cents) AND ((used_cents+reserved_cents+NEW.value_cents>limit_cents AND NEW.budget_override=1 AND length(trim(COALESCE(NEW.budget_override_reason,''))) BETWEEN 8 AND 500) OR (used_cents+reserved_cents+NEW.value_cents<=limit_cents AND NEW.budget_override=0 AND NEW.budget_override_reason IS NULL))) THEN RAISE(ABORT,'budget_override_required') END;
 SELECT CASE WHEN NEW.source='manual' AND ((NEW.cooldown_override=1 AND length(trim(COALESCE(NEW.cooldown_override_reason,''))) NOT BETWEEN 8 AND 500) OR (NEW.cooldown_override=0 AND NEW.cooldown_override_reason IS NOT NULL)) THEN RAISE(ABORT,'cooldown_reason_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT(NEW.source='manual' AND NEW.cooldown_override=1) AND NOT(NEW.source='game' AND EXISTS(SELECT 1 FROM reward_exceptions e WHERE e.scope='phone' AND e.subject_hash=NEW.phone_hash AND e.used_reward_id IS NULL AND e.approved_at<=NEW.confirmed_at AND e.expires_at>NEW.confirmed_at AND e.blocked_reward_id=(SELECT id FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1))) THEN RAISE(ABORT,'phone_cooldown') END;
END;

CREATE TRIGGER session_no_reactivate BEFORE UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=0 AND NEW.reservation_active=1 BEGIN
 SELECT RAISE(ABORT,'reservation_cannot_reactivate');
END;

CREATE TRIGGER session_phone_mode_immutable BEFORE UPDATE OF phone_verification_mode ON sessions WHEN NEW.phone_verification_mode IS NOT OLD.phone_verification_mode BEGIN
 SELECT RAISE(ABORT,'session_phone_mode_immutable');
END;

CREATE TRIGGER session_release AFTER UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=1 AND NEW.reservation_active=0 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents-OLD.cap_cents WHERE month=OLD.month;
 UPDATE sessions SET sms_reserved=0 WHERE id=NEW.id AND sms_reserved=1;
END;

CREATE TRIGGER session_reserve AFTER INSERT ON sessions WHEN NEW.reservation_active=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND used_cents+reserved_cents+NEW.cap_cents<=limit_cents) THEN RAISE(ABORT,'normal_budget_exhausted') END;
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.cap_cents WHERE month=NEW.month;
END;

CREATE TRIGGER session_sms_no_reactivate BEFORE UPDATE OF sms_reserved ON sessions WHEN OLD.sms_reserved=0 AND NEW.sms_reserved=1 BEGIN
 SELECT RAISE(ABORT,'sms_slot_cannot_reactivate');
END;

CREATE TRIGGER session_sms_release AFTER UPDATE OF sms_reserved ON sessions WHEN OLD.sms_reserved=1 AND NEW.sms_reserved=0 BEGIN
 UPDATE sms_daily SET reserved=reserved-1,count=count+CASE WHEN NEW.sms_consumed=1 AND OLD.sms_consumed=0 THEN 1 ELSE 0 END WHERE day=OLD.sms_day;
END;

CREATE TRIGGER session_sms_required BEFORE INSERT ON sessions BEGIN
 SELECT CASE WHEN NEW.mode='rewards' AND NEW.phone_verification_mode='sms' AND (NEW.sms_reserved<>1 OR NEW.sms_day IS NULL) THEN RAISE(ABORT,'sms_slot_required') END;
 SELECT CASE WHEN NEW.phone_verification_mode='unverified' AND (NEW.sms_reserved<>0 OR NEW.sms_consumed<>0 OR NEW.sms_day IS NOT NULL) THEN RAISE(ABORT,'unverified_sms_slot_forbidden') END;
END;

CREATE TRIGGER session_sms_reserve AFTER INSERT ON sessions WHEN NEW.sms_reserved=1 BEGIN
 UPDATE sms_daily SET reserved=reserved+1 WHERE day=NEW.sms_day;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'sms_day_missing') END;
END;

CREATE TRIGGER session_verification_no_rewind BEFORE UPDATE ON sessions BEGIN
 SELECT CASE WHEN NEW.verification_revision<OLD.verification_revision OR NEW.verification_send_count<OLD.verification_send_count THEN RAISE(ABORT,'verification_cannot_rewind') END;
 SELECT CASE WHEN NEW.active_challenge_id IS NOT OLD.active_challenge_id AND (OLD.state<>'eligible' OR OLD.reservation_active<>1 OR NEW.verification_revision<>OLD.verification_revision+1 OR NEW.verification_send_count<>OLD.verification_send_count+1) THEN RAISE(ABORT,'invalid_verification_change') END;
END;

INSERT INTO reward_budget_settings(id) VALUES(1);

PRAGMA foreign_key_check;
