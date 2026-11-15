'use strict';
// The exact published Worker runs in workerd with Miniflare's real D1 binding.
// Provider replies and fixture SQL exist only here, in a disposable local DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { migrateD1 } = require('./helpers/migrations.cjs');

const root = path.resolve(__dirname, '..');
const origin = 'https://rewards-workerd.example';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/game-session-winning-rewards.json'), 'utf8'));
const bindings = {
  APP_ORIGIN: origin,
  REWARDS_ENABLED: 'true', SMS_APPROVED: 'true', TERMS_APPROVED: 'true', MANUAL_REWARDS_ENABLED:'true',NOTIFICATION_SMS_ENABLED:'true',NOTIFICATION_SMS_DAILY_LIMIT:'10',TWILIO_MESSAGING_SERVICE_SID:'MG'+'4'.repeat(32),
  SMS_PROVIDER: 'twilio', SMS_DAILY_LIMIT: '100',
  REWARDS_HMAC_SECRET: 'local-integration-only-hmac-secret-with-32-bytes',
  TURNSTILE_SITE_KEY: 'local-integration-site-key', TURNSTILE_SECRET: 'local-integration-turnstile-secret',
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
  TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'local-integration-only-provider-token',
  ACCESS_TEAM_DOMAIN: 'workerd-integration.cloudflareaccess.com', ACCESS_AUD: 'local-integration-audience',
};
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'integration-key', alg: 'RS256', use: 'sig' };
const providerSid = `VE${'3'.repeat(32)}`;
const phone = '+15145551234';
const calls = { notification:0, turnstile: 0, keys: 0, sms: 0, check: 0 };
const redirects = { turnstile: false, keys: false, sms: false, check: false };
const unexpectedOutbound = [];
const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://must-not-follow.example/private' } });

function jwt(sub, email) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid: publicJwk.kid })}.${encode({
    iss: `https://${bindings.ACCESS_TEAM_DOMAIN}`, aud: [bindings.ACCESS_AUD], sub, email,
    exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
  })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url')}`;
}

async function outbound(request) {
  const url = new URL(request.url);
  if (url.origin === `https://${bindings.ACCESS_TEAM_DOMAIN}` && url.pathname === '/cdn-cgi/access/certs') {
    calls.keys++;
    if (redirects.keys) return redirect();
    return Response.json({ keys: [publicJwk] });
  }
  if (url.href === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
    calls.turnstile++;
    const params = new URLSearchParams(await request.text());
    assert.equal(params.get('secret'), bindings.TURNSTILE_SECRET);
    if (redirects.turnstile) return redirect();
    return Response.json({ success: true, hostname: new URL(origin).hostname, action: 'boreal-session', challenge_ts: new Date().toISOString() });
  }
  if(url.origin==='https://api.twilio.com'){calls.notification++;const params=new URLSearchParams(await request.text());assert.equal(params.get('To'),phone);assert.ok(params.get('Body').includes('Applicable exclusivement sur les aliments'));return Response.json({sid:'SM'+'5'.repeat(32),account_sid:bindings.TWILIO_ACCOUNT_SID,to:phone,status:'queued'});}
  const base = `https://verify.twilio.com/v2/Services/${bindings.TWILIO_VERIFY_SERVICE_SID}/`;
  if (url.href === base + 'Verifications') {
    calls.sms++;
    assert.equal(request.method, 'POST');
    const params = new URLSearchParams(await request.text());
    assert.equal(params.get('To'), phone);
    assert.equal(params.get('Channel'), 'sms');
    if (redirects.sms) return redirect();
    return Response.json({ service_sid: bindings.TWILIO_VERIFY_SERVICE_SID, sid: providerSid, status: 'pending', to: phone });
  }
  if (url.href === base + 'VerificationCheck') {
    calls.check++;
    const params = new URLSearchParams(await request.text());
    assert.equal(params.get('VerificationSid'), providerSid);
    if (redirects.check) return redirect();
    const valid = params.get('Code') === '123456';
    return Response.json({ service_sid: bindings.TWILIO_VERIFY_SERVICE_SID, sid: providerSid, status: valid ? 'approved' : 'pending', valid, to: phone });
  }
  unexpectedOutbound.push(`${url.origin}${url.pathname}`);
  throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
}

(async () => {
  const script = fs.readFileSync(path.join(root, 'v3/_worker.js'), 'utf8');
  assert.ok(!/\bnode:|__unenv__|getBuiltinModule/.test(script));
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [{ type: 'ESModule', path: '_worker.js', contents: script }],
    compatibilityDate: '2026-11-14', compatibilityFlags: ['no_nodejs_compat', 'no_nodejs_compat_v2'],
    cf: false, bindings, d1Databases: ['DB'], d1Persist: false,
    outboundService: outbound,
    serviceBindings: { ASSETS: async () => new Response('local-static-asset') },
  }));
  const request = (pathname, body, headers = {}) => mf.dispatchFetch(origin + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async response => {
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  try {
    const DB = await mf.getD1Database('DB');
    await migrateD1(DB);
    await DB.batch([
      DB.prepare("INSERT INTO employees(sub,email,name,role) VALUES('manager','manager@example.com','Responsable Essai','manager')"),
      DB.prepare("INSERT INTO employees(sub,email,name,role) VALUES('staff','staff@example.com','Employé Essai','staff')"),
    ]);
    const employees = [
      { sub: 'manager', headers: { 'Cf-Access-Jwt-Assertion': jwt('manager', 'manager@example.com') } },
      { sub: 'staff', headers: { 'Cf-Access-Jwt-Assertion': jwt('staff', 'staff@example.com') } },
    ];
    assert.equal((await request('/api/admin/setup', undefined, { 'Cf-Access-Authenticated-User-Email': 'manager@example.com' })).status, 401);
    redirects.keys = true;
    assert.equal((await request('/api/admin/setup', undefined, employees[0].headers)).status, 503);
    assert.deepEqual(unexpectedOutbound, []);
    redirects.keys = false;
    const staffSetup = await request('/api/admin/setup', undefined, employees[1].headers);
    assert.equal(staffSetup.status, 403, await staffSetup.text());
    const setup = await json(await request('/api/admin/setup', undefined, employees[0].headers));
    assert.equal(setup.database.connected, true);
    assert.equal(setup.database.schemaReady, true);
    assert.equal(setup.rewardsConfigured, true);
    assert.equal(setup.providerVerification, 'not_performed');
    assert.equal(calls.sms, 0);
    assert.equal(calls.check, 0);
    console.log('PASS: published Worker authenticates a manager and inspects its real local D1 schema');

    redirects.turnstile = true;
    assert.equal((await request('/api/games/start', {
      width: fixture.width, height: fixture.height, expectedMode: 'rewards', turnstileToken: 'local-test-token',
    })).status, 503);
    assert.equal((await DB.prepare('SELECT COUNT(*) count FROM sessions').first()).count, 0);
    assert.deepEqual(unexpectedOutbound, []);
    redirects.turnstile = false;
    const owners = Array.from({ length: 16 }, () => randomBytes(32).toString('base64url'));
    const starts = await Promise.all(owners.map(async owner => ({
      headers: { Cookie: `__Host-rewards-owner=${owner}` },
      session: await json(await request('/api/games/start', {
        width: fixture.width, height: fixture.height, expectedMode: 'rewards', turnstileToken: 'local-test-token',
      }, { Cookie: `__Host-rewards-owner=${owner}` })),
    })));
    const winning = starts.filter(value => value.session.mode === 'rewards');
    assert.equal(winning.length, 5);
    assert.equal(starts.filter(value => value.session.mode === 'extreme').length, 11);
    const reservedBudget = await DB.prepare('SELECT used_cents,reserved_cents FROM budgets').first();
    assert.deepEqual(reservedBudget, { used_cents: 0, reserved_cents: 10000 });
    const saturated = await json(await request('/api/rewards/status'));
    assert.equal(saturated.mode, 'extreme');
    for (const field of ['usedCents', 'remainingCents', 'reservedCents', 'budgetCents']) assert.equal(Object.hasOwn(saturated, field), false);
    console.log('PASS: 16 concurrent Worker starts reserve exactly five rewards and never exceed 100 CAD in D1');

    const run = winning[0];
    assert.equal(run.session.engineVersion, fixture.engineVersion);
    // Only this disposable test database ages the row and installs a recorded
    // seed. The unmodified Worker still replays every tick and validates SMS.
    await DB.prepare('UPDATE sessions SET seed=?,created_at=? WHERE id=?')
      .bind(fixture.seed, Date.now() - Math.ceil(fixture.ticks / 120 * 1000) - 2000, run.session.sessionId).run();
    const finished = await json(await request('/api/games/finish', {
      sessionId: run.session.sessionId, ticks: fixture.ticks, jumps: fixture.jumps, resizes: fixture.resizes, score: 999999999,
    }, run.headers));
    assert.equal(finished.score, 10526);
    assert.equal(finished.eligible, true);
    const profile = {
      sessionId: run.session.sessionId, phone, firstName: 'Camille', lastName: 'Intégration', consentVersion: run.session.policyVersion,
    };
    redirects.sms = true;
    assert.equal((await request('/api/rewards/sms/request', profile, run.headers)).status, 503);
    assert.deepEqual(unexpectedOutbound, []);
    redirects.sms = false;
    // Advance only the fixture’s send gate instead of waiting a real minute.
    await DB.prepare('UPDATE sessions SET verification_next_send_at=0 WHERE id=?').bind(run.session.sessionId).run();
    const challenge = await json(await request('/api/rewards/sms/request', profile, run.headers));
    const verify = code => request('/api/rewards/sms/verify', { challengeId: challenge.challengeId, phone, code }, run.headers);
    redirects.check = true;
    assert.equal((await verify('123456')).status, 503);
    assert.deepEqual(unexpectedOutbound, []);
    redirects.check = false;
    assert.equal((await verify('000000')).status, 400);
    assert.equal((await DB.prepare('SELECT COUNT(*) count FROM rewards').first()).count, 0);
    const awarded = await json(await verify('123456'));
    assert.equal(awarded.awarded, true);
    assert.equal(awarded.reward.valueCents, 2000);
    assert.equal(awarded.reward.discountApplied, false);
    assert.match(awarded.reward.code, /^GOAT-[0-9A-F]{32}$/);
    assert.equal((await json(await verify('123456'))).reward.code, awarded.reward.code);
    assert.equal(calls.sms, 2);
    assert.equal(calls.check, 3);
    assert.equal((await DB.prepare('SELECT COUNT(*) count FROM rewards').first()).count, 1);
    assert.deepEqual(await DB.prepare('SELECT used_cents,reserved_cents FROM budgets').first(), { used_cents: 2000, reserved_cents: 8000 });
    console.log('PASS: real replay, SMS approval and retry issue one unique reward through Worker-bound D1 triggers');
    console.log('PASS: JWKS, Turnstile, SMS send and SMS check reject redirects without following them');

    const before = await json(await request('/api/admin/budget', undefined, employees[0].headers));
    assert.equal(before.budgetCents, 10000);
    assert.equal(before.usedCents, 2000);
    assert.equal(before.remainingCents, 0);
    assert.equal(before.pendingCount, 1);
    assert.equal(before.usedCount, 0);
    const listed = await json(await request('/api/admin/rewards', undefined, employees[0].headers));
    assert.equal(listed.rewards[0].code, awarded.reward.code);
    assert.equal(listed.rewards[0].discountApplied, false);
    const endpoint = `/api/admin/rewards/${awarded.reward.id}`;
    assert.equal((await request(endpoint + '/use', { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, employees[0].headers)).status, 409);
    const claims = await Promise.all(employees.map(employee => request(endpoint + '/claim', {}, employee.headers)));
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409]);
    const winner = claims.findIndex(response => response.status === 200);
    const claim = await claims[winner].json();
    assert.equal(claim.reward.claimedBy, employees[winner].sub);
    assert.equal(claim.reward.discountApplied, false);
    assert.equal((await request(endpoint + '/issue', { lightspeedRef: 'OLD-CLIENT-LOCAL-ONLY' }, employees[winner].headers)).status, 410);
    for (const body of [{}, { discountApplied: false }, { discountApplied: 'true' }, { discountApplied: 1 }, { discountApplied: null }]) {
      assert.equal((await request(endpoint + '/use', body, employees[winner].headers)).status, 400);
    }
    assert.equal((await request(endpoint + '/use', { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, employees[1-winner].headers)).status, 409);
    assert.deepEqual(await DB.prepare('SELECT status,discount_applied FROM rewards WHERE id=?').bind(awarded.reward.id).first(), { status: 'claimed', discount_applied: 0 });
    assert.equal((await DB.prepare("SELECT COUNT(*) count FROM audit WHERE reward_id=? AND action='issued'").bind(awarded.reward.id).first()).count, 0);
    const applied = await json(await request(endpoint + '/use', { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, employees[winner].headers));
    assert.equal(applied.reward.status, 'issued');
    assert.equal(applied.reward.discountApplied, true);
    assert.equal(applied.reward.issuedBy, employees[winner].sub);
    assert.equal(applied.reward.lightspeedRef, null);
    const repeated = await json(await request(endpoint + '/use', { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, employees[winner].headers));
    assert.equal(repeated.reward.issuedAt, applied.reward.issuedAt);
    assert.equal(repeated.reward.discountApplied, true);
    assert.equal((await request(endpoint + '/use', { discountApplied: true, foodOnlyConfirmed:true, eligibleFoodCents:2000 }, employees[1-winner].headers)).status, 409);
    const counts = await DB.prepare("SELECT action,COUNT(*) count FROM audit WHERE reward_id=? AND action IN ('claimed','confirmed','issued') GROUP BY action ORDER BY action").bind(awarded.reward.id).all();
    assert.deepEqual(counts.results, [{ action: 'claimed', count: 1 }, { action: 'confirmed', count: 1 }, { action: 'issued', count: 1 }]);
    const usage = await DB.prepare("SELECT details FROM audit WHERE reward_id=? AND action='issued'").bind(awarded.reward.id).first();
    assert.deepEqual(JSON.parse(usage.details), { valueCents: 2000, previewTestConsumed:false,discountApplied: true, foodOnlyConfirmed:true,eligibleFoodCents:2000,appliedValueCents:2000,unusedCents:0,reason: null });
    const stored = await DB.prepare('SELECT discount_applied,lightspeed_ref,issued_by,issued_at,claimed_by,claimed_at FROM rewards WHERE id=?').bind(awarded.reward.id).first();
    assert.equal(stored.discount_applied, 1);
    assert.equal(stored.lightspeed_ref, null);
    assert.equal(stored.issued_by, stored.claimed_by);
    assert.equal(stored.claimed_at, Date.parse(claim.reward.claimedAt));
    const after = await json(await request('/api/admin/budget', undefined, employees[0].headers));
    assert.equal(after.usedCents, before.usedCents);
    assert.equal(after.reservedCents, before.reservedCents);
    assert.equal(after.pendingCount, 0);
    assert.equal(after.usedCount, 1);
    const receipt = await json(await request('/api/rewards/confirmation', undefined, run.headers));
    assert.equal(receipt.reward.code, awarded.reward.code);
    assert.equal(receipt.reward.status, 'issued');
    assert.equal(receipt.reward.discountApplied, true);
    for (const field of ['claimedBy', 'claimedByName', 'issuedBy', 'issuedByName', 'lightspeedRef', 'cancelReason']) assert.equal(Object.hasOwn(receipt.reward, field), false);
    console.log('PASS: real D1 discount lookup, exclusive claim, confirmed manual use, budget and audit agree');
    // Actual compiled Worker: manager-only manual creation, both justified
    // exceptions, identical parallel retries, notification and partial food use.
    const params={phone,valueCents:500};
    assert.equal((await request('/api/admin/manual-rewards/quote',params,employees[1].headers)).status,403);
    const quote=await json(await request('/api/admin/manual-rewards/quote',params,employees[0].headers));
    assert.equal(quote.projectedOverrunCents,500);assert.equal(quote.cooldownRequired,true);
    const manualBody={...params,firstName:'Camille',lastName:'Manuel',reason:'Geste commercial exceptionnel',requestId:'manual-workerd-integration-1',quote:quote.quote,authorizeBudgetOverrun:true,budgetReason:'Dépassement volontaire approuvé',authorizeCooldown:true,cooldownReason:'Exception des 30 jours approuvée'};
    const emissions=await Promise.all(Array.from({length:8},()=>request('/api/admin/manual-rewards',manualBody,employees[0].headers)));
    for(const response of emissions)assert.equal(response.status,200);
    const emitted=await Promise.all(emissions.map(r=>r.json()));assert.equal(new Set(emitted.map(r=>r.reward.code)).size,1);
    const manual=emitted[0].reward;assert.equal(manual.source,'manual');assert.equal(manual.score,null);
    const over=await json(await request('/api/admin/budget',undefined,employees[0].headers));assert.equal(over.budgetCents,10000);assert.equal(over.usedCents,2500);assert.equal(over.reservedCents,8000);assert.equal(over.overrunCents,500);assert.equal(over.remainingCents,0);
    const initial=await DB.prepare("SELECT COUNT(*) n FROM notification_sms WHERE reward_id=? AND kind='initial'").bind(manual.id).first();assert.equal(initial.n,1);
    await DB.prepare('UPDATE notification_sms SET created_at=created_at-61000 WHERE reward_id=?').bind(manual.id).run();
    const resend=await json(await request(`/api/admin/rewards/${manual.id}/notify`,{phone,requestId:'workerd-manual-resend-1'},employees[0].headers));assert.equal(resend.notification.status,'accepted');
    await json(await request(`/api/admin/rewards/${manual.id}/claim`,{},employees[0].headers));
    const partial=await json(await request(`/api/admin/rewards/${manual.id}/use`,{discountApplied:true,foodOnlyConfirmed:true,eligibleFoodCents:300},employees[0].headers));assert.equal(partial.reward.appliedValueCents,300);assert.equal(partial.reward.unusedCents,200);
    assert.equal(calls.notification,3);
    console.log('PASS: compiled Worker manual manager exceptions, one concurrent code, notification SMS and partial food-only consumption');
    assert.deepEqual(unexpectedOutbound, []);
  } finally {
    await mf.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
