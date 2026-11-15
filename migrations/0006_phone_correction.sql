-- Apply after 0005. Entire file in one atomic D1 batch.
-- Existing reservations, score, deadlines and confirmed rewards are preserved.
ALTER TABLE sessions ADD COLUMN active_challenge_id TEXT;
ALTER TABLE sessions ADD COLUMN verification_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_revision)='integer' AND verification_revision>=0);
ALTER TABLE sessions ADD COLUMN verification_next_send_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_next_send_at)='integer' AND verification_next_send_at>=0);
ALTER TABLE sessions ADD COLUMN verification_send_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_send_count)='integer' AND verification_send_count BETWEEN 0 AND 5);
ALTER TABLE challenges ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0);
UPDATE sessions SET active_challenge_id=(SELECT id FROM challenges WHERE session_id=sessions.id ORDER BY created_at DESC,id DESC LIMIT 1),
 verification_send_count=MIN(5,(SELECT COUNT(*) FROM challenges WHERE session_id=sessions.id)),
 verification_next_send_at=COALESCE((SELECT MAX(created_at)+60000 FROM challenges WHERE session_id=sessions.id),0)
 WHERE state='eligible' AND reservation_active=1;
UPDATE challenges SET state='failed',lease_until=NULL WHERE session_id IN(SELECT id FROM sessions WHERE state='eligible' AND reservation_active=1) AND id IS NOT(SELECT active_challenge_id FROM sessions WHERE id=challenges.session_id);
CREATE TRIGGER session_verification_no_rewind BEFORE UPDATE ON sessions BEGIN
 SELECT CASE WHEN NEW.verification_revision<OLD.verification_revision OR NEW.verification_send_count<OLD.verification_send_count THEN RAISE(ABORT,'verification_cannot_rewind') END;
 SELECT CASE WHEN NEW.active_challenge_id IS NOT OLD.active_challenge_id AND (OLD.state<>'eligible' OR OLD.reservation_active<>1 OR NEW.verification_revision<>OLD.verification_revision+1 OR NEW.verification_send_count<>OLD.verification_send_count+1) THEN RAISE(ABORT,'invalid_verification_change') END;
END;
CREATE TRIGGER challenge_verification_identity BEFORE UPDATE ON challenges BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.owner_hash IS NOT OLD.owner_hash OR NEW.session_id IS NOT OLD.session_id OR NEW.phone_hash IS NOT OLD.phone_hash OR NEW.revision IS NOT OLD.revision THEN RAISE(ABORT,'challenge_identity_immutable') END;
END;
