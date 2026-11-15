import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessIdentity, requireAdmin } from '../server/auth.mjs';

const encoder = new TextEncoder();
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'test-rsa', use: 'sig', alg: 'RS256' };
const env = { ACCESS_TEAM_DOMAIN: 'secure-rewards-test.cloudflareaccess.com', ACCESS_AUD: 'correct-audience' };
const claims = { iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: [env.ACCESS_AUD], exp: Math.floor(Date.now() / 1000) + 300, sub: 'employee-subject', email: 'Employee@example.com' };

async function jwt(payload = claims, header = { alg: 'RS256', kid: jwk.kid }) {
  const body = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, encoder.encode(body));
  return `${body}.${Buffer.from(signature).toString('base64url')}`;
}
function request(token, headers = {}) {
  return new Request('https://example.com/api/admin/identity', { headers: { ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}), ...headers } });
}
const options = { fetchImpl: async url => {
  assert.equal(url, `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  return Response.json({ keys: [jwk] });
} };

test('admin identity requires a valid RS256 JWT from the fixed team and audience', async () => {
  assert.deepEqual(await verifyAccessIdentity(request(await jwt()), env, options), { sub: claims.sub, email: 'employee@example.com' });
  for (const patch of [{ iss: 'https://attacker.cloudflareaccess.com' }, { aud: ['other'] }, { exp: Math.floor(Date.now() / 1000) - 1 }, { nbf: Math.floor(Date.now() / 1000) + 60 }, { sub: '' }]) {
    await assert.rejects(verifyAccessIdentity(request(await jwt({ ...claims, ...patch })), env, options), { status: 401 });
  }
  await assert.rejects(verifyAccessIdentity(request(await jwt(claims, { alg: 'HS256', kid: jwk.kid })), env, options), { status: 401 });
  await assert.rejects(verifyAccessIdentity(request(null, { 'Cf-Access-Authenticated-User-Email': 'employee@example.com' }), env, options), { status: 401 });
  const valid = await jwt();
  const pieces = valid.split('.');
  pieces[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString('base64url');
  await assert.rejects(verifyAccessIdentity(request(pieces.join('.')), env, options), { status: 401 });
});

test('JWKS endpoint cannot be supplied by a JWT and invalid server configuration fails closed', async () => {
  await assert.rejects(verifyAccessIdentity(request(await jwt()), { ...env, ACCESS_TEAM_DOMAIN: 'evil.example/path' }, options), { status: 503 });
  let requested;
  const otherEnv = { ...env, ACCESS_TEAM_DOMAIN: 'secure-rewards-other-test.cloudflareaccess.com' };
  const token = await jwt({ ...claims, iss: `https://${otherEnv.ACCESS_TEAM_DOMAIN}` }, { alg: 'RS256', kid: jwk.kid, jku: 'https://attacker.example/keys' });
  assert.equal((await verifyAccessIdentity(request(token), otherEnv, { fetchImpl: async url => { requested = url; return Response.json({ keys: [jwk] }); } })).sub, claims.sub);
  assert.equal(requested, `https://${otherEnv.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
});

test('active staff allowlist binds JWT subject and email and returns the human employee name', async () => {
  const tokenRequest = request(await jwt());
  let row = { sub: claims.sub, email: 'employee@example.com', name: 'Louise Tremblay', role: 'staff', active: 1 };
  const DB = { prepare(sql) {
    assert.match(sql, /FROM employees WHERE sub = \?/);
    return { bind(sub) { assert.equal(sub, claims.sub); return { first: async () => row }; } };
  } };
  assert.deepEqual(await requireAdmin(tokenRequest, { ...env, DB }, options), { sub: claims.sub, email: 'employee@example.com', name: 'Louise Tremblay', role: 'staff' });
  for (const bad of [null, { ...row, active: 0 }, { ...row, email: 'different@example.com' }, { ...row, role: 'owner' }, { ...row, name: '' }]) {
    const original = row;
    row = bad;
    await assert.rejects(requireAdmin(tokenRequest, { ...env, DB }, options), { status: 403 });
    row = original;
  }
});
