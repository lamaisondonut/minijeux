import { ApiError, TTL, secureId, scoreValue } from "./common.mjs";
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
async function cleanup(db, now) {
  await stmt(db, "UPDATE sessions SET reservation_active=0,state=CASE WHEN state='awarded' THEN state ELSE 'lost' END WHERE reservation_active=1 AND (expires_at<=? OR (state='eligible' AND claim_deadline<=?))", now, now).run();
}
async function rateLimit(db, keys, now) {
  const statements = keys.map(({ key, windowMs, limit }) => stmt(db, `INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start<=? THEN 1 ELSE rate_limits.count+1 END,window_start=CASE WHEN rate_limits.window_start<=? THEN excluded.window_start ELSE rate_limits.window_start END RETURNING count`, key, now, now - windowMs, now - windowMs));
  const result = await db.batch(statements);
  await stmt(db, "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window_start<? ORDER BY window_start LIMIT 100)", now - 48 * 36e5).run();
  if (result.some((r, i) => (r.results?.[0]?.count ?? Number.MAX_SAFE_INTEGER) > keys[i].limit)) throw new ApiError(429, "rate_limited", "Trop de tentatives. R\xE9essayez plus tard.");
}
async function startSession(db, { id, ownerHash, seed, width, height, engineVersion, month, now, expiresAt, allowRewards, quotaDay = null, quotaLimit = 0 }) {
  if(allowRewards&&(!/^\d{4}-\d{2}-\d{2}$/.test(quotaDay||"")||!Number.isInteger(quotaLimit)||quotaLimit<1||quotaLimit>100))throw new ApiError(503,"sms_not_configured");
  const result = await db.batch([
    stmt(db, "INSERT OR IGNORE INTO budgets(month) VALUES(?)", month),
    stmt(db,"INSERT OR IGNORE INTO sms_daily(day,count,reserved) SELECT ?,0,0 WHERE ? IS NOT NULL",quotaDay,quotaDay),
    stmt(db, "UPDATE sessions SET reservation_active=0,state='lost' WHERE reservation_active=1 AND (expires_at<=? OR (state='eligible' AND claim_deadline<=?))", now, now),
    stmt(db, `INSERT INTO sessions(id,owner_hash,seed,width,height,mode,engine_version,month,cap_cents,created_at,expires_at,reservation_active,sms_day,sms_reserved)
 SELECT ?,?,?,?,?,CASE WHEN cap>0 THEN 'rewards' ELSE 'extreme' END,?,?,cap,?,?,CASE WHEN cap>0 THEN 1 ELSE 0 END,CASE WHEN cap>0 THEN ? ELSE NULL END,CASE WHEN cap>0 AND ? IS NOT NULL THEN 1 ELSE 0 END FROM
 (SELECT CASE WHEN ?=0 THEN 0 WHEN 10000-used_cents-reserved_cents>=2000 THEN 2000 WHEN 10000-used_cents-reserved_cents>=1000 THEN 1000 WHEN 10000-used_cents-reserved_cents>=500 THEN 500 ELSE 0 END cap FROM budgets WHERE month=?)
 WHERE NOT EXISTS(SELECT 1 FROM sessions WHERE owner_hash=? AND reservation_active=1 AND expires_at>?) AND (cap=0 OR ? IS NULL OR COALESCE((SELECT count+reserved FROM sms_daily WHERE day=?),0)<?) RETURNING *`, id, ownerHash, seed, width, height, engineVersion, month, now, expiresAt, quotaDay, quotaDay, allowRewards ? 1 : 0, month, ownerHash, now, quotaDay, quotaDay, quotaLimit)
  ]);
  const row = result[3].results?.[0];
  if (!row && quotaDay) { const quota = await stmt(db,"SELECT count+reserved total FROM sms_daily WHERE day=?",quotaDay).first(); if(quota?.total>=quotaLimit)throw new ApiError(503,"sms_daily_limit","Les récompenses sont temporairement indisponibles."); }
  if (!row) throw new ApiError(409, "session_pending", "Terminez la partie ou la confirmation en cours.");
  return row;
}
async function award(db, { sessionId, ownerHash, phoneHash, now }) {
  const id = secureId();
  const code = "GOAT-"+Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("").toUpperCase();
  try {
    await stmt(db, `INSERT INTO rewards(id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,last_actor_sub,last_actor_name)
 SELECT ?,s.id,?,?,MIN(s.cap_cents,CASE WHEN s.score>=10000 THEN 2000 WHEN s.score>=7500 THEN 1000 WHEN s.score>=5000 THEN 500 ELSE 0 END),s.month,s.first_name,s.last_name,s.score,?,?,?,'Joueur v\xE9rifi\xE9'
 FROM sessions s WHERE s.id=? AND s.owner_hash=? AND s.state='eligible' AND s.reservation_active=1 AND s.bound_phone_hash=? AND s.expires_at>? AND s.claim_deadline>?`, id, phoneHash, code, now, now + 30 * 864e5, ownerHash, sessionId, ownerHash, phoneHash, now, now).run();
  } catch (error) {
    if (String(error.message).includes("phone_cooldown")) return { reason: "phone_cooldown" };
    if (String(error.message).includes("session_not_eligible")) return { reason: "session_unavailable" };
    throw error;
  }
  const row = await stmt(db, "SELECT * FROM rewards WHERE session_id=? AND phone_hash=? AND session_id IN (SELECT id FROM sessions WHERE owner_hash=?)", sessionId, phoneHash, ownerHash).first();
  return row ? { reward: row } : { reason: "session_unavailable" };
}
async function reserveSmsQuota(db, day, limit, eligibility = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(503, "sms_not_configured");
  const condition=eligibility?"EXISTS(SELECT 1 FROM sessions WHERE id=? AND owner_hash=? AND state='eligible' AND reservation_active=1 AND expires_at>? AND claim_deadline>?)":"1";
  const args=eligibility?[eligibility.sessionId,eligibility.ownerHash,eligibility.now,eligibility.now]:[];
  return stmt(db, `INSERT INTO sms_daily(day,count) SELECT ?,1 WHERE ${condition} ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count+reserved<? AND ${condition} RETURNING count`, day,...args,limit,...args).first();
}
async function reserveSmsSend(db,{sessionId,ownerHash,dispatchDay,limit,now}) {
 const consumed=await stmt(db,"UPDATE sessions SET sms_reserved=0,sms_consumed=1 WHERE id=? AND owner_hash=? AND state='eligible' AND reservation_active=1 AND sms_reserved=1 AND expires_at>? AND claim_deadline>? RETURNING sms_day",sessionId,ownerHash,now,now).first();
 if(consumed)return {day:consumed.sms_day,reserved:true};
 const sent=await reserveSmsQuota(db,dispatchDay,limit,{sessionId,ownerHash,now});
 return sent?{day:dispatchDay,reserved:false}:null;
}
export {
  reserveSmsSend,
  award,
  cleanup,
  rateLimit,
  reserveSmsQuota,
  startSession,
  stmt
};
