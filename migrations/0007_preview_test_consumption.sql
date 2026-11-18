-- Isolated Preview tests only; API additionally checks the Preview host and flag.
-- Apply after 0006, ENTIRE file in one atomic D1 batch.
-- Test consumption never asserts an actual discount in the POS.
ALTER TABLE rewards ADD COLUMN preview_test_consumed INTEGER NOT NULL DEFAULT 0 CHECK(preview_test_consumed IN (0,1));
DROP TRIGGER reward_initial_state;
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
DROP TRIGGER reward_transition;
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
DROP TRIGGER reward_audit;
CREATE TRIGGER reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,CASE WHEN NEW.status='issued' AND NEW.preview_test_consumed=1 THEN 'preview_test_used' ELSE NEW.status END,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('valueCents',NEW.value_cents,'previewTestConsumed',json(CASE NEW.preview_test_consumed WHEN 1 THEN 'true' ELSE 'false' END),'discountApplied',json(CASE NEW.discount_applied WHEN 1 THEN 'true' ELSE 'false' END),'foodOnlyConfirmed',json(CASE NEW.food_only_confirmed WHEN 1 THEN 'true' ELSE 'false' END),'eligibleFoodCents',NEW.eligible_food_cents,'appliedValueCents',CASE WHEN NEW.preview_test_consumed=1 THEN 0 ELSE NEW.applied_value_cents END,'unusedCents',CASE WHEN NEW.applied_value_cents IS NOT NULL THEN NEW.value_cents-NEW.applied_value_cents ELSE NULL END,'reason',NEW.cancel_reason));
END;
