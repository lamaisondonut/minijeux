import { originConfigured, iso } from "./common.mjs";
import { notificationConfigured } from "./notification-sms.mjs";
import { smsConfiguration, smsProviderConfiguration } from "./sms.mjs";

// Fixed identifiers only. These checks inspect the bound database and never
// create tables, seed rewards, contact the paid provider, or reveal secrets.
const TABLES = {
  budgets: ["month", "used_cents", "reserved_cents", "limit_cents", "revision", "updated_at", "updated_by", "exceptional_cents"],
  reward_budget_settings: ["id", "default_monthly_limit_cents", "revision", "updated_at", "updated_by"],
  employees: ["sub", "email", "name", "role", "active"],
  sessions: ["id", "owner_hash", "seed", "width", "height", "mode", "engine_version", "month", "cap_cents", "created_at", "expires_at", "state", "reservation_active", "score", "finish_json", "claim_deadline", "bound_phone_hash", "first_name", "last_name", "sms_day", "sms_reserved", "sms_consumed", "active_challenge_id", "verification_revision", "verification_next_send_at", "verification_send_count"],
  challenges: ["id", "owner_hash", "session_id", "phone_hash", "created_at", "expires_at", "attempts", "state", "lease_until", "provider_sid", "consent_version", "first_name", "last_name", "revision"],
  rewards: ["id", "session_id", "phone_hash", "code", "value_cents", "month", "first_name", "last_name", "score", "confirmed_at", "claim_by", "status", "claimed_by", "claimed_by_name", "claimed_at", "issued_by", "issued_by_name", "issued_at", "cancelled_by_name", "cancelled_at", "lightspeed_ref", "cancel_reason", "last_actor_sub", "last_actor_name", "discount_applied", "source", "manual_reason", "manual_request_id", "manual_fingerprint", "budget_override", "budget_override_reason", "exceptional_cents", "cooldown_override", "cooldown_override_reason", "food_only_confirmed", "eligible_food_cents", "applied_value_cents", "preview_test_consumed"],
  audit: ["id", "reward_id", "action", "actor_sub", "actor_name", "created_at", "details"],
  rate_limits: ["key", "window_start", "count"],
  sms_daily: ["day", "count", "reserved"],
  notification_sms:["id","reward_id","request_id","actor_sub","phone_hash","kind","state","created_at","provider_sid","sent_at","error_code"],
  notification_sms_daily:["day","count"],
};
const TRIGGERS = ["session_reserve", "session_release", "session_no_reactivate", "reward_validate", "reward_allocate", "reward_initial_state", "reward_transition", "reward_audit", "session_sms_reserve", "session_sms_release", "session_sms_no_reactivate", "session_sms_required", "session_verification_no_rewind", "challenge_verification_identity"];
const INDEXES = ["audit_budget_request", "rewards_manual_request", "notification_sms_initial", "notification_sms_reward"];
const schemaChecks = new WeakMap();

async function databaseStatus(db) {
  try {
    const { results } = await db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','trigger','index')").all();
    const tables = new Set(results.filter(row => row.type === "table").map(row => row.name));
    const triggers = new Set(results.filter(row => row.type === "trigger").map(row => row.name));
    const indexes = new Set(results.filter(row => row.type === "index").map(row => row.name));
    const missingTables = Object.keys(TABLES).filter(name => !tables.has(name));
    const missingTriggers = TRIGGERS.filter(name => !triggers.has(name));
    const missingIndexes = INDEXES.filter(name => !indexes.has(name));
    const missingColumns = [];
    for (const [name, required] of Object.entries(TABLES)) {
      if (!tables.has(name)) continue;
      const columns = await db.prepare(`PRAGMA table_info(${name})`).all();
      const present = new Set(columns.results.map(column => column.name));
      for (const column of required) if (!present.has(column)) missingColumns.push(`${name}.${column}`);
    }
    const missingRows = [];
    if (tables.has("reward_budget_settings") && !missingColumns.some(name => name.startsWith("reward_budget_settings."))) {
      if (!await db.prepare("SELECT id FROM reward_budget_settings WHERE id=1").first()) missingRows.push("reward_budget_settings.1");
    }
    return { connected: true, schemaReady: !missingTables.length && !missingColumns.length && !missingTriggers.length && !missingIndexes.length && !missingRows.length, missingTables, missingColumns, missingTriggers, missingIndexes, missingRows };
  } catch {
    return { connected: false, schemaReady: false };
  }
}

export async function rewardDatabaseReady(db) {
  if (!db) return false;
  const cached = schemaChecks.get(db);
  if (cached && cached.until > Date.now()) return true;
  const status = await databaseStatus(db);
  // Only successful checks are cached. Applying a missing migration can take
  // effect immediately, while each warm isolate rechecks a ready schema.
  if (status.schemaReady) schemaChecks.set(db, { until: Date.now() + 60000 });
  return status.schemaReady;
}

export async function setupDiagnostics(env, now = Date.now()) {
  const configuration = {
    originConfigured: originConfigured(env),
    rewardsEnabled: env.REWARDS_ENABLED === "true",
    smsApproved: env.SMS_APPROVED === "true",
    termsApproved: env.TERMS_APPROVED === "true",
    hmacConfigured: typeof env.REWARDS_HMAC_SECRET === "string" && env.REWARDS_HMAC_SECRET.length >= 32,
    turnstileConfigured: typeof env.TURNSTILE_SECRET === "string" && env.TURNSTILE_SECRET.length >= 10 && typeof env.TURNSTILE_SITE_KEY === "string" && env.TURNSTILE_SITE_KEY.length >= 5,
    smsProviderConfigured: smsProviderConfiguration(env).enabled,
    smsConfigured: smsConfiguration(env).enabled,
  };
  const database = await databaseStatus(env.DB);
  return {
    checkedAt: iso(now),
    configuration,
    database,
    rewardsConfigured: database.schemaReady && Object.values(configuration).every(Boolean),
    manualRewardsEnabled:env.MANUAL_REWARDS_ENABLED === "true" && env.TERMS_APPROVED === "true",
    notificationSmsConfigured:notificationConfigured(env),
    providerVerification: "not_performed",
  };
}
