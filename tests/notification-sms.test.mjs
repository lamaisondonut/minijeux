import assert from 'node:assert/strict';
import test from 'node:test';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { migrateSqlite } from './helpers/migrations.cjs';
import { quoteManual,createManual } from '../server/manual-rewards.mjs';
import { rewardMessage,sendRewardSms } from '../server/notification-sms.mjs';
import { secureId } from '../server/common.mjs';
const now=Date.parse('2026-11-15T17:00:00Z'),phone='+15145551234';
async function fixture(t) {
  const f=openReviewDatabase(':memory:');migrateSqlite(f.sqlite);t.after(()=>f.sqlite.close());
  f.sqlite.prepare("INSERT INTO employees VALUES('manager','m@example.com','Manon','manager',1)").run();
  const env={DB:f.DB,PHONE_VERIFICATION_MODE:'sms',MANUAL_REWARDS_ENABLED:'true',NOTIFICATION_SMS_ENABLED:'true',TERMS_APPROVED:'true',SMS_APPROVED:'true',NOTIFICATION_SMS_DAILY_LIMIT:'10',REWARDS_HMAC_SECRET:'x'.repeat(40),TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'x'.repeat(32),TWILIO_MESSAGING_SERVICE_SID:'MG'+'2'.repeat(32)},employee={sub:'manager',role:'manager'};
  const quote=await quoteManual(env,employee,{phone,valueCents:2000},now);
  const r=await createManual(env,employee,{phone,valueCents:2000,firstName:'Camille',lastName:'Essai',reason:'Geste commercial',requestId:secureId(),quote:quote.quote,authorizeBudgetOverrun:false,authorizeCooldown:false},now);
  const reward=f.sqlite.prepare('SELECT * FROM rewards WHERE id=?').get(r.reward.id);
  let calls=0,bodies=[];const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
  globalThis.fetch=async (url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.match(String(url),/^https:\/\/api.twilio.com\/2010-04-01\/Accounts\/AC[1-9]+\/Messages.json$/);bodies.push(new URLSearchParams(options.body));return Response.json({sid:'SM'+'3'.repeat(32),account_sid:env.TWILIO_ACCOUNT_SID,to:phone,status:'queued'});};
  return {...f,env,reward,calls:()=>calls,bodies,args:{reward,phone,actor:'manager',requestId:secureId(),kind:'initial'}};
}
test('game and manual templates include exact award/code and visible food-only, alcohol exclusion and forfeiture',()=>{
  for(const source of ['game','manual']){const text=rewardMessage({source,score:10526,value_cents:1000,code:'GOAT-TEST'});assert.ok(text.includes('Votre code : GOAT-TEST'));assert.ok(text.includes('Valide 30 jours, une seule utilisation. Applicable exclusivement sur les aliments au restaurant.'));assert.ok(text.includes('Aucun rabais direct ou indirect sur les boissons alcooliques'));assert.ok(text.includes('reliquat perdu'));if(source==='game')assert.ok(text.includes('10526 points'));else assert.ok(!text.includes('points'));}
});
test('one initial send, durable replay, no plaintext phone/body or OTP in D1, and explicit resend throttled',async t=>{
  const f=await fixture(t);const first=await sendRewardSms(f.env,f.args,now);assert.equal(first.status,'accepted');assert.deepEqual(await sendRewardSms(f.env,f.args,now+1),first);assert.equal(f.calls(),1);
  assert.equal(f.bodies[0].get('To'),phone);assert.equal(f.bodies[0].get('MessagingServiceSid'),f.env.TWILIO_MESSAGING_SERVICE_SID);assert.ok(f.bodies[0].get('Body').includes(f.reward.code));
  const rows=f.sqlite.prepare('SELECT * FROM notification_sms').all();assert.ok(!JSON.stringify(rows).includes(phone));assert.ok(!JSON.stringify(rows).includes(f.reward.code));
  await assert.rejects(sendRewardSms(f.env,{...f.args,requestId:secureId(),kind:'resend'},now+1000),e=>e.status===429);
  const resent=await sendRewardSms(f.env,{...f.args,requestId:secureId(),kind:'resend'},now+61000);assert.equal(resent.status,'accepted');assert.equal(f.calls(),2);assert.equal(f.sqlite.prepare('SELECT count FROM notification_sms_daily').get().count,2);
});
test('disabled configuration and different phone never trigger provider calls',async t=>{
  const f=await fixture(t);assert.equal((await sendRewardSms({...f.env,NOTIFICATION_SMS_ENABLED:'false'},f.args,now)).status,'disabled');
  await assert.rejects(sendRewardSms(f.env,{...f.args,phone:'+15145551235'},now),e=>e.status===403);assert.equal(f.calls(),0);
});
test('ambiguous provider timeout is recorded once and never automatically replayed',async t=>{
  const f=await fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;throw Error('timeout after acceptance');};const first=await sendRewardSms(f.env,f.args,now);assert.equal(first.status,'uncertain');assert.equal((await sendRewardSms(f.env,f.args,now+61000)).status,'uncertain');assert.equal(calls,1);assert.equal(f.sqlite.prepare('SELECT count FROM notification_sms_daily').get().count,1);
});
test('provider redirects are rejected without forwarding secrets and exhausted quota prevents calls',async t=>{
  const f=await fixture(t);globalThis.fetch=async()=>new Response('',{status:302,headers:{Location:'https://untrusted.example'}});assert.equal((await sendRewardSms(f.env,f.args,now)).status,'uncertain');f.sqlite.prepare('UPDATE notification_sms_daily SET count=10').run();await assert.rejects(sendRewardSms(f.env,{...f.args,kind:'resend',requestId:secureId()},now+61000),e=>e.status===429);
});
