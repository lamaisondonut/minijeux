import test from 'node:test';
import assert from 'node:assert/strict';
import {
  smsConfiguration, normalizePhone, privateHmac, signChallenge, verifyChallenge,
  requestVerification, checkVerification,
} from '../server/sms.mjs';

const configured = {
  REWARDS_ENABLED: 'true', SMS_APPROVED: 'true', TERMS_APPROVED: 'true', SMS_PROVIDER: 'twilio',
  SMS_DAILY_LIMIT: '10',
  REWARDS_HMAC_SECRET: 'test-private-hmac-secret-with-32-bytes-minimum',
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test-provider-token-that-is-long-enough',
  TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`,
};

test('every SMS approval, provider, and proper secret is required before any provider call', async () => {
  assert.deepEqual(smsConfiguration(configured), { enabled: true, reason: null });
  let calls = 0;
  for (const flag of ['REWARDS_ENABLED', 'SMS_APPROVED', 'TERMS_APPROVED', 'SMS_PROVIDER', 'SMS_DAILY_LIMIT', 'REWARDS_HMAC_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID']) {
    const env = { ...configured, [flag]: '' };
    assert.equal(smsConfiguration(env).enabled, false, flag);
    await assert.rejects(requestVerification(env, '+15145551234', { fetchImpl: async () => { calls++; } }), { code: 'sms_unavailable' });
  }
  assert.equal(calls, 0);
  assert.equal(smsConfiguration({ ...configured, SMS_APPROVED: true }).enabled, false);
  for (const quota of ['0', '101', '-1', '1.5', '01', ' 10', 10]) assert.equal(smsConfiguration({ ...configured, SMS_DAILY_LIMIT: quota }).enabled, false);
  for (const quota of ['1', '100']) assert.equal(smsConfiguration({ ...configured, SMS_DAILY_LIMIT: quota }).enabled, true);
});

test('phones normalize only explicit international numbers and HMACs separate identifiers', async () => {
  assert.equal(normalizePhone(' +1 (514) 555-1234 '), '+15145551234');
  for (const value of ['5145551234', '+01', '+1.514.555.1234', '+1\n5145551234', null]) assert.throws(() => normalizePhone(value));
  const phone = await privateHmac(configured, 'phone', '+15145551234');
  assert.match(phone, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(phone, await privateHmac(configured, 'owner', '+15145551234'));
  assert.notEqual(phone, await privateHmac({ ...configured, REWARDS_HMAC_SECRET: `${configured.REWARDS_HMAC_SECRET}-other` }, 'phone', '+15145551234'));
});

test('SMS challenges are signed, expire, and bind owner, session, phone, and challenge', async () => {
  const payload = {
    challengeId: 'c'.repeat(32), sessionId: 's'.repeat(32),
    ownerHash: await privateHmac(configured, 'owner', 'owner'),
    phoneHash: await privateHmac(configured, 'phone', '+15145551234'),
    expiresAt: Math.floor(Date.now() / 1000) + 120,
  };
  const signed = await signChallenge(configured, payload);
  assert.equal((await verifyChallenge(configured, signed, payload)).sessionId, payload.sessionId);
  for (const key of ['challengeId', 'ownerHash', 'sessionId', 'phoneHash']) {
    await assert.rejects(verifyChallenge(configured, signed, { [key]: 'different' }), { code: 'invalid_challenge' });
  }
  const [body, signature] = signed.split('.');
  await assert.rejects(verifyChallenge(configured, `${body}A.${signature}`), { code: 'invalid_challenge' });
  await assert.rejects(verifyChallenge(configured, `${body}.${signature.slice(0, -2)}AA`), { code: 'invalid_challenge' });
  await assert.rejects(signChallenge(configured, { ...payload, expiresAt: Math.floor(Date.now() / 1000) - 1 }), { code: 'invalid_challenge' });
  await assert.rejects(signChallenge(configured, { ...payload, expiresAt: Math.floor(Date.now() / 1000) + 601 }), { code: 'invalid_challenge' });
  assert.equal(Buffer.from(body, 'base64url').toString().includes('+1514'), false);
});

test('Twilio request uses the fixed Verify URL, SMS channel, normalized phone, and provider auth', async () => {
  let captured;
  const result = await requestVerification(configured, '+1 (514) 555-1234', { fetchImpl: async (url, options) => {
    captured = { url, options };
    return Response.json({ sid: `VE${'3'.repeat(32)}`, to: '+15145551234', service_sid: configured.TWILIO_VERIFY_SERVICE_SID, status: 'pending' });
  } });
  assert.equal(result.providerSid, `VE${'3'.repeat(32)}`);
  assert.equal(captured.url, `https://verify.twilio.com/v2/Services/${configured.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.method, 'POST');
  assert.equal(new URLSearchParams(captured.options.body).get('To'), '+15145551234');
  assert.equal(new URLSearchParams(captured.options.body).get('Channel'), 'sms');
  assert.match(captured.options.headers.authorization, /^Basic /);
});

test('Twilio verification approves only a positive provider result and fails closed otherwise', async () => {
  const providerSid = `VE${'3'.repeat(32)}`;
  const response = (status, valid, extra = {}) => async () => Response.json({ sid: providerSid, to: '+15145551234', service_sid: configured.TWILIO_VERIFY_SERVICE_SID, status, valid, ...extra });
  assert.equal(await checkVerification(configured, '+15145551234', '123456', { providerSid, fetchImpl: response('approved', true) }), true);
  assert.equal(await checkVerification(configured, '+15145551234', '123456', { providerSid, fetchImpl: response('pending', false) }), false);
  for (const fake of [response('approved', false), response('unknown', true), response('approved', true, { service_sid: 'wrong' }), response('approved', true, { sid: `VE${'4'.repeat(32)}` }), response('approved', true, { to: '+15145551235' }), async () => { throw new Error('offline'); }, async () => new Response('failure', { status: 500 })]) {
    await assert.rejects(checkVerification(configured, '+15145551234', '123456', { providerSid, fetchImpl: fake }), { code: 'sms_unavailable' });
  }
  let calls = 0;
  await assert.rejects(checkVerification(configured, '+15145551234', 'bad', { fetchImpl: async () => { calls++; } }), { code: 'invalid_code' });
  await assert.rejects(checkVerification(configured, '+15145551234', '123456', { fetchImpl: async () => { calls++; } }), { code: 'sms_unavailable' });
  assert.equal(calls, 0);
  await checkVerification(configured, '+15145551234', '123456', { providerSid, fetchImpl: async (_url, options) => {
    const form = new URLSearchParams(options.body);
    assert.equal(form.get('VerificationSid'), providerSid);
    assert.equal(form.has('To'), false);
    return Response.json({ sid: providerSid, to: '+15145551234', service_sid: configured.TWILIO_VERIFY_SERVICE_SID, status: 'approved', valid: true });
  } });
});

test('Twilio send fails closed if the provider binds the message to a different phone', async () => {
  await assert.rejects(requestVerification(configured, '+15145551234', { fetchImpl: async () => Response.json({
    sid: `VE${'3'.repeat(32)}`, to: '+15145551235', service_sid: configured.TWILIO_VERIFY_SERVICE_SID, status: 'pending',
  }) }), { code: 'sms_unavailable' });
});
