-- Apply AFTER 0007. Execute this entire file in one atomic D1 migration/batch.
-- Keeps budgets, scores, reservations, codes and audit history unchanged.
-- Existing game rewards came through the SMS-only flow; manual rewards did not.
ALTER TABLE sessions ADD COLUMN phone_verification_mode TEXT NOT NULL DEFAULT 'sms' CHECK(phone_verification_mode IN ('sms','unverified'));
ALTER TABLE rewards ADD COLUMN phone_ciphertext TEXT CHECK(phone_ciphertext IS NULL OR (typeof(phone_ciphertext)='text' AND length(phone_ciphertext) BETWEEN 32 AND 256 AND phone_ciphertext GLOB 'v1.*'));
ALTER TABLE rewards ADD COLUMN phone_last4 TEXT CHECK(phone_last4 IS NULL OR (typeof(phone_last4)='text' AND length(phone_last4)=4 AND phone_last4 NOT GLOB '*[^0-9]*'));
ALTER TABLE rewards ADD COLUMN name_search TEXT NOT NULL DEFAULT '' CHECK(length(name_search)<=1024);
ALTER TABLE rewards ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 1 CHECK(typeof(phone_verified)='integer' AND phone_verified IN (0,1));
DROP TRIGGER reward_transition;
DROP TRIGGER reward_audit;
UPDATE rewards SET phone_verified=CASE source WHEN 'manual' THEN 0 ELSE 1 END,name_search=lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(trim(first_name||' '||last_name),'À','a'),'à','a'),'Â','a'),'â','a'),'Ä','a'),'ä','a'),'Á','a'),'á','a'),'Ã','a'),'ã','a'),'Å','a'),'å','a'),'Ç','c'),'ç','c'),'É','e'),'é','e'),'È','e'),'è','e'),'Ê','e'),'ê','e'),'Ë','e'),'ë','e'),'Î','i'),'î','i'),'Ï','i'),'ï','i'),'Í','i'),'í','i'),'Ì','i'),'ì','i'),'Ô','o'),'ô','o'),'Ö','o'),'ö','o'),'Ó','o'),'ó','o'),'Ò','o'),'ò','o'),'Õ','o'),'õ','o'),'Ù','u'),'ù','u'),'Û','u'),'û','u'),'Ü','u'),'ü','u'),'Ú','u'),'ú','u'),'Ÿ','y'),'ÿ','y'),'Ý','y'),'ý','y'),'Œ','oe'),'œ','oe'),'Æ','ae'),'æ','ae'));
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
DROP TRIGGER session_sms_required;
CREATE TRIGGER session_sms_required BEFORE INSERT ON sessions BEGIN
 SELECT CASE WHEN NEW.mode='rewards' AND NEW.phone_verification_mode='sms' AND (NEW.sms_reserved<>1 OR NEW.sms_day IS NULL) THEN RAISE(ABORT,'sms_slot_required') END;
 SELECT CASE WHEN NEW.phone_verification_mode='unverified' AND (NEW.sms_reserved<>0 OR NEW.sms_consumed<>0 OR NEW.sms_day IS NOT NULL) THEN RAISE(ABORT,'unverified_sms_slot_forbidden') END;
END;
CREATE TRIGGER session_phone_mode_immutable BEFORE UPDATE OF phone_verification_mode ON sessions WHEN NEW.phone_verification_mode IS NOT OLD.phone_verification_mode BEGIN
 SELECT RAISE(ABORT,'session_phone_mode_immutable');
END;
CREATE TRIGGER reward_customer_initial BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN (NEW.phone_ciphertext IS NULL)<>(NEW.phone_last4 IS NULL) THEN RAISE(ABORT,'customer_phone_incomplete') END;
 SELECT CASE WHEN NEW.source='manual' AND NEW.phone_verified<>0 THEN RAISE(ABORT,'manual_phone_not_verified') END;
 SELECT CASE WHEN NEW.source='game' AND EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND phone_verification_mode='unverified') AND (NEW.phone_verified<>0 OR NEW.phone_ciphertext IS NULL OR length(trim(NEW.name_search))<1) THEN RAISE(ABORT,'unverified_customer_required') END;
 SELECT CASE WHEN NEW.source='game' AND EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND phone_verification_mode='sms') AND NEW.phone_verified<>1 THEN RAISE(ABORT,'verified_phone_required') END;
END;
CREATE TRIGGER reward_customer_immutable BEFORE UPDATE ON rewards WHEN NEW.phone_ciphertext IS NOT OLD.phone_ciphertext OR NEW.phone_last4 IS NOT OLD.phone_last4 OR NEW.name_search IS NOT OLD.name_search OR NEW.phone_verified IS NOT OLD.phone_verified BEGIN
 SELECT RAISE(ABORT,'reward_customer_immutable');
END;
