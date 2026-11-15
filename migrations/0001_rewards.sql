PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS budgets (
 month TEXT PRIMARY KEY, used_cents INTEGER NOT NULL DEFAULT 0 CHECK(used_cents>=0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0),
 CHECK(used_cents+reserved_cents<=10000)
);
CREATE TABLE IF NOT EXISTS employees (
 sub TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 role TEXT NOT NULL CHECK(role IN ('staff','manager')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, seed INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('rewards','extreme')), engine_version TEXT NOT NULL,
 month TEXT NOT NULL REFERENCES budgets(month), cap_cents INTEGER NOT NULL CHECK(cap_cents IN (0,500,1000,2000)),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'started' CHECK(state IN ('started','eligible','lost','awarded')),
 reservation_active INTEGER NOT NULL CHECK(reservation_active IN (0,1)), score INTEGER, finish_json TEXT, claim_deadline INTEGER,
 bound_phone_hash TEXT, first_name TEXT, last_name TEXT,
 sms_day TEXT, sms_reserved INTEGER NOT NULL DEFAULT 0 CHECK(sms_reserved IN (0,1)), sms_consumed INTEGER NOT NULL DEFAULT 0 CHECK(sms_consumed IN (0,1)),
 CHECK(sms_reserved=0 OR (sms_day IS NOT NULL AND sms_consumed=0)),
 CHECK((cap_cents=0 AND mode='extreme' AND reservation_active=0) OR (cap_cents>0 AND mode='rewards'))
);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(reservation_active,expires_at);
CREATE TRIGGER IF NOT EXISTS session_reserve AFTER INSERT ON sessions WHEN NEW.reservation_active=1 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.cap_cents WHERE month=NEW.month;
END;
CREATE TRIGGER IF NOT EXISTS session_release AFTER UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=1 AND NEW.reservation_active=0 BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents-OLD.cap_cents WHERE month=OLD.month;
 UPDATE sessions SET sms_reserved=0 WHERE id=NEW.id AND sms_reserved=1;
END;
CREATE TRIGGER IF NOT EXISTS session_no_reactivate BEFORE UPDATE OF reservation_active ON sessions WHEN OLD.reservation_active=0 AND NEW.reservation_active=1 BEGIN
 SELECT RAISE(ABORT,'reservation_cannot_reactivate');
END;
CREATE TABLE IF NOT EXISTS challenges (
 id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id), phone_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 state TEXT NOT NULL CHECK(state IN ('sending','pending','checking','verified','failed')), lease_until INTEGER,
 provider_sid TEXT, consent_version TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_session ON challenges(session_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rewards (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id), phone_hash TEXT NOT NULL,
 code TEXT NOT NULL UNIQUE, value_cents INTEGER NOT NULL CHECK(value_cents IN (500,1000,2000)), month TEXT NOT NULL REFERENCES budgets(month),
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, score INTEGER NOT NULL CHECK(score>=5000), confirmed_at INTEGER NOT NULL, claim_by INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','issued','cancelled')),
 claimed_by TEXT, claimed_by_name TEXT, claimed_at INTEGER, issued_by TEXT, issued_by_name TEXT, issued_at INTEGER, cancelled_by_name TEXT, cancelled_at INTEGER,
 lightspeed_ref TEXT, cancel_reason TEXT, last_actor_sub TEXT NOT NULL, last_actor_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rewards_phone ON rewards(phone_hash,confirmed_at DESC);
CREATE INDEX IF NOT EXISTS rewards_page ON rewards(confirmed_at DESC,id);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, reward_id TEXT, action TEXT NOT NULL, actor_sub TEXT NOT NULL, actor_name TEXT NOT NULL,
 created_at INTEGER NOT NULL, details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_reward ON audit(reward_id,id DESC);
CREATE TRIGGER IF NOT EXISTS reward_validate BEFORE INSERT ON rewards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND state='eligible' AND reservation_active=1 AND bound_phone_hash=NEW.phone_hash AND score=NEW.score AND month=NEW.month AND expires_at>NEW.confirmed_at AND claim_deadline>NEW.confirmed_at AND cap_cents>=NEW.value_cents AND score>=CASE NEW.value_cents WHEN 2000 THEN 10000 WHEN 1000 THEN 7500 ELSE 5000 END) THEN RAISE(ABORT,'session_not_eligible') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rewards WHERE phone_hash=NEW.phone_hash AND confirmed_at>NEW.confirmed_at-2592000000) THEN RAISE(ABORT,'phone_cooldown') END;
END;
CREATE TRIGGER IF NOT EXISTS reward_allocate AFTER INSERT ON rewards BEGIN
 UPDATE sessions SET state='awarded',reservation_active=0 WHERE id=NEW.session_id;
 UPDATE budgets SET used_cents=used_cents+NEW.value_cents WHERE month=NEW.month;
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(NEW.id,'confirmed',NEW.last_actor_sub,NEW.last_actor_name,NEW.confirmed_at,'{}');
END;
CREATE TRIGGER IF NOT EXISTS reward_transition BEFORE UPDATE ON rewards BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.session_id<>OLD.session_id OR NEW.phone_hash<>OLD.phone_hash OR NEW.code<>OLD.code OR NEW.value_cents<>OLD.value_cents OR NEW.score<>OLD.score OR NEW.month<>OLD.month OR NEW.confirmed_at<>OLD.confirmed_at OR NEW.claim_by<>OLD.claim_by THEN RAISE(ABORT,'reward_immutable') END;
 SELECT CASE WHEN NOT ((OLD.status='pending' AND NEW.status IN ('claimed','cancelled')) OR (OLD.status='claimed' AND NEW.status IN ('issued','cancelled'))) THEN RAISE(ABORT,'invalid_transition') END;
 SELECT CASE WHEN NEW.status='claimed' AND (NEW.claimed_by IS NULL OR NEW.claimed_at>=OLD.claim_by) THEN RAISE(ABORT,'claim_expired') END;
 SELECT CASE WHEN NEW.status='issued' AND (NEW.issued_by IS NOT OLD.claimed_by OR length(trim(COALESCE(NEW.lightspeed_ref,'')))<1) THEN RAISE(ABORT,'claim_owner_required') END;
 SELECT CASE WHEN NEW.status='cancelled' AND length(trim(COALESCE(NEW.cancel_reason,'')))<1 THEN RAISE(ABORT,'reason_required') END;
END;
CREATE TRIGGER IF NOT EXISTS reward_audit AFTER UPDATE ON rewards BEGIN
 INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details)
 VALUES(NEW.id,NEW.status,NEW.last_actor_sub,NEW.last_actor_name,CASE NEW.status WHEN 'claimed' THEN NEW.claimed_at WHEN 'issued' THEN NEW.issued_at ELSE NEW.cancelled_at END,
 json_object('lightspeedRef',NEW.lightspeed_ref,'reason',NEW.cancel_reason));
END;
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count>=0)
);

CREATE TABLE IF NOT EXISTS sms_daily (day TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),CHECK(count+reserved<=100));
CREATE TRIGGER IF NOT EXISTS session_sms_reserve AFTER INSERT ON sessions WHEN NEW.sms_reserved=1 BEGIN
 UPDATE sms_daily SET reserved=reserved+1 WHERE day=NEW.sms_day;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'sms_day_missing') END;
END;
CREATE TRIGGER IF NOT EXISTS session_sms_release AFTER UPDATE OF sms_reserved ON sessions WHEN OLD.sms_reserved=1 AND NEW.sms_reserved=0 BEGIN
 UPDATE sms_daily SET reserved=reserved-1,count=count+CASE WHEN NEW.sms_consumed=1 AND OLD.sms_consumed=0 THEN 1 ELSE 0 END WHERE day=OLD.sms_day;
END;
CREATE TRIGGER IF NOT EXISTS session_sms_no_reactivate BEFORE UPDATE OF sms_reserved ON sessions WHEN OLD.sms_reserved=0 AND NEW.sms_reserved=1 BEGIN
 SELECT RAISE(ABORT,'sms_slot_cannot_reactivate');
END;

CREATE TRIGGER IF NOT EXISTS session_sms_required BEFORE INSERT ON sessions WHEN NEW.mode='rewards' BEGIN
 SELECT CASE WHEN NEW.sms_reserved<>1 OR NEW.sms_day IS NULL THEN RAISE(ABORT,'sms_slot_required') END;
END;
