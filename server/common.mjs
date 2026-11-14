const POLICY_VERSION = "rewards-2026-11-v1";
const TIERS = Object.freeze([{ score: 5e3, valueCents: 500 }, { score: 7500, valueCents: 1e3 }, { score: 1e4, valueCents: 2e3 }]);
const TTL = 30 * 60 * 1e3;
const MAX_BODY = 128 * 1024;
class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function secureId(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}
function truth(value) {
  return value === true || value === "true";
}
function originConfigured(env) {
  try {
    const u = new URL(env.APP_ORIGIN);
    return u.origin === env.APP_ORIGIN && (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}
function csrf(request, env) {
  if (!originConfigured(env)) throw new ApiError(503, "configuration_pending", "Le service est en pr\xE9paration.");
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (origin !== env.APP_ORIGIN || new URL(request.url).origin !== env.APP_ORIGIN || site && site !== "same-origin" && site !== "none") throw new ApiError(403, "invalid_origin", "Origine de la requ\xEAte refus\xE9e.");
}
async function readJson(request) {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new ApiError(413, "body_too_large");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new ApiError(415, "json_required");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      size += value2.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new ApiError(413, "body_too_large");
      }
      chunks.push(value2);
    }
  }
  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(out));
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new ApiError(400, "invalid_json");
  return value;
}
function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(id);
}
function string(value, name, max = 120) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new ApiError(400, `invalid_${name}`);
  return value.trim();
}
function dimensions(width, height) {
  if (!Number.isInteger(width) || width < 160 || width > 4096 || !Number.isInteger(height) || height < 240 || height > 4096) throw new ApiError(400, "invalid_dimensions");
}
function ownerCookie(request) {
  const match = request.headers.get("Cookie")?.match(/(?:^|;\s*)__Host-rewards-owner=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match?.[1] || null;
}
function cookie(value) {
  return `__Host-rewards-owner=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}
const toronto = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function parts(ms) {
  return Object.fromEntries(toronto.formatToParts(ms).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}
function midnightUTC(y, m) {
  let value = Date.UTC(y, m - 1, 1, 5);
  for (let i = 0; i < 4; i++) {
    const p = parts(value);
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    value += Date.UTC(y, m - 1, 1) - local;
  }
  return value;
}
function monthWindow(now = Date.now()) {
  const p = parts(now);
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  return { month: `${p.year}-${String(p.month).padStart(2, "0")}`, start: midnightUTC(p.year, p.month), end: midnightUTC(nextYear, nextMonth) };
}
function torontoDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function scoreValue(score) {
  return score >= 1e4 ? 2e3 : score >= 7500 ? 1e3 : score >= 5e3 ? 500 : 0;
}
function rewardView(r, now = Date.now()) {
  if (!r) return null;
  return { id: r.id, code: r.code, valueCents: r.value_cents, score: r.score, status: r.status === "pending" && r.claim_by <= now ? "expired" : r.status, firstName: r.first_name, lastName: r.last_name, confirmedAt: iso(r.confirmed_at), claimBy: iso(r.claim_by), claimedAt: iso(r.claimed_at), claimedBy: r.claimed_by, claimedByName: r.claimed_by_name, issuedAt: iso(r.issued_at), issuedBy: r.issued_by, issuedByName: r.issued_by_name, cancelledByName: r.cancelled_by_name, lightspeedRef: r.lightspeed_ref, cancelledAt: iso(r.cancelled_at), cancelReason: r.cancel_reason };
}
export {
  ApiError,
  MAX_BODY,
  POLICY_VERSION,
  TIERS,
  TTL,
  cookie,
  csrf,
  dimensions,
  iso,
  json,
  monthWindow,
  originConfigured,
  ownerCookie,
  readJson,
  rewardView,
  scoreValue,
  secureId,
  string,
  truth,
  torontoDay,
  validId
};
