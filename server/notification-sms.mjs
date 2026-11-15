import { ApiError, secureId, torontoDay } from './common.mjs';
import { normalizePhone, privateHmac } from './sms.mjs';
import { stmt } from './store.mjs';

export function notificationConfigured(env) {
  return env.NOTIFICATION_SMS_ENABLED==='true' && env.SMS_APPROVED==='true' && env.TERMS_APPROVED==='true' &&
    /^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID||'') && typeof env.TWILIO_AUTH_TOKEN==='string' && env.TWILIO_AUTH_TOKEN.length>=10 &&
    /^MG[0-9a-fA-F]{32}$/.test(env.TWILIO_MESSAGING_SERVICE_SID||'') && Number.isInteger(Number(env.NOTIFICATION_SMS_DAILY_LIMIT)) && Number(env.NOTIFICATION_SMS_DAILY_LIMIT)>=1 && Number(env.NOTIFICATION_SMS_DAILY_LIMIT)<=100;
}
export function rewardMessage(reward) {
  const amount=(reward.value_cents/100).toString();
  const intro=reward.source==='manual' ? `Les Boréalistes 🌲 Nous avons le plaisir de vous offrir un rabais de ${amount} $ !` : `Les Boréalistes 🌲 Félicitations ! Vous avez atteint ${reward.score} points au Défi Boréal et remporté un rabais de ${amount} $ !`;
  return `${intro}\n\nVotre code : ${reward.code}\n\nValide 30 jours, une seule utilisation. Applicable exclusivement sur les aliments au restaurant.${reward.source==='manual'?'':' Présentez ce code lors de votre visite.'}\nAucun rabais direct ou indirect sur les boissons alcooliques. Facture mixte : aliments seulement. Facture uniquement alcoolisée non admissible. Montant limité aux aliments admissibles ; reliquat perdu, sans échange contre de l’argent.`;
}
const view=row=>({id:row.id,status:row.state,createdAt:new Date(row.created_at).toISOString()});

export async function sendRewardSms(env,{reward,phone,actor,requestId,kind='resend'},now=Date.now()) {
  if (!notificationConfigured(env)) return {status:'disabled'};
  const normalized=normalizePhone(phone),phoneHash=await privateHmac(env,'phone',normalized);
  if (phoneHash!==reward.phone_hash) throw new ApiError(403,'notification_phone_mismatch','Le numéro doit correspondre au bénéficiaire du bon.');
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(requestId||'') || !['initial','resend'].includes(kind)) throw new ApiError(400,'invalid_sms_request');
  if(reward.status!=='pending' || reward.claim_by<=now) throw new ApiError(409,'reward_not_available');
  const find=async()=> {
    const row=await stmt(env.DB,`SELECT * FROM notification_sms WHERE request_id=? ${kind==='initial'?"OR (reward_id=? AND kind='initial')":''} ORDER BY created_at LIMIT 1`,requestId,...kind==='initial'?[reward.id]:[]).first();
    if(row && (row.reward_id!==reward.id || row.phone_hash!==phoneHash || row.actor_sub!==actor || row.kind!==kind)) throw new ApiError(409,'notification_request_conflict');
    return row;
  };
  const prior=await find();if(prior)return view(prior);
  const id=secureId(),day=torontoDay(now);
  let result;
  try {
    result=await env.DB.batch([
      stmt(env.DB,'INSERT INTO notification_sms_daily(day,count) VALUES(?,0) ON CONFLICT(day) DO NOTHING',day),
      stmt(env.DB,`INSERT INTO notification_sms(id,reward_id,request_id,actor_sub,phone_hash,kind,state,created_at)
       SELECT ?,?,?,?,?,?,'sending',? WHERE (SELECT count FROM notification_sms_daily WHERE day=?)<?
       AND EXISTS(SELECT 1 FROM rewards WHERE id=? AND status='pending' AND claim_by>?)
       AND NOT EXISTS(SELECT 1 FROM notification_sms WHERE reward_id=? AND created_at>?)
       AND (SELECT COUNT(*) FROM notification_sms WHERE phone_hash=? AND created_at>?)<5 RETURNING *`,
       id,reward.id,requestId,actor,phoneHash,kind,now,day,Number(env.NOTIFICATION_SMS_DAILY_LIMIT),reward.id,now,reward.id,now-60000,phoneHash,now-86400000),
      stmt(env.DB,'UPDATE notification_sms_daily SET count=count+1 WHERE day=? AND changes()=1',day),
      stmt(env.DB,"INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) SELECT ?,'reward_sms_requested',?,?,?,json_object('notificationId',?,'kind',?) WHERE EXISTS(SELECT 1 FROM notification_sms WHERE id=?)",reward.id,actor,'Demande SMS',now,id,kind,id)
    ]);
  } catch(error) {const complete=await find();if(complete)return view(complete);throw error;}
  if(!result[1].results?.length) throw new ApiError(429,'notification_rate_limited','Attendez au moins une minute. Le nombre de SMS est limité.');
  let state='uncertain',providerSid=null,errorCode='provider_uncertain';
  try {
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
      headers:{Authorization:`Basic ${btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN)}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({To:normalized,MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID,Body:rewardMessage(reward)}).toString()
    });
    if(response.ok) {
      const text=await response.text();if(text.length>32768)throw Error('response_too_large');
      const data=JSON.parse(text);
      if(!/^SM[0-9a-fA-F]{32}$/.test(data.sid||'') || data.account_sid!==env.TWILIO_ACCOUNT_SID || data.to!==normalized)throw Error('invalid_response');
      state='accepted';providerSid=data.sid;errorCode=null;
    } else if(response.status>=400 && response.status<500) {state='failed';errorCode='provider_rejected';}
  } catch { /* A timed-out POST may already have been accepted: never replay it. */ }
  await env.DB.batch([
    stmt(env.DB,'UPDATE notification_sms SET state=?,provider_sid=?,sent_at=?,error_code=? WHERE id=? AND state=\'sending\'',state,providerSid,state==='accepted'?Date.now():null,errorCode,id),
    stmt(env.DB,"INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(?,'reward_sms_result',?,'Service SMS',?,json_object('notificationId',?,'status',?))",reward.id,actor,Date.now(),id,state)
  ]);
  return {id,status:state,createdAt:new Date(now).toISOString()};
}
