// This adapter has no development bypass. Provider calls stay disabled unless
// the reward feature, SMS spending, and the final terms were all approved.
const encoder = new TextEncoder();
const MAX_CHALLENGE_SECONDS = 600;

export class SmsError extends Error {
  constructor(message, status = 503, code = 'sms_unavailable') {
    super(message);
    this.name = 'SmsError';
    this.status = status;
    this.code = code;
  }
}

function validSecret(secret) { return typeof secret === 'string' && encoder.encode(secret).length >= 32; }

export function smsConfiguration(env) {
  if (env.REWARDS_ENABLED !== 'true') return { enabled: false, reason: 'rewards_disabled' };
  if (env.SMS_APPROVED !== 'true') return { enabled: false, reason: 'sms_not_approved' };
  if (env.TERMS_APPROVED !== 'true') return { enabled: false, reason: 'terms_not_approved' };
  if (env.SMS_PROVIDER !== 'twilio') return { enabled: false, reason: 'sms_not_configured' };
  if (typeof env.SMS_DAILY_LIMIT !== 'string' || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(env.SMS_DAILY_LIMIT)) {
    return { enabled: false, reason: 'sms_not_configured' };
  }
  if (!validSecret(env.REWARDS_HMAC_SECRET) ||
      (env.SMS_CHALLENGE_SECRET !== undefined && !validSecret(env.SMS_CHALLENGE_SECRET)) ||
      !/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID || '') ||
      !/^VA[0-9a-fA-F]{32}$/.test(env.TWILIO_VERIFY_SERVICE_SID || '') ||
      typeof env.TWILIO_AUTH_TOKEN !== 'string' || env.TWILIO_AUTH_TOKEN.length < 16) {
    return { enabled: false, reason: 'sms_not_configured' };
  }
  return { enabled: true, reason: null };
}

function enabled(env) {
  if (!smsConfiguration(env).enabled) throw new SmsError('SMS rewards are unavailable.');
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40) throw new SmsError('Enter a valid international phone number.', 400, 'invalid_phone');
  const phone = value.trim().replace(/[ ()-]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new SmsError('Enter a valid international phone number.', 400, 'invalid_phone');
  return phone;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  if (!validSecret(secret)) throw new SmsError('SMS privacy protection is unavailable.');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function privateHmac(env, purpose, value) {
  if (typeof purpose !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(purpose) || typeof value !== 'string') throw new TypeError('Invalid HMAC input');
  const key = await hmacKey(env.REWARDS_HMAC_SECRET);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}\0${value}`))));
}

function validatePayload(payload, now) {
  if (!payload || payload.v !== 1 || typeof payload.challengeId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(payload.challengeId) ||
      typeof payload.sessionId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(payload.sessionId) ||
      typeof payload.ownerHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.ownerHash) ||
      typeof payload.phoneHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.phoneHash) ||
      !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + MAX_CHALLENGE_SECONDS) {
    throw new SmsError('This verification challenge is invalid or expired.', 400, 'invalid_challenge');
  }
}

export async function signChallenge(env, payload) {
  const data = { v: 1, challengeId: payload.challengeId, ownerHash: payload.ownerHash, sessionId: payload.sessionId, phoneHash: payload.phoneHash, expiresAt: payload.expiresAt };
  validatePayload(data, Math.floor(Date.now() / 1000));
  const body = base64url(encoder.encode(JSON.stringify(data)));
  const key = await hmacKey(env.SMS_CHALLENGE_SECRET || env.REWARDS_HMAC_SECRET);
  return `${body}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body))))}`;
}

export async function verifyChallenge(env, token, expected = {}) {
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error();
    const pieces = token.split('.');
    if (pieces.length !== 2) throw new Error();
    const key = await hmacKey(env.SMS_CHALLENGE_SECRET || env.REWARDS_HMAC_SECRET);
    if (!await crypto.subtle.verify('HMAC', key, unbase64url(pieces[1]), encoder.encode(pieces[0]))) throw new Error();
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64url(pieces[0])));
    validatePayload(payload, Math.floor(Date.now() / 1000));
    for (const key of ['ownerHash', 'sessionId', 'phoneHash', 'challengeId']) {
      if (expected[key] !== undefined && payload[key] !== expected[key]) throw new Error();
    }
    return payload;
  } catch {
    throw new SmsError('This verification challenge is invalid or expired.', 400, 'invalid_challenge');
  }
}

async function providerCall(env, resource, params, fetchImpl) {
  enabled(env);
  let response;
  try {
    response = await fetchImpl(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${resource}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new SmsError('SMS verification is temporarily unavailable.');
  }
  if (!response.ok) throw new SmsError('SMS verification is temporarily unavailable.', response.status === 429 ? 429 : 503);
  let data;
  try {
    const text = await response.text();
    if (text.length > 32768) throw new Error();
    data = JSON.parse(text);
  } catch { throw new SmsError('SMS verification is temporarily unavailable.'); }
  if (!data || data.service_sid !== env.TWILIO_VERIFY_SERVICE_SID) throw new SmsError('SMS verification is temporarily unavailable.');
  return data;
}

export async function requestVerification(env, phone, { fetchImpl = fetch } = {}) {
  const normalized = normalizePhone(phone);
  const data = await providerCall(env, 'Verifications', { To: normalized, Channel: 'sms' }, fetchImpl);
  if (data.to !== normalized || data.status !== 'pending' || typeof data.sid !== 'string' || !/^VE[0-9a-fA-F]{32}$/.test(data.sid)) throw new SmsError('SMS verification is temporarily unavailable.');
  return { providerSid: data.sid, status: 'pending' };
}

export async function checkVerification(env, phone, code, { providerSid, fetchImpl = fetch } = {}) {
  if (typeof code !== 'string' || !/^[0-9]{4,10}$/.test(code)) throw new SmsError('Enter a valid verification code.', 400, 'invalid_code');
  const normalized = normalizePhone(phone);
  if (typeof providerSid !== 'string' || !/^VE[0-9a-fA-F]{32}$/.test(providerSid)) throw new SmsError('SMS verification is temporarily unavailable.');
  const data = await providerCall(env, 'VerificationCheck', { VerificationSid: providerSid, Code: code }, fetchImpl);
  if (data.to !== normalized || data.sid !== providerSid) throw new SmsError('SMS verification is temporarily unavailable.');
  if (data.status === 'approved' && data.valid === true) return true;
  if (data.status === 'pending' && data.valid === false) return false;
  throw new SmsError('SMS verification is temporarily unavailable.');
}
