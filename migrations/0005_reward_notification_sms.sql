-- Apply after 0004, as ONE atomic D1 batch. No messages are sent by this SQL.
-- No phone number, message body or OTP is stored here.
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
CREATE UNIQUE INDEX notification_sms_initial ON notification_sms(reward_id) WHERE kind='initial';
CREATE INDEX notification_sms_reward ON notification_sms(reward_id,created_at DESC);
CREATE TABLE notification_sms_daily (
 day TEXT PRIMARY KEY NOT NULL,
 count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(count)='integer' AND count BETWEEN 0 AND 100)
);
