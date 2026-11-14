// Access JWTs are verified against this deployment's fixed Cloudflare team.
// Request headers that merely assert an email address are never trusted.
const keySets = new Map();
const MAX_JWT_BYTES = 16384;
const CACHE_MS = 300000;

export class AuthError extends Error {
  constructor(message, status = 401, code = 'unauthorized') {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

function fail() { throw new AuthError('Employee authentication required.'); }

function accessConfig(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').toLowerCase();
  const audience = String(env.ACCESS_AUD || '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team) || !audience || audience.length > 256) {
    throw new AuthError('Employee authentication is not configured.', 503, 'admin_unavailable');
  }
  return { issuer: `https://${team}`, audience };
}

function decodeSegment(part) {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) fail();
  try {
    const str = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4));
    return Uint8Array.from(str, c => c.charCodeAt(0));
  } catch { fail(); }
}

function parseSegment(part) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeSegment(part)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value;
  } catch { fail(); }
}

async function loadKeys(issuer, fetchImpl, refresh = false) {
  const cached = keySets.get(issuer);
  if (!refresh && cached && cached.until > Date.now()) return cached.keys;
  let response;
  try {
    response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {
      headers: { accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AuthError('Employee authentication is temporarily unavailable.', 503, 'admin_unavailable');
  }
  if (!response.ok) throw new AuthError('Employee authentication is temporarily unavailable.', 503, 'admin_unavailable');
  let content;
  try { content = await response.text(); }
  catch { throw new AuthError('Employee authentication is temporarily unavailable.', 503, 'admin_unavailable'); }
  if (content.length > 65536) throw new AuthError('Invalid employee authentication keys.', 503, 'admin_unavailable');
  let keys;
  try {
    const data = JSON.parse(content);
    keys = data.keys.filter(key => key && key.kty === 'RSA' && typeof key.kid === 'string' &&
      (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256') && !key.d);
    if (!keys.length || keys.length > 20) throw new Error();
  } catch {
    throw new AuthError('Invalid employee authentication keys.', 503, 'admin_unavailable');
  }
  keySets.set(issuer, { keys, until: Date.now() + CACHE_MS });
  return keys;
}

export async function verifyAccessIdentity(request, env, { fetchImpl = fetch } = {}) {
  const { issuer, audience } = accessConfig(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > MAX_JWT_BYTES) fail();
  const parts = token.split('.');
  if (parts.length !== 3) fail();
  const header = parseSegment(parts[0]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256 || header.crit) fail();
  let keys = await loadKeys(issuer, fetchImpl);
  let jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) {
    keys = await loadKeys(issuer, fetchImpl, true);
    jwk = keys.find(key => key.kid === header.kid);
  }
  if (!jwk) fail();
  let valid = false;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeSegment(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { fail(); }
  if (!valid) fail();
  const claims = parseSegment(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  const aud = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (claims.iss !== issuer || !Array.isArray(aud) || !aud.includes(audience) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 60)) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 ||
      typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(claims.email)) fail();
  return { sub: claims.sub, email: claims.email.toLowerCase() };
}

export async function requireAdmin(request, env, options) {
  const identity = await verifyAccessIdentity(request, env, options);
  if (!env.DB) throw new AuthError('Employee access is unavailable.', 503, 'admin_unavailable');
  let employee;
  try {
    employee = await env.DB.prepare('SELECT sub,email,name,role,active FROM employees WHERE sub = ?').bind(identity.sub).first();
  } catch {
    throw new AuthError('Employee access is unavailable.', 503, 'admin_unavailable');
  }
  if (!employee || employee.active !== 1 || typeof employee.email !== 'string' || employee.email.toLowerCase() !== identity.email ||
      !['staff', 'manager'].includes(employee.role) || typeof employee.name !== 'string' || !employee.name.trim()) {
    throw new AuthError('This employee is not authorized.', 403, 'forbidden');
  }
  return { ...identity, role: employee.role, name: employee.name.trim() };
}
