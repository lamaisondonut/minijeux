import { originConfigured, iso } from "./common.mjs";
import { smsConfiguration, smsProviderConfiguration } from "./sms.mjs";

// Fixed identifiers only. These checks inspect the bound database and never
// create tables, seed rewards, contact the paid provider, or reveal secrets.
const TABLES = {
  budgets: ["month", "used_cents", "reserved_cents"],
  employees: ["sub", "email", "name", "role", "active"],
  sessions: ["id", "owner_hash", "seed", "width", "height", "mode", "engine_version", "month", "cap_cents", "created_at", "expires_at", "state", "reservation_active", "score", "finish_json", "claim_deadline", "bound_phone_hash", "first_name", "last_name", "sms_day", "sms_reserved", "sms_consumed"],
  challenges: ["id", "owner_hash", "session_id", "phone_hash", "created_at", "expires_at", "attempts", "state", "lease_until", "provider_sid", "consent_version", "first_name", "last_name"],
  rewards: ["id", "session_id", "phone_hash", "code", "value_cents", "month", "first_name", "last_name", "score", "confirmed_at", "claim_by", "status", "claimed_by", "claimed_by_name", "claimed_at", "issued_by", "issued_by_name", "issued_at", "cancelled_by_name", "cancelled_at", "lightspeed_ref", "cancel_reason", "last_actor_sub", "last_actor_name"],
  audit: ["id", "reward_id", "action", "actor_sub", "actor_name", "created_at", "details"],
  rate_limits: ["key", "window_start", "count"],
  sms_daily: ["day", "count", "reserved"],
};
const TRIGGERS = ["session_reserve", "session_release", "session_no_reactivate", "reward_validate", "reward_allocate", "reward_transition", "reward_audit", "session_sms_reserve", "session_sms_release", "session_sms_no_reactivate", "session_sms_required"];
const schemaChecks = new WeakMap();

async function databaseStatus(db) {
  try {
    const { results } = await db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','trigger')").all();
    const tables = new Set(results.filter(row => row.type === "table").map(row => row.name));
    const triggers = new Set(results.filter(row => row.type === "trigger").map(row => row.name));
    const missingTables = Object.keys(TABLES).filter(name => !tables.has(name));
    const missingTriggers = TRIGGERS.filter(name => !triggers.has(name));
    const missingColumns = [];
    for (const [name, required] of Object.entries(TABLES)) {
      if (!tables.has(name)) continue;
      const columns = await db.prepare(`PRAGMA table_info(${name})`).all();
      const present = new Set(columns.results.map(column => column.name));
      for (const column of required) if (!present.has(column)) missingColumns.push(`${name}.${column}`);
    }
    return { connected: true, schemaReady: !missingTables.length && !missingColumns.length && !missingTriggers.length, missingTables, missingColumns, missingTriggers };
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
    providerVerification: "not_performed",
  };
}
