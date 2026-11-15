import { ENGINE_VERSION, replayGame } from "../v3/game-session-engine.mjs";
import { verifyAccessIdentity, requireAdmin } from "./auth.mjs";
import { smsConfiguration, normalizePhone, privateHmac, signChallenge, verifyChallenge, requestVerification, checkVerification } from "./sms.mjs";
import { ApiError, POLICY_VERSION, TIERS, TTL, secureId, json, iso, originConfigured, csrf, readJson, validId, string, dimensions, ownerCookie, cookie, monthWindow, scoreValue, publicRewardView, rewardView, torontoDay } from "./common.mjs";
import { stmt, cleanup, rateLimit, startSession, award, reserveSmsQuota, reserveSmsSend } from "./store.mjs";
import { setupDiagnostics, rewardDatabaseReady } from "./setup.mjs";
import { previewTestRedemption } from "./preview-test.mjs";
import { sendRewardSms } from "./notification-sms.mjs";
import { quoteManual, createManual } from "./manual-rewards.mjs";
import { getRestrictions,publicRestriction,recordDuplicate,adminEligibility,grantException } from "./eligibility.mjs";
import { phoneVerificationMode } from "./launch-mode.mjs";
import { customerColumns,adminCustomerView,normalizeNameSearch } from "./customer.mjs";
import { notificationConfigured } from "./notification-sms.mjs";
import { getBudget, changeBudget } from "./budget.mjs";
async function notifyInitial(env,reward,phone,actor) {
  if(phoneVerificationMode(env)!=="sms")return {status:"disabled"};
  try {return await sendRewardSms(env,{reward,phone,actor,requestId:'initial_'+reward.id,kind:'initial'});}
  catch {return {status:'unavailable'};}
}
function ready(env) {
  const mode=phoneVerificationMode(env);
  const base=!!(mode && env.REWARDS_ENABLED==='true' && env.TERMS_APPROVED==='true' && env.DB && originConfigured(env) && typeof env.REWARDS_HMAC_SECRET==='string' && env.REWARDS_HMAC_SECRET.length>=32 && typeof env.TURNSTILE_SECRET==='string' && env.TURNSTILE_SECRET.length>=10 && typeof env.TURNSTILE_SITE_KEY==='string' && env.TURNSTILE_SITE_KEY.length>=5);
  return base && (mode==='unverified' || smsConfiguration(env).enabled);
}
function requireSmsMode(env) {
  if(phoneVerificationMode(env)!=='sms')throw new ApiError(409,'sms_disabled','La réclamation actuelle ne demande aucun SMS.');
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
  return { sessionId: s.id, seed: s.seed, width: s.width, height: s.height, mode: s.mode, engineVersion: s.engine_version, capCents: s.cap_cents, expiresAt: iso(s.expires_at), phoneVerificationMode:s.phone_verification_mode||"sms", policyVersion: POLICY_VERSION, requiresModeConfirmation: expected !== s.mode };
}
async function verifyTurnstile(request, env, token) {
  if (typeof token !== "string" || token.length < 1 || token.length > 4096) throw new ApiError(400, "turnstile_required", "Veuillez terminer la v\xE9rification.");
  let result;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", redirect: "manual", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get("CF-Connecting-IP") || "" }), signal: AbortSignal.timeout(8e3) });
    if (!response.ok) throw Error("down");
    result = await response.json();
  } catch {
    throw new ApiError(503, "verification_unavailable", "V\xE9rification temporairement indisponible.");
  }
  const challengeAt = Date.parse(result.challenge_ts);
  if (!Number.isFinite(challengeAt) || challengeAt > Date.now() + 1e4 || Date.now() - challengeAt > 5 * 6e4 || result.success !== true || result.hostname !== new URL(env.APP_ORIGIN).hostname || result.action !== "boreal-session") throw new ApiError(403, "turnstile_failed", "V\xE9rification refus\xE9e.");
}
async function publicStatus(env, now) {
  if (!ready(env)) return json({ phoneVerificationMode:phoneVerificationMode(env),mode: "pending", rewardsEnabled: false, tiers: TIERS.map((t) => ({ ...t, available: false })), policyVersion: POLICY_VERSION, turnstileSiteKey: null, reason: "configuration_pending" });
  const w = monthWindow(now);
  try {
    if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503, "schema_unavailable");
    await cleanup(env.DB, now);
    const budget = await getBudget(env.DB, { month: w.month, now });
    const remaining = budget.remainingCents;
    const cutoff = now >= w.end - TTL - 6e4;
    const cap = cutoff ? 0 : remaining >= 2e3 ? 2e3 : remaining >= 1e3 ? 1e3 : remaining >= 500 ? 500 : 0;
    const quota=phoneVerificationMode(env)==="sms"?await stmt(env.DB,"SELECT count+reserved total FROM sms_daily WHERE day=?",torontoDay(now)).first():null;
    if(phoneVerificationMode(env)==="sms"&&cap>0&&quota?.total>=Number(env.SMS_DAILY_LIMIT))return json({mode:"pending",rewardsEnabled:false,tiers:TIERS.map(t=>({...t,available:false})),policyVersion:POLICY_VERSION,turnstileSiteKey:null,reason:"verification_unavailable"});
    return json({ phoneVerificationMode:phoneVerificationMode(env),mode: cap ? "rewards" : "extreme", rewardsEnabled: true, tiers: TIERS.map((t) => ({ ...t, available: t.valueCents <= cap })), capCents: cap, policyVersion: POLICY_VERSION, turnstileSiteKey: env.TURNSTILE_SITE_KEY, ...cutoff ? { reason: "month_closing" } : !cap ? { reason: "rewards_unavailable" } : {} });
  } catch {
    return json({ phoneVerificationMode:phoneVerificationMode(env),mode: "pending", rewardsEnabled: false, tiers: TIERS.map((t) => ({ ...t, available: false })), policyVersion: POLICY_VERSION, turnstileSiteKey: null, reason: "service_unavailable" });
  }
}
async function start(request, env, body, now) {
  if (!ready(env)) throw new ApiError(503, "configuration_pending", "Les r\xE9compenses ne sont pas encore activ\xE9es.");
  if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503, "service_unavailable", "Service temporairement indisponible.");
  dimensions(body.width, body.height);
  if (!["rewards", "extreme"].includes(body.expectedMode)) throw new ApiError(400, "invalid_mode");
  const raw = ownerCookie(request) || secureId(32);
  const ownerHash = await privateHmac(env, "owner", raw);
  const restriction=await getRestrictions(env.DB,{deviceHash:ownerHash,now});
  if(restriction.device.blocked)return json({playOnly:true,rewardRestriction:publicRestriction(restriction)},200,{"Set-Cookie":cookie(raw)});
  const ip = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `start:o:${ownerHash}`, windowMs: TTL, limit: 6 }, { key: `start:i:${ip}`, windowMs: 36e5, limit: 30 }], now);
  await cleanup(env.DB, now);
  const existing = await stmt(env.DB, "SELECT * FROM sessions WHERE owner_hash=? AND state='started' AND expires_at>? ORDER BY created_at DESC LIMIT 1", ownerHash, now).first();
  if (existing) return json(sessionView(existing, body.expectedMode), 200, { "Set-Cookie": cookie(raw) });
  const w = monthWindow(now);
  const allow = now < w.end - TTL - 6e4;
  const budget = await getBudget(env.DB, { month: w.month, now });
  const potentiallyAvailable = allow && budget.remainingCents >= 500;
  const smsMode=phoneVerificationMode(env)==="sms";
  const daily=smsMode?await stmt(env.DB,"SELECT count+reserved total FROM sms_daily WHERE day=?",torontoDay(now)).first():null;
  if(smsMode&&potentiallyAvailable&&daily?.total>=Number(env.SMS_DAILY_LIMIT))throw new ApiError(503,"sms_daily_limit","Les récompenses sont temporairement indisponibles.");
  let verified = false;
  if (allow && (potentiallyAvailable || body.turnstileToken)) {
    await verifyTurnstile(request, env, body.turnstileToken);
    verified = true;
  }
  const startedAt=Date.now();
  const startedWindow=monthWindow(startedAt);
  const s = await startSession(env.DB, { id: secureId(), ownerHash, seed: crypto.getRandomValues(new Uint32Array(1))[0], width: body.width, height: body.height, engineVersion: ENGINE_VERSION, month: startedWindow.month, now: startedAt, expiresAt: Math.min(startedAt + TTL, startedWindow.end), allowRewards: verified && startedAt < startedWindow.end - TTL - 6e4,quotaDay:smsMode?torontoDay(startedAt):null,quotaLimit:smsMode?Number(env.SMS_DAILY_LIMIT):0,phoneVerificationMode:phoneVerificationMode(env) });
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
  const restriction=eligible?await getRestrictions(env.DB,{deviceHash:ownerHash,now:finishedAt}):null;
  const value = { ...(restriction?.blocked?{rewardRestriction:publicRestriction(restriction)}:{}),score: result.score, eligible, mode: s.mode, capCents: s.cap_cents, ...eligible ? { claimDeadline: iso(deadline) } : {} };
  await stmt(env.DB, "UPDATE sessions SET state=?,score=?,finish_json=?,claim_deadline=?,reservation_active=? WHERE id=? AND state='started'", eligible ? "eligible" : "lost", result.score, JSON.stringify(value), deadline, eligible ? 1 : 0, s.id).run();
  const stored = await session(env.DB, s.id, ownerHash);
  if(!stored.finish_json)throw new ApiError(409,"session_unavailable");
  return json(JSON.parse(stored.finish_json));
}
async function smsRequest(request, env, body, now) {
  requireSmsMode(env);
  if (!ready(env)) throw new ApiError(503, "configuration_pending");
  if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503, "service_unavailable", "Service temporairement indisponible.");
  const ownerHash = await owner(request, env);
  const s = await session(env.DB, body.sessionId, ownerHash);
  if(s.phone_verification_mode!=="sms")throw new ApiError(409,"verification_mode_changed");
  if (s.state !== "eligible" || s.reservation_active !== 1 || s.expires_at <= now || s.claim_deadline <= now) throw new ApiError(409, "session_not_eligible", "Cette partie ne peut plus confirmer une r\xE9compense.");
  if (body.consentVersion !== POLICY_VERSION) throw new ApiError(400, "consent_required");
  const firstName = string(body.firstName, "first_name", 80);
  const lastName = string(body.lastName, "last_name", 80);
  const phone = normalizePhone(body.phone);
  const phoneHash = await privateHmac(env, "phone", phone);
  const ip = await ipHash(request, env);
  await rateLimit(env.DB, [{ key: `smsreq:o:${ownerHash}`, windowMs: 36e5, limit: 6 }, { key: `smsreq:p:${phoneHash}`, windowMs: 864e5, limit: 5 }, { key: `smsreq:i:${ip}`, windowMs: 36e5, limit: 10 }], now);
  const recent = await stmt(env.DB, "SELECT id FROM rewards WHERE phone_hash=? AND confirmed_at>? LIMIT 1", phoneHash, now - 30 * 864e5).first();
  if (recent) throw new ApiError(409, "phone_cooldown", "Un seul gain par t\xE9l\xE9phone v\xE9rifi\xE9 pendant 30 jours.");
  if(s.verification_send_count>=5)throw new ApiError(429,"sms_send_limit","La limite de cinq demandes pour cette partie est atteinte.");
  if(s.verification_next_send_at>now){const error=new ApiError(429,"sms_wait","Attendez avant de demander un nouveau SMS.");error.retryAfter=Math.ceil((s.verification_next_send_at-now)/1000);throw error;}
  const id = secureId();
  const expiresAt = Math.min(now + 10 * 6e4, s.claim_deadline, s.expires_at);
  const revision=s.verification_revision+1;
  const created=await env.DB.batch([
    stmt(env.DB,"UPDATE sessions SET active_challenge_id=?,verification_revision=verification_revision+1,verification_send_count=verification_send_count+1,verification_next_send_at=?,bound_phone_hash=NULL WHERE id=? AND owner_hash=? AND state='eligible' AND reservation_active=1 AND expires_at>? AND claim_deadline>? AND verification_revision=? AND verification_send_count<5 AND verification_next_send_at<=? RETURNING id",id,now+60000,s.id,ownerHash,now,now,s.verification_revision,now),
    stmt(env.DB,"UPDATE challenges SET state='failed',lease_until=NULL WHERE session_id=? AND id<>? AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND active_challenge_id=? AND verification_revision=?)",s.id,id,s.id,id,revision),
    stmt(env.DB,"INSERT INTO challenges(id,owner_hash,session_id,phone_hash,created_at,expires_at,state,consent_version,first_name,last_name,revision) SELECT ?,?,?,?,?,?,'sending',?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE id=? AND active_challenge_id=? AND verification_revision=?)",id,ownerHash,s.id,phoneHash,now,expiresAt,POLICY_VERSION,firstName,lastName,revision,s.id,id,revision)
  ]);
  if(!created[0].results?.length)throw new ApiError(409,"verification_replaced","Une autre demande a modifié cette vérification. Rechargez l’écran de saisie.");
  const day = torontoDay(now);
  const quota = await reserveSmsSend(env.DB,{sessionId:s.id,ownerHash,dispatchDay:day,limit:Number(env.SMS_DAILY_LIMIT),now:Date.now()});
  if (!quota) {
    await stmt(env.DB, "UPDATE challenges SET state='failed' WHERE id=?", id).run();
    throw new ApiError(429, "sms_daily_limit", "La limite quotidienne de v\xE9rifications est atteinte.");
  }
  await stmt(env.DB, "INSERT INTO audit(action,actor_sub,actor_name,created_at,details) VALUES('sms_requested',?,'Joueur',?,?)", ownerHash, now,JSON.stringify({sessionId:s.id,allocationDay:quota.day,reservedSlot:quota.reserved,verificationRevision:revision,replacedPrevious:Boolean(s.active_challenge_id),sendNumber:s.verification_send_count+1})).run();
  try {
    if(Date.now()>=expiresAt)throw new ApiError(410,"challenge_expired");
    const result = await requestVerification(env, phone);
    await stmt(env.DB, "UPDATE challenges SET provider_sid=?,state='pending' WHERE id=? AND state='sending'", result.providerSid, id).run();
  } catch (error) {
    await stmt(env.DB, "UPDATE challenges SET state='failed' WHERE id=?", id).run();
    throw error;
  }
  const token = await signChallenge(env, { challengeId: id, ownerHash, sessionId: s.id, phoneHash, expiresAt: Math.floor(expiresAt / 1e3) });
  return json({ challengeId: token, expiresAt: iso(expiresAt),nextSendAt:iso(now+60000),sendsRemaining:5-(s.verification_send_count+1),claimDeadline:iso(s.claim_deadline) });
}
async function smsVerify(request, env, body, now) {
  requireSmsMode(env);
  if (!ready(env)) throw new ApiError(503, "configuration_pending");
  if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503, "service_unavailable", "Service temporairement indisponible.");
  const ownerHash = await owner(request, env);
  const phone = normalizePhone(body.phone);
  const phoneHash = await privateHmac(env, "phone", phone);
  if (typeof body.code !== "string" || !/^\d{4,10}$/.test(body.code)) throw new ApiError(400, "invalid_code");
  const signed = await verifyChallenge(env, body.challengeId, { ownerHash, phoneHash });
  const c = await stmt(env.DB, "SELECT * FROM challenges WHERE id=? AND owner_hash=? AND session_id=? AND phone_hash=?", signed.challengeId, ownerHash, signed.sessionId, phoneHash).first();
  if (!c || c.expires_at <= now) throw new ApiError(410, "challenge_expired");
  const s = await session(env.DB, c.session_id, ownerHash);
  if(s.phone_verification_mode!=="sms")throw new ApiError(409,"verification_mode_changed");
  const existing = await stmt(env.DB, "SELECT * FROM rewards WHERE session_id=?", s.id).first();
  if (existing) {
    if (existing.phone_hash !== phoneHash) throw new ApiError(409, "session_consumed");
    return json({ awarded: true, score: s.score, reward: publicRewardView(existing, now), notification:await notifyInitial(env,existing,phone,ownerHash) });
  }
  if(s.active_challenge_id!==c.id || s.verification_revision!==c.revision)throw new ApiError(409,"verification_replaced","Cette vérification a été remplacée. Utilisez le dernier SMS demandé.");
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
  const rewardId=secureId();
  const contact=await customerColumns(env,{phone,firstName:c.first_name,lastName:c.last_name,rewardId});
  const result = await award(env.DB, { sessionId:s.id,ownerHash,phoneHash,now:completionNow,challengeId:c.id,challengeRevision:c.revision,firstName:c.first_name,lastName:c.last_name,id:rewardId,customer:contact });
  if(!result.reward && result.reason==='session_unavailable')throw new ApiError(409,"verification_replaced","La vérification a changé ou son délai est écoulé. Utilisez la dernière demande.");
  return json({ awarded: !!result.reward, score: s.score, ...result.reward ? { reward: publicRewardView(result.reward, completionNow), notification:await notifyInitial(env,result.reward,phone,ownerHash) } : { reason: result.reason } });
}
async function directClaim(request,env,body,now) {
  if(!ready(env))throw new ApiError(503,'configuration_pending','Les récompenses sont temporairement indisponibles.');
  if(phoneVerificationMode(env)!=='unverified')throw new ApiError(409,'sms_verification_required','Cette partie exige une vérification SMS.');
  if(!await rewardDatabaseReady(env.DB))throw new ApiError(503,'schema_unavailable');
  const ownerHash=await owner(request,env);
  const s=await session(env.DB,body.sessionId,ownerHash);
  if(s.phone_verification_mode!=='unverified')throw new ApiError(409,'verification_mode_changed');
  const phone=normalizePhone(body.phone),phoneHash=await privateHmac(env,'phone',phone);
  const firstName=string(body.firstName,'first_name',80),lastName=string(body.lastName,'last_name',80);
  if(body.consentVersion!==POLICY_VERSION)throw new ApiError(400,'consent_required');
  const existing=await stmt(env.DB,'SELECT * FROM rewards WHERE session_id=?',s.id).first();
  if(existing){
    if(existing.phone_hash!==phoneHash)throw new ApiError(409,'session_consumed','Cette partie a déjà attribué son code.');
    return json({awarded:true,score:existing.score,reward:publicRewardView(existing,now)},200,{"Set-Cookie":cookie(ownerCookie(request))});
  }
  if(s.state!=='eligible'||s.reservation_active!==1||s.expires_at<=now||s.claim_deadline<=now)throw new ApiError(409,'session_not_eligible','Cette partie ne peut plus confirmer une récompense.');
  const ip=await ipHash(request,env);
  await rateLimit(env.DB,[{key:'claim:o:'+ownerHash,windowMs:3600000,limit:10},{key:'claim:p:'+phoneHash,windowMs:86400000,limit:10},{key:'claim:i:'+ip,windowMs:3600000,limit:30}],now);
  const restriction=await getRestrictions(env.DB,{phoneHash,deviceHash:ownerHash,now:Date.now()});
  if(restriction.blocked){await recordDuplicate(env.DB,{restriction,ownerHash,firstName,lastName,now:Date.now()});return json({error:restriction.reason,message:'Tu as déjà remporté une récompense au cours des 30 derniers jours. Tu peux continuer à jouer autant que tu le souhaites !',nextEligibleAt:restriction.nextEligibleAt},409);}
  const id=secureId(),customer=await customerColumns(env,{phone,firstName,lastName,rewardId:id});
  const result=await award(env.DB,{id,sessionId:s.id,ownerHash,phoneHash,now:Date.now(),firstName,lastName,customer,unverifiedProfile:true});
  if(!result.reward){if(['phone_cooldown','device_cooldown'].includes(result.reason)){const restriction=await getRestrictions(env.DB,{phoneHash,deviceHash:ownerHash,now:Date.now()});await recordDuplicate(env.DB,{restriction,ownerHash,firstName,lastName,now:Date.now()});return json({error:result.reason,message:'Tu as déjà remporté une récompense au cours des 30 derniers jours. Tu peux continuer à jouer autant que tu le souhaites !',nextEligibleAt:restriction.nextEligibleAt},409);}throw new ApiError(409,'session_consumed','Cette partie ne peut plus attribuer de code.');}
  return json({awarded:true,score:result.reward.score,reward:publicRewardView(result.reward,now)},200,{"Set-Cookie":cookie(ownerCookie(request))});
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
  if (path === "/api/admin/setup" && request.method === "GET") {
    if (employee.role !== "manager") throw new ApiError(403, "manager_required");
    // Keep this diagnostic usable when another schema table or reward secret
    // is absent; the manager's verified identity and allowlist remain required.
    return json(await setupDiagnostics(env, now));
  }
  await adminRate(request, env, employee, path, now);
  if (path === "/api/admin/me" && request.method === "GET") return json({ employee: { ...employee, subject: employee.sub },previewTestRedemption:previewTestRedemption(env),phoneVerificationMode:phoneVerificationMode(env),notificationSmsEnabled:phoneVerificationMode(env)==="sms"&&notificationConfigured(env) });
  if (path === "/api/admin/budget" && request.method === "GET") {
    await cleanup(env.DB, now);
    const { month } = monthWindow(now);
    return json(await getBudget(env.DB, { month, now }));
  }
  if (path === "/api/admin/budget" && request.method === "PATCH") {
    if (employee.role !== "manager") throw new ApiError(403, "manager_required", "Seul un responsable peut modifier le budget.");
    return json(await changeBudget(env.DB, employee, body));
  }
  if (path === "/api/admin/manual-rewards/quote" && request.method === "POST") {
    if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503,"schema_unavailable");
    return json(await quoteManual(env,employee,body));
  }
  if (path === "/api/admin/manual-rewards" && request.method === "POST") {
    if (!await rewardDatabaseReady(env.DB)) throw new ApiError(503,"schema_unavailable");
    const result=await createManual(env,employee,body);
    const row=await stmt(env.DB,"SELECT * FROM rewards WHERE id=?",result.reward.id).first();
    return json({...result,notification:await notifyInitial(env,row,body.phone,employee.sub)});
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
    const search=url.searchParams.get('search');
    if(search){
      const term=string(search,'search',200),normal=normalizeNameSearch(term),like='%'+normal.replace(/[\\%_]/g,c=>'\\'+c)+'%';
      const parts=["code=?","name_search LIKE ? ESCAPE '\\'"];
      args.push(term.trim().toUpperCase(),like);
      if(/^[+()\d .-]+$/.test(term)){
        const digits=term.replace(/\D/g,'');
        if(digits.length>=8){const candidate=term.trim().startsWith('+')?term:(digits.length===10?'+1'+digits:'+'+digits);try{const normalized=normalizePhone(candidate);parts.push('phone_hash=?');args.push(await privateHmac(env,'phone',normalized));}catch{}}
      }
      conditions.push('('+parts.join(' OR ')+')');
    }
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
      const fields = ["id", "code", "score", "valueCents", "status", "source", "discountApplied", "foodOnlyConfirmed", "eligibleFoodCents", "appliedValueCents", "unusedCents", "firstName", "lastName", "fullName", "phone", "phoneVerified", "confirmedAt", "claimBy", "claimedBy", "claimedByName", "claimedAt", "issuedBy", "issuedByName", "issuedAt", "cancelledByName", "cancelledAt", "lightspeedRef", "cancelReason"];
      await stmt(env.DB, "INSERT INTO audit(action,actor_sub,actor_name,created_at,details) VALUES('export',?,?,?,?)", employee.sub, employee.name, now, JSON.stringify({ count: rows.length })).run();
      const privateRows=await Promise.all(rows.map(r=>adminCustomerView(env,r,now)));
      const csv = "\uFEFF" + [fields.map(escape).join(","), ...privateRows.map(value=>fields.map(k=>escape(value[k])).join(","))].join("\r\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="recompenses.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const more = rows.length > 100;
    const page = rows.slice(0, 100);
    const last = page.at(-1);
    return json({ rewards: await Promise.all(page.map((r) => adminCustomerView(env,r,now))), ...more ? { nextCursor: `${last.confirmed_at}:${last.id}` } : {} });
  }
  const eligibilityMatch=path.match(/^\/api\/admin\/rewards\/([A-Za-z0-9_-]{20,128})\/(eligibility|unlock)$/);
  if(eligibilityMatch){
    const [,id,action]=eligibilityMatch;
    const reward=await stmt(env.DB,'SELECT * FROM rewards WHERE id=?',id).first();if(!reward)throw new ApiError(404,'reward_not_found');
    if(action==='eligibility'&&request.method==='GET')return json(await adminEligibility(env.DB,reward,now));
    if(action==='unlock'&&request.method==='POST'){if(employee.role!=='manager')throw new ApiError(403,'manager_required');return json(await grantException(env.DB,employee,reward,body,now));}
    throw new ApiError(405,'method_not_allowed');
  }
  const match = path.match(/^\/api\/admin\/rewards\/([A-Za-z0-9_-]{20,128})\/(claim|use|issue|cancel|notify)$/);
  if (match && request.method === "POST") {
    const [, id, action] = match;
    if (action === "notify") {
      requireSmsMode(env);
      const reward=await stmt(env.DB,"SELECT * FROM rewards WHERE id=?",id).first();
      if(!reward)throw new ApiError(404,"reward_not_found");
      return json({notification:await sendRewardSms(env,{reward,phone:body.phone,actor:employee.sub,requestId:body.requestId})});
    }
    let result;
    if (action === "claim") {
      result = await stmt(env.DB, "UPDATE rewards SET status='claimed',claimed_by=?,claimed_by_name=?,claimed_at=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='pending' AND claim_by>? RETURNING *", employee.sub, employee.name, now, employee.sub, employee.name, id, now).first();
    } else if (action === "issue") {
      throw new ApiError(410, "manual_discount_confirmation_required", "Ce bon de rabais exige la confirmation de son application manuelle sur la facture.");
    } else if (action === "use") {
      if(body.previewTestConsumed===true){
        if(!previewTestRedemption(env))throw new ApiError(403,"preview_test_forbidden","La consommation sans rabais est réservée aux essais Preview isolés.");
        if(body.discountApplied===true)throw new ApiError(400,"test_discount_not_applied");
        result=await stmt(env.DB,"UPDATE rewards SET status='issued',preview_test_consumed=1,issued_by=?,issued_by_name=?,issued_at=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='claimed' AND claimed_by=? RETURNING *",employee.sub,employee.name,now,employee.sub,employee.name,id,employee.sub).first();
      }else{
      if (body.discountApplied !== true) throw new ApiError(400, "discount_confirmation_required", "Confirmez que le rabais a été appliqué manuellement sur la facture.");
      if (body.foodOnlyConfirmed !== true || !Number.isSafeInteger(body.eligibleFoodCents) || body.eligibleFoodCents<=0) throw new ApiError(400,"food_confirmation_required","Confirmez la portion alimentaire admissible et l’absence de rabais sur les boissons alcooliques.");
      result = await stmt(env.DB, "UPDATE rewards SET status='issued',discount_applied=1,food_only_confirmed=1,eligible_food_cents=?,applied_value_cents=MIN(value_cents,?),issued_by=?,issued_by_name=?,issued_at=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status='claimed' AND claimed_by=? AND discount_applied=0 RETURNING *", body.eligibleFoodCents,body.eligibleFoodCents,employee.sub, employee.name, now, employee.sub, employee.name, id, employee.sub).first();
      }
    } else {
      if (employee.role !== "manager") throw new ApiError(403, "manager_required", "Seul un responsable peut annuler.");
      const reason = string(body.reason, "reason", 500);
      result = await stmt(env.DB, "UPDATE rewards SET status='cancelled',cancelled_at=?,cancelled_by_name=?,cancel_reason=?,last_actor_sub=?,last_actor_name=? WHERE id=? AND status IN ('pending','claimed') RETURNING *", now, employee.name, reason, employee.sub, employee.name, id).first();
    }
    if (!result) {
      const old = await stmt(env.DB, "SELECT * FROM rewards WHERE id=?", id).first();
      if (!old) throw new ApiError(404, "reward_not_found");
      if (action === "claim" && old.status === "claimed" && old.claimed_by === employee.sub || action === "use" && old.status === "issued" && old.issued_by === employee.sub && (body.previewTestConsumed===true && previewTestRedemption(env) && old.preview_test_consumed===1 || body.previewTestConsumed!==true && old.discount_applied === 1 && old.food_only_confirmed === 1 && old.eligible_food_cents === body.eligibleFoodCents) || action === "cancel" && old.status === "cancelled") return json({ reward: await adminCustomerView(env,old,now) });
      throw new ApiError(409, "reward_conflict", "Ce bon de rabais a déjà été traité, est expiré ou appartient à un autre employé.");
    }
    return json({ reward: await adminCustomerView(env,result,now) });
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
    if (path === "/api/rewards/notification" && request.method === "POST") {
      requireSmsMode(env);
      const ownerHash=await owner(request,env);
      if(!validId(body.rewardId))throw new ApiError(400,"invalid_reward");
      const reward=await stmt(env.DB,"SELECT r.* FROM rewards r JOIN sessions s ON s.id=r.session_id WHERE r.id=? AND s.owner_hash=?",body.rewardId,ownerHash).first();
      if(!reward)throw new ApiError(404,"reward_not_found");
      await rateLimit(env.DB,[{key:'notify:o:'+ownerHash,windowMs:3600000,limit:6}],now);
      return json({notification:await sendRewardSms(env,{reward,phone:body.phone,actor:ownerHash,requestId:body.requestId})});
    }
    if (path === "/api/rewards/confirmation" && request.method === "GET") {
      if (typeof env.REWARDS_HMAC_SECRET !== "string" || env.REWARDS_HMAC_SECRET.length < 32) throw new ApiError(503, "configuration_pending");
      const ownerHash = await owner(request, env);
      const row = await stmt(env.DB, "SELECT r.* FROM rewards r JOIN sessions s ON s.id=r.session_id WHERE s.owner_hash=? ORDER BY r.confirmed_at DESC LIMIT 1", ownerHash).first();
      return json({ reward: publicRewardView(row, now) });
    }
    if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
    if (path === "/api/games/start") return await start(request, env, body, now);
    if (path === "/api/games/finish") return await finish(request, env, body, now);
    if (path === "/api/rewards/claim") return await directClaim(request,env,body,now);
    if (path === "/api/rewards/sms/request") return await smsRequest(request, env, body, now);
    if (path === "/api/rewards/sms/verify") return await smsVerify(request, env, body, now);
    throw new ApiError(404, "not_found");
  } catch (error) {
    if (error.status) return json({ error: error.code || "request_failed", message: error.message,...error.retryAfter?{retryAfter:error.retryAfter}:{} }, error.status,error.retryAfter?{"Retry-After":String(error.retryAfter)}:{});
    console.error("Rewards request failed", error?.name || "Error");
    return json({ error: "service_unavailable", message: "Service temporairement indisponible." }, 503);
  }
}
export {
  handleRequest
};
