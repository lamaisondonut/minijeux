import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleRequest } from "../server/api.mjs";
import { startSession, cleanup, award } from "../server/store.mjs";
import { POLICY_VERSION, secureId, monthWindow, scoreValue, torontoDay } from "../server/common.mjs";
import { privateHmac } from "../server/sms.mjs";
import { migrateSqlite, migrationFiles, migrationSql } from "./helpers/migrations.cjs";
const schema = readFileSync(new URL("../migrations/0001_rewards.sql", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/game-session-winning-rewards.json", import.meta.url), "utf8"));
class D1 {
  constructor(options) {
    this.sqlite = new DatabaseSync(":memory:");
    migrateSqlite(this.sqlite, options);
  }
  prepare(sql) {
    const sqlite = this.sqlite;
    let args = [];
    return { bind(...v) {
      args = v;
      return this;
    }, async first() {
      return sqlite.prepare(sql).get(...args) || null;
    }, async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    }, async run() {
      const r = sqlite.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    }, _execute() {
      return { results: sqlite.prepare(sql).all(...args) };
    } };
  }
  async batch(items) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const r = items.map((x) => x._execute());
      this.sqlite.exec("COMMIT");
      return r;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}
function environment() {
  return { DB: new D1(), APP_ORIGIN: "https://game.example", REWARDS_ENABLED: "true", SMS_APPROVED: "true", TERMS_APPROVED: "true", SMS_PROVIDER: "twilio", SMS_DAILY_LIMIT: "10", REWARDS_HMAC_SECRET: "a".repeat(48), TURNSTILE_SITE_KEY: "site-key-public", TURNSTILE_SECRET: "secret-turnstile", TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "token".repeat(8), TWILIO_VERIFY_SERVICE_SID: "VA" + "2".repeat(32), ACCESS_TEAM_DOMAIN: "api-tests.cloudflareaccess.com", ACCESS_AUD: "rewards-audience" };
}
const rawOwner = "o".repeat(43);
const ownerHeader = `__Host-rewards-owner=${rawOwner}`;
let now = Date.parse("2026-11-14T17:00:00Z");
const realNow = Date.now;
const realFetch = globalThis.fetch;
async function api(env, path, body, headers = {}) {
  return handleRequest(new Request(env.APP_ORIGIN + path, { method: body === void 0 ? "GET" : "POST", headers: { Cookie: ownerHeader, ...body === void 0 ? {} : { Origin: env.APP_ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, ...headers }, ...body === void 0 ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) } }), env);
}
async function ownedGame(env, { cap = 2e3, offset = 0, owner = rawOwner } = {}) {
  const ownerHash = await privateHmac(env, "owner", owner);
  const created = now - Math.ceil(fixture.ticks / 120 * 1e3) - 1e3 + offset;
  const month = monthWindow(created).month;
  if (cap !== 2e3) env.DB.sqlite.prepare("INSERT OR REPLACE INTO budgets(month,used_cents,reserved_cents) VALUES(?,?,0)").run(month, 1e4 - cap);
  return startSession(env.DB, { id: secureId(), ownerHash, seed: fixture.seed, width: fixture.width, height: fixture.height, engineVersion: fixture.engineVersion, month, now: created, expiresAt: now + 20 * 6e4, allowRewards: true, quotaDay:torontoDay(created), quotaLimit:Number(env.SMS_DAILY_LIMIT) });
}
const replay = (s) => ({ sessionId: s.id, ticks: fixture.ticks, jumps: fixture.jumps, resizes: fixture.resizes, score: 999999999 });
let turnstileGood = true;
let providerGood = true;
let providerDown = false;
let sent = 0;
let checks = 0;
let beforeCheck = null;
function mockFetch() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) return Response.json({ success: turnstileGood, hostname: "game.example", action: "boreal-session", challenge_ts: new Date(now).toISOString() });
    if (url.includes("/cdn-cgi/access/certs")) return Response.json({ keys: [publicJwk] });
    if (url.includes("verify.twilio.com")) {
      if (providerDown) throw Error("provider offline");
      const params = new URLSearchParams(init.body);
      if (url.endsWith("/Verifications")) {
        sent++;
        return Response.json({ service_sid: "VA" + "2".repeat(32), sid: "VE" + "3".repeat(32), status: "pending", to: params.get("To") });
      }
      checks++;
      if (beforeCheck) await beforeCheck();
      return Response.json({ service_sid: "VA" + "2".repeat(32), sid: "VE" + "3".repeat(32), status: providerGood ? "approved" : "pending", valid: providerGood, to: "+15145551234" });
    }
    throw Error("Unexpected outbound URL " + url);
  };
}
let signingKey, publicJwk;
async function jwt(sub = "alice", email = "alice@example.com") {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = enc({ alg: "RS256", kid: "api-key" }) + "." + enc({ iss: "https://api-tests.cloudflareaccess.com", aud: ["rewards-audience"], sub, email, exp: Math.floor(now / 1e3) + 600, iat: Math.floor(now / 1e3) });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(body));
  return body + "." + Buffer.from(sig).toString("base64url");
}
test.before(async () => {
  Date.now = () => now;
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  signingKey = pair.privateKey;
  publicJwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "api-key", alg: "RS256", use: "sig" };
  mockFetch();
});
test.after(() => {
  Date.now = realNow;
  globalThis.fetch = realFetch;
});
test.beforeEach(() => {
  now = Date.parse("2026-11-14T17:00:00Z");
  turnstileGood = true;
  providerGood = true;
  providerDown = false;
  sent = 0;
  checks = 0;
  beforeCheck = null;
});
test("disabled and missing services remain pending without financial promises", async () => {
  const env = environment();
  delete env.DB;
  let r = await api(env, "/api/rewards/status");
  let value = await r.json();
  assert.equal(value.mode, "pending");
  assert.equal(value.rewardsEnabled, false);
  assert.ok(value.tiers.every((t) => !t.available));
  assert.equal(value.usedCents, void 0);
  env.DB = new D1();
  env.SMS_APPROVED = "false";
  r = await api(env, "/api/games/start", { width: 390, height: 844, expectedMode: "rewards", turnstileToken: "token" });
  assert.equal(r.status, 503);
  assert.equal(sent, 0);
});
test("a missing payout safety trigger closes offers and sessions until the schema is repaired", async () => {
  const env = environment();
  env.DB.sqlite.exec("DROP TRIGGER reward_validate");
  const unavailable = await (await api(env, "/api/rewards/status")).json();
  assert.equal(unavailable.mode, "pending");
  assert.equal(unavailable.rewardsEnabled, false);
  assert.ok(unavailable.tiers.every(t => !t.available));
  assert.equal(unavailable.remainingCents, undefined);
  assert.equal((await api(env, "/api/games/start", {width:390,height:844,expectedMode:"rewards",turnstileToken:"token"})).status, 503);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
  assert.equal(sent, 0);
  env.DB.sqlite.exec(schema);
  assert.equal((await (await api(env, "/api/rewards/status")).json()).mode, "rewards");
});

test("setup checks the actual schema and gates for managers without sending SMS or returning secrets", async () => {
  const env = environment();
  assert.equal((await api(env, "/api/admin/setup")).status, 401);
  const headers = {"Cf-Access-Jwt-Assertion":await jwt()};
  assert.equal((await api(env, "/api/admin/setup", undefined, headers)).status, 403);
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES('alice','alice@example.com','Alice','staff')").run();
  assert.equal((await api(env, "/api/admin/setup", undefined, headers)).status, 403);
  env.DB.sqlite.prepare("UPDATE employees SET role='manager'").run();
  let result = await (await api(env, "/api/admin/setup", undefined, headers)).json();
  assert.equal(result.database.connected, true);
  assert.equal(result.database.schemaReady, true);
  assert.equal(result.rewardsConfigured, true);
  assert.equal(result.providerVerification, "not_performed");
  const diagnostics = JSON.stringify(result);
  for (const value of [env.REWARDS_HMAC_SECRET, env.TWILIO_AUTH_TOKEN, env.TWILIO_ACCOUNT_SID, env.TURNSTILE_SECRET]) assert.ok(!diagnostics.includes(value));
  env.REWARDS_ENABLED = "false";
  result = await (await api(env, "/api/admin/setup", undefined, headers)).json();
  assert.equal(result.configuration.rewardsEnabled, false);
  assert.equal(result.configuration.smsProviderConfigured, true);
  assert.equal(result.configuration.smsConfigured, false);
  assert.equal(result.rewardsConfigured, false);
  assert.equal(env.REWARDS_ENABLED, "false");
  env.DB.sqlite.exec("DROP TRIGGER reward_validate; DROP TABLE audit; DROP TABLE rate_limits");
  delete env.REWARDS_HMAC_SECRET;
  result = await (await api(env, "/api/admin/setup", undefined, headers)).json();
  assert.equal(result.database.schemaReady, false);
  assert.deepEqual(result.database.missingTables.sort(), ["audit", "rate_limits"]);
  assert.deepEqual(result.database.missingTriggers, ["reward_validate"]);
  assert.equal(sent, 0);
  assert.equal(checks, 0);
  env.DB.sqlite.prepare("UPDATE employees SET active=0").run();
  assert.equal((await api(env, "/api/admin/setup", undefined, headers)).status, 403);
});
test("write requests enforce origin, fetch metadata, content type and 128KiB stream limit", async () => {
  const env = environment();
  assert.equal((await api(env, "/api/games/start", {}, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await api(env, "/api/games/start", {}, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await api(env, "/api/games/start", {}, { "Content-Type": "application/jsonbad" })).status, 415);
  assert.equal((await api(env, "/api/games/start", '{"x":"' + "x".repeat(131072) + '"}')).status, 413);
});
test("start reserves announced cap, requires real Turnstile, binds secure owner and resolves mode changes", async () => {
  const env = environment();
  turnstileGood = false;
  assert.equal((await api(env, "/api/games/start", { width: 390, height: 844, expectedMode: "rewards", turnstileToken: "token" })).status, 403);
  turnstileGood = true;
  const response = await api(env, "/api/games/start", { width: 390, height: 844, expectedMode: "extreme", turnstileToken: "token" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /__Host-rewards-owner=.*Secure; HttpOnly; SameSite=Strict/);
  const s = await response.json();
  assert.equal(s.capCents, 2e3);
  assert.equal(s.mode, "rewards");
  assert.equal(s.requiresModeConfirmation, true);
  const budget = env.DB.sqlite.prepare("SELECT * FROM budgets").get();
  assert.equal(budget.reserved_cents, 2e3);
  const repeated = await (await api(env, "/api/games/start", { width: 390, height: 844, expectedMode: "rewards" })).json();
  assert.equal(repeated.sessionId, s.sessionId);
});
test("finish computes genuine winning replay, ignores submitted score, rejects foreign owner and is idempotent", async () => {
  const env = environment();
  const s = await ownedGame(env);
  const foreign = await api(env, "/api/games/finish", replay(s), { Cookie: "__Host-rewards-owner=" + "x".repeat(43) });
  assert.equal(foreign.status, 404);
  const result = await (await api(env, "/api/games/finish", replay(s))).json();
  assert.equal(result.score, 10526);
  assert.equal(result.eligible, true);
  assert.equal(result.capCents, 2e3);
  assert.deepEqual(await (await api(env, "/api/games/finish", { ...replay(s), ticks: 1, jumps: [] })).json(), result);
  assert.equal(sent, 0);
  const lostEnv = environment();
  const other = await ownedGame(lostEnv);
  assert.equal((await api(lostEnv, "/api/games/finish", { sessionId: other.id, score: 1e4 })).status, 400);
  assert.equal(lostEnv.DB.sqlite.prepare("SELECT score FROM sessions").get().score, null);
});
test("positive SMS provider confirmation stores no raw phone or OTP and awards at announced cap only once", async () => {
  const env = environment();
  const s = await ownedGame(env, { cap: 1e3 });
  assert.equal((await api(env, "/api/games/finish", replay(s))).status, 200);
  const request = await api(env, "/api/rewards/sms/request", { sessionId: s.id, phone: "+1 (514) 555-1234", firstName: "\xC9milie", lastName: "No\xEBl", consentVersion: POLICY_VERSION });
  assert.equal(request.status, 200);
  const { challengeId } = await request.json();
  assert.equal(sent, 1);
  providerGood = false;
  let response = await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "123456" });
  assert.equal(response.status, 400);
  providerGood = true;
  response = await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "123456" });
  assert.equal(response.status, 200);
  const confirmation = await response.json();
  assert.equal(confirmation.awarded, true);
  assert.equal(confirmation.reward.valueCents, 1e3);
  assert.equal(confirmation.reward.firstName, "\xC9milie");
  assert.match(confirmation.reward.code, /^GOAT-[A-Z0-9_-]{27,}$/);
  assert.equal(checks, 2);
  const again = await (await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "999999" })).json();
  assert.equal(again.reward.code, confirmation.reward.code);
  assert.equal(checks, 2);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) count FROM rewards").get().count, 1);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT used_cents,reserved_cents FROM budgets").get(), Object.assign(/* @__PURE__ */ Object.create(null), { used_cents: 1e4, reserved_cents: 0 }));
  const stored = ["sessions", "challenges", "rewards", "audit", "rate_limits"].map((t) => JSON.stringify(env.DB.sqlite.prepare(`SELECT * FROM ${t}`).all())).join("");
  assert.ok(!stored.includes("+15145551234"));
  assert.ok(!stored.includes("123456"));
  const recovered = await (await api(env, "/api/rewards/confirmation")).json();
  assert.equal(recovered.reward.code, confirmation.reward.code);
  assert.equal((await api(env, "/api/rewards/confirmation", void 0, { Cookie: "" })).status, 401);
});
test("provider failure is closed and consumes paid-send quota conservatively", async () => {
  const env = environment();
  env.SMS_DAILY_LIMIT = "1";
  const s = await ownedGame(env);
  await api(env, "/api/games/finish", replay(s));
  providerDown = true;
  const payload = { sessionId: s.id, phone: "+15145551234", firstName: "Alice", lastName: "No\xEBl", consentVersion: POLICY_VERSION };
  assert.equal((await api(env, "/api/rewards/sms/request", payload)).status, 503);
  providerDown = false;
  assert.equal((await api(env, "/api/rewards/sms/request", payload)).status, 429);
  assert.equal(sent, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT count FROM sms_daily").get().count, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) count FROM rewards").get().count, 0);
});
test("verification that crosses expiry cannot award after provider approval", async () => {
  const env = environment();
  const s = await ownedGame(env);
  await api(env, "/api/games/finish", replay(s));
  const { challengeId } = await (await api(env, "/api/rewards/sms/request", { sessionId: s.id, phone: "+15145551234", firstName: "Alice", lastName: "No\xEBl", consentVersion: POLICY_VERSION })).json();
  beforeCheck = () => {
    now += 10 * 6e4 + 1;
  };
  assert.equal((await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "123456" })).status, 410);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) count FROM rewards").get().count, 0);
});
test("Toronto DST months, cutoff, reservation expiry and no carry-over", async () => {
  assert.equal(monthWindow(Date.parse("2026-03-10T12:00:00Z")).start, Date.parse("2026-03-01T05:00:00Z"));
  assert.equal(monthWindow(Date.parse("2026-03-10T12:00:00Z")).end, Date.parse("2026-04-01T04:00:00Z"));
  assert.equal(monthWindow(Date.parse("2026-11-10T12:00:00Z")).end, Date.parse("2026-12-01T05:00:00Z"));
  const env = environment();
  now = Date.parse("2026-12-01T04:29:00Z");
  const response = await (await api(env, "/api/rewards/status")).json();
  assert.equal(response.mode, "extreme");
  assert.equal(response.reason, "month_closing");
  const s = await ownedGame(env);
  await cleanup(env.DB, s.expires_at + 1);
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_cents FROM budgets").get().reserved_cents, 0);
  env.DB.sqlite.prepare("UPDATE budgets SET used_cents=7500").run();
  now = Date.parse("2026-12-01T05:00:00Z");
  const reset = await (await api(env, "/api/rewards/status")).json();
  assert.equal(reset.capCents, 2e3);
  assert.equal(reset.mode, "rewards");
  assert.equal(scoreValue(4999), 0);
  assert.equal(scoreValue(5e3), 500);
  assert.equal(scoreValue(7500), 1e3);
  assert.equal(scoreValue(1e4), 2e3);
});
test("Access identity requires verified JWT and admin requires active allowlist; manual discount use locks actor and audit has names", async () => {
  const env = environment();
  assert.equal((await api(env, "/api/admin/me", void 0, { "Cf-Access-Authenticated-User-Email": "alice@example.com" })).status, 401);
  const token = await jwt();
  const headers = { "Cf-Access-Jwt-Assertion": token };
  assert.equal((await api(env, "/api/admin/identity", void 0, headers)).status, 200);
  assert.equal((await api(env, "/api/admin/me", void 0, headers)).status, 403);
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,?)").run("alice", "alice@example.com", "Alice No\xEBl", "staff");
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,?)").run("bob", "bob@example.com", "Bob Hiver", "manager");
  assert.equal((await api(env, "/api/admin/me", void 0, headers)).status, 200);
  const s = await ownedGame(env);
  await api(env, "/api/games/finish", replay(s));
  const { challengeId } = await (await api(env, "/api/rewards/sms/request", { sessionId: s.id, phone: "+15145551234", firstName: '=HYPERLINK("x")', lastName: "Test", consentVersion: POLICY_VERSION })).json();
  const { reward } = await (await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "123456" })).json();
  let r = await api(env, `/api/admin/rewards/${reward.id}/claim`, {}, headers);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).reward.claimedByName, "Alice No\xEBl");
  const bob = { "Cf-Access-Jwt-Assertion": await jwt("bob", "bob@example.com") };
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, bob)).status, 409);
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers)).status, 200);
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers)).status, 200);
  const recovered = await (await api(env, "/api/rewards/confirmation")).json();
  const verifiedAgain = await (await api(env, "/api/rewards/sms/verify", { challengeId, phone: "+15145551234", code: "123456" })).json();
  for (const receipt of [recovered.reward, verifiedAgain.reward]) {
    assert.equal(receipt.status, "issued");
    assert.equal(receipt.discountApplied, true);
    assert.equal(receipt.code, reward.code);
    for (const field of ["claimedBy", "claimedByName", "issuedBy", "issuedByName", "lightspeedRef", "cancelReason", "cancelledByName"]) assert.equal(Object.hasOwn(receipt, field), false);
  }
  const audit = await (await api(env, `/api/admin/audit?rewardId=${reward.id}`, void 0, headers)).json();
  assert.ok(audit.audit.some((a) => a.actorName === "Alice No\xEBl" && a.action === "issued"));
  const csvResponse = await api(env, "/api/admin/export", void 0, headers);
  const bytes = new Uint8Array(await csvResponse.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const csv = new TextDecoder().decode(bytes);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("Alice No\xEBl"));
  assert.ok(csv.includes("issuedAt"));
  assert.ok(csv.includes("discountApplied"));
});

test("manual discount use requires a claimed code, a strict true attestation and the claimant; retry records one use", async () => {
  const env = environment();
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,?)").run("alice", "alice@example.com", "Alice Noël", "staff");
  const phoneHash = await privateHmac(env, "phone", "+15145551234");
  const ownerHash = await privateHmac(env, "owner", rawOwner);
  const run = await ownedGame(env);
  await api(env, "/api/games/finish", replay(run));
  env.DB.sqlite.prepare("UPDATE sessions SET bound_phone_hash=?,first_name='Camille',last_name='Essai' WHERE id=?").run(phoneHash, run.id);
  const { reward } = await award(env.DB, { sessionId: run.id, ownerHash, phoneHash, now });
  const headers = { "Cf-Access-Jwt-Assertion": await jwt() };
  const endpoint = `/api/admin/rewards/${reward.id}`;
  assert.equal((await api(env, `${endpoint}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers)).status, 409);
  assert.equal((await api(env, `${endpoint}/issue`, { lightspeedRef: "LS-LEGACY" }, headers)).status, 410);
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM rewards WHERE id=?").get(reward.id).status, "pending");
  assert.equal((await api(env, `${endpoint}/claim`, {}, headers)).status, 200);
  const claimed = env.DB.sqlite.prepare("SELECT claimed_by,claimed_by_name,claimed_at FROM rewards WHERE id=?").get(reward.id);
  const budget = env.DB.sqlite.prepare("SELECT used_cents,reserved_cents FROM budgets").get();
  for (const body of [{}, {discountApplied:false}, {discountApplied:"true"}, {discountApplied:1}, {discountApplied:null}, {lightspeedRef:"LS-OLD-UI"}]) assert.equal((await api(env, `${endpoint}/use`, body, headers)).status, 400);
  assert.equal(env.DB.sqlite.prepare("SELECT status,discount_applied,lightspeed_ref FROM rewards WHERE id=?").get(reward.id).status, "claimed");
  const first = await api(env, `${endpoint}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers);
  now += 2000;
  const retry = await api(env, `${endpoint}/use`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  const firstReward = (await first.json()).reward;
  assert.deepEqual((await retry.json()).reward, firstReward);
  assert.equal(firstReward.discountApplied, true);
  assert.equal(firstReward.lightspeedRef, null);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT claimed_by,claimed_by_name,claimed_at FROM rewards WHERE id=?").get(reward.id), claimed);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT used_cents,reserved_cents FROM budgets").get(), budget);
  assert.equal((await api(env, `${endpoint}/use`, { discountApplied: false }, headers)).status, 400);
  assert.equal((await api(env, `${endpoint}/issue`, { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, headers)).status, 410);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) count FROM audit WHERE reward_id=? AND action='issued'").get(reward.id).count, 1);
  const audit = env.DB.sqlite.prepare("SELECT details FROM audit WHERE reward_id=? AND action='issued'").get(reward.id);
  assert.deepEqual(JSON.parse(audit.details), {valueCents:2000,previewTestConsumed:false,discountApplied:true,foodOnlyConfirmed:true,eligibleFoodCents:2000,appliedValueCents:2000,unusedCents:0,reason:null});
});

test("a historical completed code remains terminal without inventing a manual discount attestation", async () => {
  const env = environment();
  env.DB.sqlite.close();
  env.DB = new D1({before:"0003"});
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES('alice','alice@example.com','Alice Historique','staff')").run();
  const run = await ownedGame(env);
  const phoneHash = await privateHmac(env, "phone", "+15145551234");
  env.DB.sqlite.prepare("UPDATE sessions SET state='eligible',score=10000,claim_deadline=?,bound_phone_hash=?,first_name='Camille',last_name='Historique' WHERE id=?").run(now+600000, phoneHash, run.id);
  const {reward} = await award(env.DB, {sessionId:run.id,ownerHash:run.owner_hash,phoneHash,now});
  env.DB.sqlite.prepare("UPDATE rewards SET status='claimed',claimed_by='alice',claimed_by_name='Alice Historique',claimed_at=?,last_actor_sub='alice',last_actor_name='Alice Historique' WHERE id=?").run(now, reward.id);
  env.DB.sqlite.prepare("UPDATE rewards SET status='issued',issued_by='alice',issued_by_name='Alice Historique',issued_at=?,lightspeed_ref='HISTORIQUE-CONSERVE',last_actor_sub='alice',last_actor_name='Alice Historique' WHERE id=?").run(now, reward.id);
  const old = env.DB.sqlite.prepare("SELECT * FROM rewards WHERE id=?").get(reward.id);
  const auditBefore = env.DB.sqlite.prepare("SELECT * FROM audit ORDER BY id").all();
  const migration = migrationSql[migrationFiles.findIndex(name => name.startsWith("0003_"))];
  assert.ok(migration, "the manual-discount migration is present");
  env.DB.sqlite.exec("BEGIN IMMEDIATE");
  for(let i=migrationFiles.findIndex(name=>name.startsWith("0003_"));i<migrationSql.length;i++)env.DB.sqlite.exec(migrationSql[i]);
  env.DB.sqlite.exec("COMMIT");
  const headers = {"Cf-Access-Jwt-Assertion":await jwt()};
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/use`, {discountApplied:true,foodOnlyConfirmed:true,eligibleFoodCents:2000}, headers)).status, 409);
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/issue`, {lightspeedRef:"NOUVELLE-REFERENCE"}, headers)).status, 410);
  const stored = env.DB.sqlite.prepare("SELECT * FROM rewards WHERE id=?").get(reward.id);
  assert.equal(stored.discount_applied, 0);
  for (const key of Object.keys(old)) assert.deepEqual(stored[key], old[key], key);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT * FROM audit ORDER BY id").all(), auditBefore);
  assert.deepEqual({...env.DB.sqlite.prepare("SELECT used_cents,reserved_cents FROM budgets").get()}, {used_cents:2000,reserved_cents:0});
  const receipt = (await (await api(env, "/api/rewards/confirmation")).json()).reward;
  assert.equal(receipt.status, "issued");
  assert.equal(receipt.discountApplied, false);
  assert.equal(Object.hasOwn(receipt, "lightspeedRef"), false);
});

test("cancellation never refunds budget or resets the rolling 30-day phone rule; pending expiry stays virtual", async () => {
  const env = environment();
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,?)").run("alice", "alice@example.com", "Alice Responsable", "manager");
  const phoneHash = await privateHmac(env, "phone", "+15145551234");
  const ownerHash = await privateHmac(env, "owner", rawOwner);
  const first = await ownedGame(env);
  await api(env, "/api/games/finish", replay(first));
  env.DB.sqlite.prepare("UPDATE sessions SET bound_phone_hash=?,first_name='Alice',last_name='Noël' WHERE id=?").run(phoneHash, first.id);
  const { reward } = await award(env.DB, { sessionId: first.id, ownerHash, phoneHash, now });
  const confirmedAt = now;
  const headers = { "Cf-Access-Jwt-Assertion": await jwt() };
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/cancel`, { reason: "Erreur confirmée en magasin" }, headers)).status, 200);
  const receipt = (await (await api(env, "/api/rewards/confirmation")).json()).reward;
  assert.equal(receipt.status, "cancelled");
  assert.equal(Object.hasOwn(receipt, "cancelReason"), false);
  assert.equal(Object.hasOwn(receipt, "cancelledByName"), false);
  assert.equal(env.DB.sqlite.prepare("SELECT used_cents FROM budgets WHERE month='2026-11'").get().used_cents, 2000);
  assert.equal((await api(env, `/api/admin/rewards/${reward.id}/claim`, {}, headers)).status, 409);
  now = confirmedAt + 30 * 86400000 - 1;
  const second = await ownedGame(env);
  await api(env, "/api/games/finish", replay(second));
  env.DB.sqlite.prepare("UPDATE sessions SET bound_phone_hash=?,first_name='Alice',last_name='Noël' WHERE id=?").run(phoneHash, second.id);
  assert.equal((await award(env.DB, { sessionId: second.id, ownerHash, phoneHash, now })).reason, "phone_cooldown");
  now++;
  const secondAward = await award(env.DB, { sessionId: second.id, ownerHash, phoneHash, now });
  assert.equal(secondAward.reward.value_cents, 2000);
  now = secondAward.reward.claim_by + 1;
  const freshHeaders = { "Cf-Access-Jwt-Assertion": await jwt() };
  const listed = await (await api(env, "/api/admin/rewards?status=expired", undefined, freshHeaders)).json();
  assert.equal(listed.rewards.find(r => r.id === secondAward.reward.id).status, "expired");
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM rewards WHERE id=?").get(secondAward.reward.id).status, "pending");
  assert.equal((await api(env, `/api/admin/rewards/${secondAward.reward.id}/claim`, {}, freshHeaders)).status, 409);
  assert.equal(env.DB.sqlite.prepare("SELECT used_cents FROM budgets WHERE month='2026-12'").get().used_cents, 2000);
});

test("exhausted global SMS quota hides rewards and rejects new reservations", async () => {
  const env = environment();
  env.SMS_DAILY_LIMIT = "1";
  env.DB.sqlite.prepare("INSERT INTO sms_daily(day,count) VALUES('2026-11-14',1)").run();
  const status = await (await api(env, "/api/rewards/status")).json();
  assert.equal(status.mode, "pending");
  assert.equal(status.rewardsEnabled, false);
  assert.ok(status.tiers.every(t => !t.available));
  assert.equal(status.remainingCents, undefined);
  assert.equal((await api(env, "/api/games/start", {width:390,height:844,expectedMode:"rewards",turnstileToken:"token"})).status,503);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get().n,0);
  const ownerHash=await privateHmac(env,"owner",rawOwner);
  await assert.rejects(startSession(env.DB,{id:secureId(),ownerHash,seed:1,width:390,height:844,engineVersion:fixture.engineVersion,month:"2026-11",now,expiresAt:now+1800000,allowRewards:true,quotaDay:"2026-11-14",quotaLimit:1}),e=>e.code==="sms_daily_limit");
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_cents FROM budgets").get().reserved_cents,0);
});

test("confirmed score remains visible in the register, CSV and recovery after new games are disabled", async () => {
  const env = environment();
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES('alice','alice@example.com','Alice Essai','staff')").run();
  const run = await ownedGame(env);
  const phoneHash = await privateHmac(env,"phone","+15145551234");
  env.DB.sqlite.prepare("UPDATE sessions SET state='eligible',score=7500,claim_deadline=?,bound_phone_hash=?,first_name='Camille',last_name='Essai' WHERE id=?").run(now+600000,phoneHash,run.id);
  const confirmed = await award(env.DB,{sessionId:run.id,ownerHash:run.owner_hash,phoneHash,now});
  assert.equal(confirmed.reward.value_cents,1000);
  assert.equal(confirmed.reward.score,7500);
  const headers={"Cf-Access-Jwt-Assertion":await jwt()};
  let response=await api(env,"/api/admin/rewards",undefined,headers);
  const listed=await response.json();assert.equal(listed.rewards[0].score,7500);
  response=await api(env,"/api/admin/export",undefined,headers);
  assert.ok((await response.text()).includes('"7500"'));
  env.REWARDS_ENABLED="false";env.SMS_APPROVED="false";env.TERMS_APPROVED="false";
  const recovered=await (await api(env,"/api/rewards/confirmation")).json();
  assert.equal(recovered.reward.code,confirmed.reward.code);
  assert.equal(recovered.reward.score,7500);
  const denied=await api(env,"/api/rewards/confirmation",undefined,{Cookie:`__Host-rewards-owner=${"x".repeat(43)}`});
  assert.equal((await denied.json()).reward,null);
});

test("admin shows current Toronto month money and real cross-month code counts and latest winners", async () => {
  const env = environment();
  env.DB.sqlite.prepare("INSERT INTO employees(sub,email,name,role) VALUES('alice','alice@example.com','Alice Responsable','manager')").run();
  let phoneSequence = 0;
  async function confirm(at, status = "pending") {
    now = Date.parse(at);
    const run = await ownedGame(env);
    const phoneHash = await privateHmac(env, "phone", `+1514555${String(++phoneSequence).padStart(4, "0")}`);
    env.DB.sqlite.prepare("UPDATE sessions SET state='eligible',score=10000,claim_deadline=?,bound_phone_hash=?,first_name='Camille',last_name=? WHERE id=?").run(now+600000, phoneHash, `Gagnant ${phoneSequence}`, run.id);
    const { reward } = await award(env.DB, {sessionId:run.id,ownerHash:run.owner_hash,phoneHash,now});
    const headers = {"Cf-Access-Jwt-Assertion":await jwt()};
    if (["claimed", "issued"].includes(status)) assert.equal((await api(env, `/api/admin/rewards/${reward.id}/claim`, {}, headers)).status, 200);
    if (status === "issued") assert.equal((await api(env, `/api/admin/rewards/${reward.id}/use`, {discountApplied:true,foodOnlyConfirmed:true,eligibleFoodCents:2000}, headers)).status, 200);
    if (status === "cancelled") assert.equal((await api(env, `/api/admin/rewards/${reward.id}/cancel`, {reason:"Annulation confirmée"}, headers)).status, 200);
    return reward;
  }
  await confirm("2026-10-01T16:00:00Z"); // Expired, never counted as used.
  await confirm("2026-10-30T16:00:00Z", "issued");
  await confirm("2026-10-31T16:00:00Z"); // Still redeemable in November.
  await confirm("2026-11-01T16:00:00Z", "cancelled");
  const claimed = await confirm("2026-11-14T16:00:00Z", "claimed");
  const latest = await confirm("2026-11-15T16:00:00Z");
  const headers = {"Cf-Access-Jwt-Assertion":await jwt()};
  const budget = await (await api(env, "/api/admin/budget", undefined, headers)).json();
  for (const [key,value] of Object.entries({month:"2026-11",budgetCents:10000,usedCents:6000,reservedCents:0,remainingCents:4000,pendingCount:2,usedCount:2,countScope:"all"})) assert.equal(budget[key], value, key);
  const list = await (await api(env, "/api/admin/rewards", undefined, headers)).json();
  assert.equal(list.rewards.length, 6);
  assert.equal(list.rewards[0].id, latest.id);
  assert.equal(list.rewards[0].lastName, "Gagnant 6");
  assert.equal(list.rewards[1].id, claimed.id);
  const guest = await api(env, "/api/admin/budget");
  assert.equal(guest.status, 401);
  assert.equal((await guest.json()).usedCents, undefined);
});

test("the first SMS keeps its reserved place when other sends saturate the quota", async () => {
  const env = environment();env.SMS_DAILY_LIMIT="2";
  const run = await ownedGame(env);
  await api(env,"/api/games/finish",replay(run));
  env.DB.sqlite.prepare("UPDATE sms_daily SET count=1 WHERE day=?").run(run.sms_day);
  const status=await (await api(env,"/api/rewards/status")).json();assert.equal(status.mode,"pending");
  const sentResponse=await api(env,"/api/rewards/sms/request",{sessionId:run.id,phone:"+15145551234",firstName:"Camille",lastName:"Essai",consentVersion:POLICY_VERSION});
  assert.equal(sentResponse.status,200);assert.equal(sent,1);
  assert.deepEqual({...env.DB.sqlite.prepare("SELECT count,reserved FROM sms_daily WHERE day=?").get(run.sms_day)},{count:2,reserved:0});
});

test("wrong phone can be corrected and SMS resent without losing score, reservation or deadline; old verification is invalid",async()=>{
  const env=environment(),run=await ownedGame(env);await api(env,'/api/games/finish',replay(run));
  const payload={sessionId:run.id,phone:'+15145551235',firstName:'Camille',lastName:'Essai',consentVersion:POLICY_VERSION};
  const before=env.DB.sqlite.prepare('SELECT score,cap_cents,reservation_active,expires_at,claim_deadline FROM sessions').get();
  assert.equal((await api(env,'/api/rewards/sms/request',{...payload,phone:'erreur'})).status,400);assert.equal(sent,0);
  const initial=await(await api(env,'/api/rewards/sms/request',payload)).json();assert.ok(initial.challengeId);assert.equal(initial.sendsRemaining,4);
  assert.equal((await api(env,'/api/rewards/sms/request',{...payload,phone:'+15145551234'})).status,429);
  now+=61000;
  const corrected=await(await api(env,'/api/rewards/sms/request',{...payload,phone:'+15145551234'})).json();assert.ok(corrected.challengeId);assert.notEqual(corrected.challengeId,initial.challengeId);assert.equal(corrected.sendsRemaining,3);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT score,cap_cents,reservation_active,expires_at,claim_deadline FROM sessions').get(),before);
  assert.equal((await api(env,'/api/rewards/sms/verify',{challengeId:initial.challengeId,phone:payload.phone,code:'123456'})).status,409);
  providerGood=false;assert.equal((await api(env,'/api/rewards/sms/verify',{challengeId:corrected.challengeId,phone:'+15145551234',code:'000000'})).status,400);
  providerGood=true;const verified=await api(env,'/api/rewards/sms/verify',{challengeId:corrected.challengeId,phone:'+15145551234',code:'123456'});assert.equal(verified.status,200);const result=await verified.json();assert.equal(result.awarded,true);
  const repeated=await(await api(env,'/api/rewards/sms/verify',{challengeId:corrected.challengeId,phone:'+15145551234',code:'123456'})).json();assert.equal(repeated.reward.code,result.reward.code);
  assert.equal((await api(env,'/api/rewards/sms/request',payload)).status,409);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,1);assert.equal(sent,2);
});

test("correction during an in-flight provider verification prevents the old phone from winning",async()=>{
  const env=environment(),run=await ownedGame(env);await api(env,'/api/games/finish',replay(run));const payload={sessionId:run.id,phone:'+15145551234',firstName:'Camille',lastName:'Essai',consentVersion:POLICY_VERSION};
  const old=await(await api(env,'/api/rewards/sms/request',payload)).json();
  beforeCheck=async()=>{beforeCheck=null;now+=61000;assert.equal((await api(env,'/api/rewards/sms/request',{...payload,phone:'+15145551235'})).status,200);};
  assert.equal((await api(env,'/api/rewards/sms/verify',{challengeId:old.challengeId,phone:payload.phone,code:'123456'})).status,409);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);assert.equal(env.DB.sqlite.prepare('SELECT reservation_active FROM sessions').get().reservation_active,1);
});

test("five verification sends are the hard per-game limit and expiry is never extended",async()=>{
  const env=environment(),run=await ownedGame(env);await api(env,'/api/games/finish',replay(run));const payload={sessionId:run.id,phone:'+15145551234',firstName:'Camille',lastName:'Essai',consentVersion:POLICY_VERSION};
  const deadline=env.DB.sqlite.prepare('SELECT claim_deadline FROM sessions').get().claim_deadline;
  for(let index=0;index<5;index++){assert.equal((await api(env,'/api/rewards/sms/request',payload)).status,200);now+=61000;}
  assert.equal((await api(env,'/api/rewards/sms/request',payload)).status,429);assert.equal(sent,5);assert.equal(env.DB.sqlite.prepare('SELECT claim_deadline FROM sessions').get().claim_deadline,deadline);
});

test("Preview consumption records no POS discount and is forbidden on production or without the flag",async()=>{
  const env=environment();env.DB.sqlite.prepare("INSERT INTO employees VALUES('alice','alice@example.com','Alice','staff',1)").run();const run=await ownedGame(env);await api(env,'/api/games/finish',replay(run));const phoneHash=await privateHmac(env,'phone','+15145551234');env.DB.sqlite.prepare("UPDATE sessions SET bound_phone_hash=?,first_name='Camille',last_name='Essai' WHERE id=?").run(phoneHash,run.id);const {reward}=await award(env.DB,{sessionId:run.id,ownerHash:run.owner_hash,phoneHash,now});const headers={'Cf-Access-Jwt-Assertion':await jwt()},endpoint='/api/admin/rewards/'+reward.id;
  await api(env,endpoint+'/claim',{},headers);assert.equal((await api(env,endpoint+'/use',{previewTestConsumed:true},headers)).status,403);
  env.PREVIEW_TEST_REDEMPTION='true';env.DEPLOYMENT_ENVIRONMENT='preview';env.APP_ORIGIN='https://minijeux-4gy.pages.dev';assert.equal((await api(env,endpoint+'/use',{previewTestConsumed:true},headers)).status,403);
  env.APP_ORIGIN='https://develop-noel-budget-configurable.minijeux-4gy.pages.dev';const result=await api(env,endpoint+'/use',{previewTestConsumed:true},headers);assert.equal(result.status,200);const used=(await result.json()).reward;assert.equal(used.discountApplied,false);assert.equal(used.previewTestConsumed,true);assert.equal(used.appliedValueCents,null);
  assert.equal((await api(env,endpoint+'/use',{previewTestConsumed:true},headers)).status,200);const audit=env.DB.sqlite.prepare("SELECT details FROM audit WHERE action='preview_test_used'").all();assert.equal(audit.length,1);assert.equal(JSON.parse(audit[0].details).appliedValueCents,0);
});
