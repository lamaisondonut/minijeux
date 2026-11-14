import { ENGINE_VERSION, replayGame } from "../v3/game-session-engine.mjs";
import { verifyAccessIdentity, requireAdmin } from "./auth.mjs";
import { smsConfiguration, normalizePhone, privateHmac, signChallenge, verifyChallenge, requestVerification, checkVerification } from "./sms.mjs";
import { ApiError, POLICY_VERSION, TIERS, TTL, secureId, json, iso, originConfigured, csrf, readJson, validId, string, dimensions, ownerCookie, cookie, monthWindow, scoreValue, rewardView, torontoDay } from "./common.mjs";
import { stmt, cleanup, rateLimit, startSession, award, reserveSmsQuota, reserveSmsSend } from "./store.mjs";
function ready(env) {
  return !!(Number.isInteger(Number(env.SMS_DAILY_LIMIT)) && Number(env.SMS_DAILY_LIMIT) >= 1 && Number(env.SMS_DAILY_LIMIT) <= 100 && env.DB && originConfigured(env) && typeof env.REWARDS_HMAC_SECRET === "string" && env.REWARDS_HMAC_SECRET.length >= 32 && typeof env.TURNSTILE_SECRET === "string" && env.TURNSTILE_SECRET.length >= 10 && typeof env.TURNSTILE_SITE_KEY === "string" && env.TURNSTILE_SITE_KEY.length >= 5 && smsConfiguration(env).enabled);
}
async function owner(request, env, required = true) {
  const raw = ownerCookie(request);
  if (!raw && required) throw new ApiError(401, "owner_required", "Cette confirmation appartient au navigateur de la partie.");
  return raw ? privateHmac(env, "owner", raw) : null;
}
async function ipHash(request, env) {
  return privateHmac(env, "ip", request.headers.get("CF-Connecting-IP") || "missing");
}
async function session(db, id, ownerHash) {
  if (!validId(id)) throw new ApiError(400, "invalid_session");
  const s = await stmt(db, "SELECT * FROM sessions WHERE id=? AND owner_hash=?", id, ownerHash).first();
  if (!s) throw new ApiError(404, "session_not_found");
  return s;
}
function sessionView(s, expected) {
  return { sessionId: s.id, seed: s.seed, width: s.width, height: s.height, mode: s.mode, engineVersion: s.engine_version, capCents: s.cap_cents, expiresAt: iso(s.expires_at), policyVersion: POLICY_VERSION, requiresModeConfirmation: expected !== s.mode };
}
async function verifyTurnstile(request, env, token) {
  if (typeof token !== "string" || token.length < 1 || token.length > 4096) throw new ApiError(400, "turnstile_required", "Veuillez terminer la v\xE9rification.");
  let result;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get("CF-Connecting-IP") || "" }), signal: AbortSignal.timeout(8e3) });
    if (!response.ok) throw Error("down");
    result = await response.json();
  } catch {
    throw new ApiError(503, "verification_unavailable", "V\xE9rification temporairement indisponible.");
  }
  const challengeAt = Date.parse(result.challenge_ts);
  if (!Number.isFinite(challengeAt) || challengeAt > Date.now() + 1e4 || Date.now() - challengeAt > 5 * 6e4 || result.success !== true || result.hostname !== new URL(env.APP_ORIGIN).hostname || result.action !== "boreal-session") throw new ApiError(403, "turnstile_failed", "V\xE9rification refus\xE9e.");
}
async function publicStatus(env, now) {
  if (!ready(env)) return json({ mode: "pending", rewardsEnabled: false, tiers: TIERS.map((t) => ({ ...t, available: false })), policyVersion: POLICY_VERSION, turnstileSiteKey: null, reason: "configuration_pending" });
  const w = monthWindow(now);
  try {
    await cleanup(env.DB, now);
    const budget = await stmt(env.DB, "SELECT * FROM budgets WHERE month=?", w.month).first();
    const remaining = 1e4 - (budget?.used_cents || 0) - (budget?.reserved_cents || 0);
    const cutoff = now >= w.end - TTL - 6e4;
    const cap = cutoff ? 0 : remaining >= 2e3 ? 2e3 : remaining >= 1e3 ? 1e3 : remaining >= 500 ? 500 : 0;
    const quota=await stmt(env.DB,"SELECT count+reserved total FROM sms_daily WHERE day=?",torontoDay(now)).first();
    if(cap>0&&quota?.total>=Number(env.SMS_DAILY_LIMIT))return json({mode:"pending",rewardsEnabled:false,tiers:TIERS.map(t=>({...t,available:false})),policyVersion:POLICY_VERSION,turnstileSiteKey:null,reason:"verification_unavailable"});
    return json({ mode: cap ? "rewards" : "extreme", rewardsEnabled: true, tiers: TIERS.map((t) => ({ ...t, available: t.valueCents <= cap })), capCents: cap, policyVersion: POLICY_VERSION, turnstileSiteKey: env.TURNSTILE_SITE_KEY, ...cutoff ? { reason: "month_closing" } : !cap ? { reason: "rewards_unavailable" } : {} });
  } catch {
    return json({ mode: "pending", rewardsEnabled: false, tiers: TIERS.map((t) => ({ ...t, available: false })), policyVersion: POLICY_VERSION, turnstileSiteKey: null, reason: "service_unavailable" });
  }
}
async function start(request, env, body, now) {
  if (!ready(env)) throw new ApiError(503, "configuration_pending", "Les r\xE9compenses ne sont pas encore activ\xE9es.");
  dimensions(body.width, body.height);
  if (!["rewards", "extreme"].includes(body.expectedMode)) throw new ApiError(400, "invalid_mode");
  const raw = ownerCookie(request) || secureId(32);
  const ownerHash = await privateHmac(env, "owner", raw);
  const ip = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `start:o:${ownerHash}`, windowMs: TTL, limit: 6 }, { key: `start:i:${ip}`, windowMs: 36e5, limit: 30 }], now);
  await cleanup(env.DB, now);
  const existing = await stmt(env.DB, "SELECT * FROM sessions WHERE owner_hash=? AND state='started' AND expires_at>? ORDER BY created_at DESC LIMIT 1", ownerHash, now).first();
  if (existing) return json(sessionView(existing, body.expectedMode), 200, { "Set-Cookie": cookie(raw) });
  const w = monthWindow(now);
  const allow = now < w.end - TTL - 6e4;
  const budget = await stmt(env.DB, "SELECT * FROM budgets WHERE month=?", w.month).first();
  const potentiallyAvailable = allow && 1e4 - (budget?.used_cents || 0) - (budget?.reserved_cents || 0) >= 500;
  const daily=await stmt(env.DB,"SELECT count+reserved total FROM sms_daily WHERE day=?",torontoDay(now)).first();
  if(potentiallyAvailable&&daily?.total>=Number(env.SMS_DAILY_LIMIT))throw new ApiError(503,"sms_daily_limit","Les récompenses sont temporairement indisponibles.");
  let verified = false;
  if (allow && (potentiallyAvailable || body.turnstileToken)) {
    await verifyTurnstile(request, env, body.turnstileToken);
    verified = true;
  }
  const startedAt=Date.now();
  const startedWindow=monthWindow(startedAt);
  const s = await startSession(env.DB, { id: secureId(), ownerHash, seed: crypto.getRandomValues(new Uint32Array(1))[0], width: body.width, height: body.height, engineVersion: ENGINE_VERSION, month: startedWindow.month, now: startedAt, expiresAt: Math.min(startedAt + TTL, startedWindow.end), allowRewards: verified && startedAt < startedWindow.end - TTL - 6e4,quotaDay:torontoDay(startedAt),quotaLimit:Number(env.SMS_DAILY_LIMIT) });
  return json(sessionView(s, body.expectedMode), 200, { "Set-Cookie": cookie(raw) });
}
async function finish(request, env, body, now) {
  const ownerHash = await owner(request, env);
  const s = await session(env.DB, body.sessionId, ownerHash);
  if (s.finish_json) return json(JSON.parse(s.finish_json));
  if (s.state !== "started") throw new ApiError(409, "session_consumed");
  if (now >= s.expires_at) {
    await stmt(env.DB, "UPDATE sessions SET state='lost',reservation_active=0 WHERE id=? AND state='started'", s.id).run();
    throw new ApiError(410, "session_expired", "La partie est expir\xE9e.");
  }
  if (s.engine_version !== ENGINE_VERSION) throw new ApiError(409, "engine_changed");
  const finishIp = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `finish:o:${ownerHash}`, windowMs: 36e5, limit: 20 }, { key: `finish:i:${finishIp}`, windowMs: 36e5, limit: 60 }], now);
  if (!Number.isInteger(body.ticks) || body.ticks < 1 || body.ticks > 108e3 || !Array.isArray(body.jumps) || !Array.isArray(body.resizes)) throw new ApiError(400, "invalid_replay");
  if (body.ticks / 120 * 1e3 > now - s.created_at + 2e3) throw new ApiError(400, "replay_too_fast");
  let result;
  try {
    result = replayGame({ seed: s.seed, width: s.width, height: s.height, mode: s.mode, ticks: body.ticks, jumps: body.jumps, resizes: body.resizes });
  } catch {
    throw new ApiError(400, "invalid_replay");
  }
  if (!result.ended) throw new ApiError(400, "unfinished_replay");
  const finishedAt = Date.now();
  if (finishedAt >= s.expires_at) {
    await stmt(env.DB,"UPDATE sessions SET state='lost',reservation_active=0 WHERE id=? AND state='started'",s.id).run();
    throw new ApiError(410,"session_expired");
  }
  const eligible = s.mode === "rewards" && s.reservation_active === 1 && scoreValue(result.score) > 0;
  const deadline = eligible ? Math.min(finishedAt + 10 * 6e4, s.expires_at) : null;
  const value = { score: result.score, eligible, mode: s.mode, capCents: s.cap_cents, ...eligible ? { claimDeadline: iso(deadline) } : {} };
  await stmt(env.DB, "UPDATE sessions SET state=?,score=?,finish_json=?,claim_deadline=?,reservation_active=? WHERE id=? AND state='started'", eligible ? "eligible" : "lost", result.score, JSON.stringify(value), deadline, eligible ? 1 : 0, s.id).run();
  const stored = await session(env.DB, s.id, ownerHash);
  if(!stored.finish_json)throw new ApiError(409,"session_unavailable");
  return json(JSON.parse(stored.finish_json));
}
async function smsRequest(request, env, body, now) {
  if (!ready(env)) throw new ApiError(503, "configuration_pending");
  const ownerHash = await owner(request, env);
  const s = await session(env.DB, body.sessionId, ownerHash);
  if (s.state !== "eligible" || s.reservation_active !== 1 || s.expires_at <= now || s.claim_deadline <= now) throw new ApiError(409, "session_not_eligible", "Cette partie ne peut plus confirmer une r\xE9compense.");
  if (body.consentVersion !== POLICY_VERSION) throw new ApiError(400, "consent_required");
  const firstName = string(body.firstName, "first_name", 80);
  const lastName = string(body.lastName, "last_name", 80);
  const phone = normalizePhone(body.phone);
  const phoneHash = await privateHmac(env, "phone", phone);
  const ip = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `smsreq:o:${ownerHash}`, windowMs: 36e5, limit: 3 }, { key: `smsreq:p:${phoneHash}`, windowMs: 864e5, limit: 5 }, { key: `smsreq:i:${ip}`, windowMs: 36e5, limit: 10 }], now);
  const recent = await stmt(env.DB, "SELECT id FROM rewards WHERE phone_hash=? AND confirmed_at>? LIMIT 1", phoneHash, now - 30 * 864e5).first();
  if (recent) throw new ApiError(409, "phone_cooldown", "Un seul gain par t\xE9l\xE9phone v\xE9rifi\xE9 pendant 30 jours.");
  if (s.bound_phone_hash && s.bound_phone_hash !== phoneHash) throw new ApiError(409, "phone_bound", "Cette partie est li\xE9e au premier t\xE9l\xE9phone v\xE9rifi\xE9.");
  const id = secureId();
  const expiresAt = Math.min(now + 10 * 6e4, s.claim_deadline, s.expires_at);
  await stmt(env.DB, "INSERT INTO challenges(id,owner_hash,session_id,phone_hash,created_at,expires_at,state,consent_version,first_name,last_name) VALUES(?,?,?,?,?,?,'sending',?,?,?)", id, ownerHash, s.id, phoneHash, now, expiresAt, POLICY_VERSION, firstName, lastName).run();
  const day = torontoDay(now);
  const quota = await reserveSmsSend(env.DB,{sessionId:s.id,ownerHash,dispatchDay:day,limit:Number(env.SMS_DAILY_LIMIT),now:Date.now()});
  if (!quota) {
    await stmt(env.DB, "UPDATE challenges SET state='failed' WHERE id=?", id).run();
    throw new ApiError(429, "sms_daily_limit", "La limite quotidienne de v\xE9rifications est atteinte.");
  }
  await stmt(env.DB, "INSERT INTO audit(action,actor_sub,actor_name,created_at,details) VALUES('sms_requested',?,'Joueur',?,?)", ownerHash, now,JSON.stringify({sessionId:s.id,allocationDay:quota.day,reservedSlot:quota.reserved})).run();
  try {
    if(Date.now()>=expiresAt)throw new ApiError(410,"challenge_expired");
    const result = await requestVerification(env, phone);
    await stmt(env.DB, "UPDATE challenges SET provider_sid=?,state='pending' WHERE id=? AND state='sending'", result.providerSid, id).run();
  } catch (error) {
    await stmt(env.DB, "UPDATE challenges SET state='failed' WHERE id=?", id).run();
    throw error;
  }
  const token = await signChallenge(env, { challengeId: id, ownerHash, sessionId: s.id, phoneHash, expiresAt: Math.floor(expiresAt / 1e3) });
  return json({ challengeId: token, expiresAt: iso(expiresAt) });
}
async function smsVerify(request, env, body, now) {
  if (!ready(env)) throw new ApiError(503, "configuration_pending");
  const ownerHash = await owner(request, env);
  const phone = normalizePhone(body.phone);
  const phoneHash = await privateHmac(env, "phone", phone);
  if (typeof body.code !== "string" || !/^\d{4,10}$/.test(body.code)) throw new ApiError(400, "invalid_code");
  const signed = await verifyChallenge(env, body.challengeId, { ownerHash, phoneHash });
  const c = await stmt(env.DB, "SELECT * FROM challenges WHERE id=? AND owner_hash=? AND session_id=? AND phone_hash=?", signed.challengeId, ownerHash, signed.sessionId, phoneHash).first();
  if (!c || c.expires_at <= now) throw new ApiError(410, "challenge_expired");
  const s = await session(env.DB, c.session_id, ownerHash);
  const existing = await stmt(env.DB, "SELECT * FROM rewards WHERE session_id=?", s.id).first();
  if (existing) {
    if (existing.phone_hash !== phoneHash) throw new ApiError(409, "session_consumed");
    return json({ awarded: true, score: s.score, reward: rewardView(existing, now) });
  }
  if (s.state !== "eligible" || !s.reservation_active || s.expires_at <= now || s.claim_deadline <= now) throw new ApiError(409, "session_not_eligible");
  if (s.bound_phone_hash && s.bound_phone_hash !== phoneHash) throw new ApiError(409, "phone_bound");
  const ip = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `smscheck:o:${ownerHash}`, windowMs: 36e5, limit: 15 }, { key: `smscheck:p:${phoneHash}`, windowMs: 36e5, limit: 15 }, { key: `smscheck:i:${ip}`, windowMs: 36e5, limit: 30 }], now);
  if (c.state !== "verified") {
    const locked = await stmt(env.DB, "UPDATE challenges SET state='checking',attempts=attempts+1,lease_until=? WHERE id=? AND attempts<5 AND (state='pending' OR (state='checking' AND lease_until<=?)) RETURNING *", now + 15e3, c.id, now).first();
    if (!locked) throw new ApiError(c.attempts >= 5 ? 429 : 409, c.attempts >= 5 ? "attempts_exceeded" : "verification_pending");
    let approved = false;
    try {
      approved = await checkVerification(env, phone, body.code, { providerSid: locked.provider_sid });
    } catch (error) {
      await stmt(env.DB, "UPDATE challenges SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,lease_until=NULL WHERE id=? AND state='checking'", c.id).run();
      throw error;
    }
    await stmt(env.DB, "UPDATE challenges SET state=?,lease_until=NULL WHERE id=? AND state='checking'", approved ? "verified" : locked.attempts >= 5 ? "failed" : "pending", c.id).run();
    if (!approved) return json({ awarded: false, score: s.score, reason: "invalid_code" }, 400);
  }
  const completionNow = Date.now();
  if (completionNow >= s.expires_at || completionNow >= s.claim_deadline || completionNow >= c.expires_at) throw new ApiError(410, "challenge_expired");
  await stmt(env.DB, "UPDATE sessions SET bound_phone_hash=?,first_name=?,last_name=? WHERE id=? AND owner_hash=? AND state='eligible' AND (bound_phone_hash IS NULL OR bound_phone_hash=?) AND expires_at>? AND claim_deadline>?", phoneHash, c.first_name, c.last_name, s.id, ownerHash, phoneHash, completionNow, completionNow).run();
  const names = await stmt(env.DB, "SELECT first_name,last_name FROM sessions WHERE id=?", s.id).first();
  if (!names.first_name || !names.last_name) throw new ApiError(409, "profile_missing");
  const result = await award(env.DB, { sessionId: s.id, ownerHash, phoneHash, now: completionNow });
  return json({ awarded: !!result.reward, score: s.score, ...result.reward ? { reward: rewardView(result.reward, now) } : { reason: result.reason } });
}
async function adminRate(request, env, employee, path, now) {
  const staff = await privateHmac(env, "staff", employee.sub);
  const ip = await ipHash(request, env);
  const keys = [{ key: `admin:s:${staff}`, windowMs: 6e4, limit: 180 }, { key: `admin:i:${ip}`, windowMs: 6e4, limit: 360 }];
  if (path === "/api/admin/export") keys.push({ key: `export:s:${staff}`, windowMs: 36e5, limit: 10 });
  await rateLimit(env.DB, keys, now);
}
async function adminApi(request, env, path, body, now, url) {
  if (path === "/api/admin/identity") {
    if (request.method !== "GET") throw new ApiError(405, "method_not_allowed");
    const identity = await verifyAccessIdentity(request, env);
    await adminRate(request, env, identity, path, now);
    return json(identity);
  }
  const employee = await requireAdmin(request, env);
  now=Date.now();
  await adminRate(request, env, employee, path, now);
  if (path === "/api/admin/me" && request.method === "GET") return json({ employee: { ...employee, subject: employee.sub } });
  if (path === "/api/admin/budget" && request.method === "GET") {
    await cleanup(env.DB, now);
    const { month } = monthWindow(now);
    const b = await stmt(env.DB, "SELECT * FROM budgets WHERE month=?", month).first();
    const pending = await stmt(env.DB, "SELECT COUNT(*) count FROM rewards WHERE status='pending' AND claim_by>?", now).first();
    return json({ month, usedCents: b?.used_cents || 0, reservedCents: b?.reserved_cents || 0, remainingCents: 1e4 - (b?.used_cents || 0) - (b?.reserved_cents || 0), pendingCount: pending.count });
  }
  if (path === "/api/admin/audit" && request.method === "GET") {
    const rewardId = url.searchParams.get("rewardId");
    if (rewardId && !validId(rewardId)) throw new ApiError(400, "invalid_reward");
    const result = await stmt(env.DB, `SELECT * FROM audit ${rewardId ? "WHERE reward_id=?" : ""} ORDER BY id DESC LIMIT 200`, ...rewardId ? [rewardId] : []).all();
    return json({ audit: result.results.map((r) => ({ id: r.id, rewardId: r.reward_id, action: r.action, actorName: r.actor_name, actorSub: r.actor_sub, createdAt: iso(r.created_at), details: JSON.parse(r.details) })) });
  }
  if ((path === "/api/admin/rewards" || path === "/api/admin/export") && request.method === "GET") {
    const conditions = [];
    const args = [];
    const code = url.searchParams.get("code");
    const status = url.searchParams.get("status");
    const cursor = url.searchParams.get("cursor");
    if (code) {
      conditions.push("code=?");
      args.push(code.trim().toUpperCase());
    }
    if (status) {
      if (!["pending", "claimed", "issued", "cancelled", "expired"].includes(status)) throw new ApiError(400, "invalid_status");
      if (status === "expired") {
        conditions.push("status='pending' AND claim_by<=?");
        args.push(now);
      } else {
        conditions.push("status=?");
        args.push(status);
        if (status === "pending") {
          conditions.push("claim_by>?");
          args.push(now);
        }
      }
    }
    if (cursor) {
      if (!/^\d{1,16}:[A-Za-z0-9_-]{20,128}$/.test(cursor)) throw new ApiError(400, "invalid_cursor");
      const [at, id] = cursor.split(":");
      conditions.push("(confirmed_at<? OR (confirmed_at=? AND id<?))");
      args.push(Number(at), Number(at), id);
    }
    const limit = path.endsWith("/export") ? 5001 : 101;
    const result = await stmt(env.DB, `SELECT * FROM rewards ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY confirmed_at DESC,id DESC LIMIT ?`, ...args, limit).all();
    const rows = result.results;
    if (path.endsWith("/export")) {
      if (rows.length > 5e3) throw new ApiError(413, "export_too_large", "Filtrez les r\xE9sultats avant leur exportation.");
      const escape = (v) => {
        let text = String(v ?? "");
        if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
      };
      const fields = ["id", "code", "score", "valueCents", "status", "firstName", "lastName", "confirmedAt", "claimBy", "claimedBy", "claimedByName", "claimedAt", "issuedBy", "issuedByName", "issuedAt", "cancelledByName", "cancelledAt", "lightspeedRef", "cancelReason"];
      await stmt(env.DB, "INSERT INTO audit(action,actor_sub,actor_name,created_at,details) VALUES('export',?,?,?,?)", employee.sub, employee.name, now, JSON.stringify({ count: rows.length })).run();
      const csv = "\uFEFF" + [fields.map(escape).join(","), ...rows.map((r) => {
        const value = rewardView(r, now);
        return fields.map((k) => escape(value[k])).join(",");
      })].join("\r\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="recompenses.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const more = rows.length > 100;
    const page = rows.slice(0, 100);
    const last = page.at(-1);
    return json({ rewards: page.map((r) => rewardView(r, now)), ...more ? { nextCursor: `${last.confirmed_at}:${last.id}` } : {} });
  }
  const match = path.match(/^\/api\/admin\/rewards\/([A-Za-z0-9_-]{20,128})\/(claim|issue|cancel)$/);
  if (match && request.method === "POST") {
    const [, id, action] = match;
    let result;
    if (action === "claim") {
      result = await stmt(env.DB, "UPDATE rewards SET status='claimed',claimed_by=?,claimed_by_name=?,claimed_at=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='pending' AND claim_by>? RETURNING *", employee.sub, employee.name, now, employee.sub, employee.name, id, now).first();
    } else if (action === "issue") {
      const ref = string(body.lightspeedRef, "lightspeed_ref", 120);
      result = await stmt(env.DB, "UPDATE rewards SET status='issued',issued_by=?,issued_by_name=?,issued_at=?,lightspeed_ref=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='claimed' AND claimed_by=? RETURNING *", employee.sub, employee.name, now, ref, employee.sub, employee.name, id, employee.sub).first();
    } else {
      if (employee.role !== "manager") throw new ApiError(403, "manager_required", "Seul un responsable peut annuler.");
      const reason = string(body.reason, "reason", 500);
      result = await stmt(env.DB, "UPDATE rewards SET status='cancelled',cancelled_at=?,cancelled_by_name=?,cancel_reason=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status IN ('pending','claimed') RETURNING *", now, employee.name, reason, employee.sub, employee.name, id).first();
    }
    if (!result) {
      const old = await stmt(env.DB, "SELECT * FROM rewards WHERE id=?", id).first();
      if (!old) throw new ApiError(404, "reward_not_found");
      if (action === "claim" && old.status === "claimed" && old.claimed_by === employee.sub || action === "issue" && old.status === "issued" && old.issued_by === employee.sub && old.lightspeed_ref === body.lightspeedRef || action === "cancel" && old.status === "cancelled") return json({ reward: rewardView(old, now) });
      throw new ApiError(409, "reward_conflict", "Ce bon a d\xE9j\xE0 \xE9t\xE9 trait\xE9, est expir\xE9 ou appartient \xE0 un autre employ\xE9.");
    }
    return json({ reward: rewardView(result, now) });
  }
  throw new ApiError(404, "not_found");
}
async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = Date.now();
    if (request.method === "OPTIONS") throw new ApiError(405, "method_not_allowed");
    if (path === "/api/rewards/status" && request.method === "GET") return publicStatus(env, now);
    if (!env.DB) throw new ApiError(503, "configuration_pending", "Le service est en pr\xE9paration.");
    let body = {};
    if (!["GET", "HEAD"].includes(request.method)) {
      csrf(request, env);
      body = await readJson(request);
    }
    if (path.startsWith("/api/admin/")) return await adminApi(request, env, path, body, now, url);
    if (path === "/api/rewards/confirmation" && request.method === "GET") {
      if (typeof env.REWARDS_HMAC_SECRET !== "string" || env.REWARDS_HMAC_SECRET.length < 32) throw new ApiError(503, "configuration_pending");
      const ownerHash = await owner(request, env);
      const row = await stmt(env.DB, "SELECT r.* FROM rewards r JOIN sessions s ON s.id=r.session_id WHERE s.owner_hash=? ORDER BY r.confirmed_at DESC LIMIT 1", ownerHash).first();
      return json({ reward: rewardView(row, now) });
    }
    if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
    if (path === "/api/games/start") return await start(request, env, body, now);
    if (path === "/api/games/finish") return await finish(request, env, body, now);
    if (path === "/api/rewards/sms/request") return await smsRequest(request, env, body, now);
    if (path === "/api/rewards/sms/verify") return await smsVerify(request, env, body, now);
    throw new ApiError(404, "not_found");
  } catch (error) {
    if (error.status) return json({ error: error.code || "request_failed", message: error.message }, error.status);
    console.error("Rewards request failed", error?.name || "Error");
    return json({ error: "service_unavailable", message: "Service temporairement indisponible." }, 503);
  }
}
export {
  handleRequest
};
