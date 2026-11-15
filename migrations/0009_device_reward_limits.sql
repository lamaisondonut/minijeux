-- Apply AFTER 0008 in ONE atomic D1 batch. No production data is deleted.
-- The browser ID is the existing opaque HttpOnly owner cookie, stored as HMAC.
ALTER TABLE rewards ADD COLUMN device_hash TEXT;
DROP TRIGGER reward_transition;
DROP TRIGGER reward_audit;
UPDATE rewards SET device_hash=(SELECT owner_hash FROM sessions WHERE id=rewards.session_id) WHERE source='game';
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
CREATE TRIGGER reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=1 THEN 'preview_test_used' ELSE NEW.status END,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('valueCents',NEW.value_cents,'previewTestConsumed',json(CASE NEW.preview_test_consumed WHEN 1 THEN 'true' ELSE 'false' END),'discountApplied',json(CASE NEW.discount_applied WHEN 1 THEN 'true' ELSE 'false' END),'foodOnlyConfirmed',json(CASE NEW.food_only_confirmed WHEN 1 THEN 'true' ELSE 'false' END),'eligibleFoodCents',NEW.eligible_food_cents,'appliedValueCents',CASE WHEN NEW.preview_test_consumed=1 THEN 0 ELSE NEW.applied_value_cents END,'unusedCents',CASE WHEN NEW.applied_value_cents IS NOT NULL THEN NEW.value_cents-NEW.applied_value_cents ELSE NULL END,'reason',NEW.cancel_reason));
END;
CREATE INDEX rewards_device ON rewards(device_hash,confirmed_at DESC);
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
CREATE INDEX reward_exceptions_subject ON reward_exceptions(scope,subject_hash,expires_at);
CREATE TRIGGER reward_exception_validate BEFORE INSERT ON reward_exceptions BEGIN
 SELECT CASE WHEN NEW.used_reward_id IS NOT NULL OR NEW.used_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.approved_by AND name=NEW.approved_by_name AND role='manager' AND active=1) THEN RAISE(ABORT,'exception_manager_required') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rewards r WHERE r.id=NEW.blocked_reward_id AND r.confirmed_at>NEW.approved_at-2592000000 AND CASE NEW.scope WHEN 'phone' THEN r.phone_hash ELSE r.device_hash END=NEW.subject_hash) THEN RAISE(ABORT,'exception_subject_invalid') END;
END;
CREATE TRIGGER reward_exception_immutable BEFORE UPDATE ON reward_exceptions BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.subject_hash IS NOT OLD.subject_hash OR NEW.blocked_reward_id IS NOT OLD.blocked_reward_id OR NEW.request_id IS NOT OLD.request_id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_by_name IS NOT OLD.approved_by_name OR NEW.approved_at IS NOT OLD.approved_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.reason IS NOT OLD.reason OR OLD.used_reward_id IS NOT NULL OR NEW.used_reward_id IS NULL OR NOT EXISTS(SELECT 1 FROM rewards r WHERE r.id=NEW.used_reward_id AND r.confirmed_at=NEW.used_at AND r.confirmed_at<OLD.expires_at AND CASE OLD.scope WHEN 'phone' THEN r.phone_hash ELSE r.device_hash END=OLD.subject_hash) THEN RAISE(ABORT,'exception_immutable') END;
END;
CREATE TRIGGER reward_exception_audit AFTER INSERT ON reward_exceptions BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.blocked_reward_id,'manager_exception_granted',NEW.approved_by,NEW.approved_by_name,NEW.approved_at,json_object('exceptionId',NEW.id,'scope',NEW.scope,'reason',NEW.reason,'expiresAt',NEW.expires_at,'requestId',NEW.request_id));
END;
CREATE TRIGGER reward_exception_used_audit AFTER UPDATE ON reward_exceptions BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.used_reward_id,'manager_exception_consumed',NEW.approved_by,NEW.approved_by_name,NEW.used_at,json_object('exceptionId',NEW.id,'scope',NEW.scope,'reason',NEW.reason,'previousRewardId',NEW.blocked_reward_id,'valueCents',(SELECT value_cents FROM rewards WHERE id=NEW.used_reward_id)));
END;
DROP TRIGGER reward_validate;
CREATE TRIGGER reward_validate BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NEW.claim_by IS NOT NEW.confirmed_at+2592000000 THEN RAISE(ABORT,'reward_expiry_required') END;
 SELECT CASE WHEN NEW.source='game' AND (NEW.manual_reason IS NOT NULL OR NEW.manual_request_id IS NOT NULL OR NEW.manual_fingerprint IS NOT NULL OR NEW.budget_override<>0 OR NEW.budget_override_reason IS NOT NULL OR NEW.exceptional_cents<>0 OR NEW.cooldown_override<>0 OR NEW.cooldown_override_reason IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND state='eligible' AND reservation_active=1 AND bound_phone_hash=NEW.phone_hash AND score=NEW.score AND month=NEW.month AND expires_at>NEW.confirmed_at AND claim_deadline>NEW.confirmed_at AND cap_cents>=NEW.value_cents AND score>=CASE NEW.value_cents WHEN 2000 THEN 10000 WHEN 1000 THEN 7500 ELSE 5000 END)) THEN RAISE(ABORT,'session_not_eligible') END;
 SELECT CASE WHEN NEW.source='manual' AND (NOT EXISTS(SELECT 1 FROM employees WHERE sub=NEW.last_actor_sub AND name=NEW.last_actor_name AND role='manager' AND active=1) OR length(trim(COALESCE(NEW.manual_reason,''))) NOT BETWEEN 8 AND 500 OR length(COALESCE(NEW.manual_request_id,'')) NOT BETWEEN 16 AND 128 OR length(COALESCE(NEW.manual_fingerprint,''))<16) THEN RAISE(ABORT,'manual_manager_required') END;
 SELECT CASE WHEN NEW.source='manual' AND NOT EXISTS(SELECT 1 FROM budgets WHERE month=NEW.month AND NEW.exceptional_cents=MAX(0,used_cents+reserved_cents+NEW.value_cents-limit_cents)-MAX(0,used_cents+reserved_cents-limit_cents) AND ((used_cents+reserved_cents+NEW.value_cents>limit_cents AND NEW.budget_override=1 AND length(trim(COALESCE(NEW.budget_override_reason,''))) BETWEEN 8 AND 500) OR (used_cents+reserved_cents+NEW.value_cents<=limit_cents AND NEW.budget_override=0 AND NEW.budget_override_reason IS NULL))) THEN RAISE(ABORT,'budget_override_required') END;
 SELECT CASE WHEN NEW.source='manual' AND ((NEW.cooldown_override=1 AND length(trim(COALESCE(NEW.cooldown_override_reason,''))) NOT BETWEEN 8 AND 500) OR (NEW.cooldown_override=0 AND NEW.cooldown_override_reason IS NOT NULL)) THEN RAISE(ABORT,'cooldown_reason_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT(NEW.source='manual' AND NEW.cooldown_override=1) AND NOT(NEW.source='game' AND EXISTS(SELECT 1 FROM reward_exceptions e WHERE e.scope='phone' AND e.subject_hash=NEW.phone_hash AND e.used_reward_id IS NULL AND e.approved_at<=NEW.confirmed_at AND e.expires_at>NEW.confirmed_at AND e.blocked_reward_id=(SELECT id FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1))) THEN RAISE(ABORT,'phone_cooldown') END;
END;
CREATE TRIGGER reward_device_validate BEFORE INSERT ON rewards WHEN NEW.source='game' BEGIN
 SELECT CASE WHEN NEW.device_hash IS NULL OR NEW.device_hash IS NOT(SELECT owner_hash FROM sessions WHERE id=NEW.session_id) THEN RAISE(ABORT,'device_required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000) AND NOT EXISTS(SELECT 1 FROM reward_exceptions e WHERE e.scope='device' AND e.subject_hash=NEW.device_hash AND e.used_reward_id IS NULL AND e.approved_at<=NEW.confirmed_at AND e.expires_at>NEW.confirmed_at AND e.blocked_reward_id=(SELECT id FROM rewards WHERE device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)) THEN RAISE(ABORT,'device_cooldown') END;
END;
CREATE TRIGGER reward_device_immutable BEFORE UPDATE ON rewards WHEN NEW.device_hash IS NOT OLD.device_hash BEGIN
 SELECT RAISE(ABORT,'reward_device_immutable');
END;
CREATE TRIGGER reward_exception_consume AFTER INSERT ON rewards WHEN NEW.source='game' BEGIN
 UPDATE reward_exceptions SET used_reward_id=NEW.id,used_at=NEW.confirmed_at WHERE used_reward_id IS NULL AND approved_at<=NEW.confirmed_at AND expires_at>NEW.confirmed_at AND ((scope='phone' AND subject_hash=NEW.phone_hash AND blocked_reward_id=(SELECT id FROM rewards WHERE id<>NEW.id AND phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)) OR (scope='device' AND subject_hash=NEW.device_hash AND blocked_reward_id=(SELECT id FROM rewards WHERE id<>NEW.id AND device_hash=NEW.device_hash AND confirmed_at>NEW.confirmed_at-2592000000 ORDER BY confirmed_at DESC,id DESC LIMIT 1)));
END;
