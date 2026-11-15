import { ApiError, monthWindow, rewardView, secureId, string } from './common.mjs';
import { customerColumns,adminCustomerView } from './customer.mjs';
import { normalizePhone, privateHmac } from './sms.mjs';
import { cleanup, stmt } from './store.mjs';
import { getBudget } from './budget.mjs';

const DAYS30 = 2592000000;
const values = [500, 1000, 2000];
const fields = new Set(['requestId','firstName','lastName','phone','valueCents','reason','quote','authorizeBudgetOverrun','budgetReason','authorizeCooldown','cooldownReason']);
const reason = value => {
  const result = string(value, 'justification', 500);
  if (result.length < 8) throw new ApiError(400, 'reason_required', 'La justification doit contenir au moins 8 caractères.');
  return result;
};
export const manualEnabled = env => env.MANUAL_REWARDS_ENABLED === 'true' && env.TERMS_APPROVED === 'true';

async function manager(db, employee) {
  if (employee?.role !== 'manager') throw new ApiError(403, 'manager_required');
  const row = await stmt(db,"SELECT sub,name FROM employees WHERE sub=? AND active=1 AND role='manager'",employee.sub).first();
  if (!row) throw new ApiError(403, 'manager_required');
  return row;
}
async function lastReward(db, hash, now) {
  return stmt(db,'SELECT id,confirmed_at FROM rewards WHERE phone_hash=? AND confirmed_at>? ORDER BY confirmed_at DESC,id DESC LIMIT 1',hash,now-DAYS30).first();
}
function summary(budget, valueCents, last) {
  const before = Math.max(0,budget.usedCents+budget.reservedCents-budget.budgetCents);
  const after = Math.max(0,budget.usedCents+budget.reservedCents+valueCents-budget.budgetCents);
  return { budgetCents:budget.budgetCents, usedCents:budget.usedCents,reservedCents:budget.reservedCents,
    valueCents, projectedOverrunCents:after, additionalExceptionalCents:after-before,
    cooldownRequired:Boolean(last), cooldownUntil:last ? new Date(last.confirmed_at+DAYS30).toISOString():null,
    quote:{month:budget.month,budgetCents:budget.budgetCents,usedCents:budget.usedCents,reservedCents:budget.reservedCents,revision:budget.revision,lastRewardId:last?.id ?? null} };
}
export async function quoteManual(env,employee,body,now=Date.now()) {
  await manager(env.DB,employee);
  if (!values.includes(body.valueCents)) throw new ApiError(400,'invalid_value');
  const phoneHash=await privateHmac(env,'phone',normalizePhone(body.phone));
  await cleanup(env.DB,now);
  const budget=await getBudget(env.DB,{month:monthWindow(now).month,now});
  return {...summary(budget,body.valueCents,await lastReward(env.DB,phoneHash,now)),manualRewardsEnabled:manualEnabled(env)};
}
async function fingerprint(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createManual(env,employee,body,now=Date.now()) {
  const actor=await manager(env.DB,employee);
  if (!manualEnabled(env)) throw new ApiError(503,'manual_rewards_disabled','Les émissions manuelles restent désactivées avant validation.');
  if (!body || Object.keys(body).some(key=>!fields.has(key)) || !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId??'') || !values.includes(body.valueCents) || typeof body.authorizeBudgetOverrun!=='boolean' || typeof body.authorizeCooldown!=='boolean') throw new ApiError(400,'invalid_manual_reward');
  const phone=normalizePhone(body.phone), phoneHash=await privateHmac(env,'phone',phone);
  const firstName=string(body.firstName,'firstName',80),lastName=string(body.lastName,'lastName',80),manualReason=reason(body.reason);
  const budgetReason=body.authorizeBudgetOverrun ? reason(body.budgetReason) : null;
  const cooldownReason=body.authorizeCooldown ? reason(body.cooldownReason) : null;
  const q=body.quote;
  if (!q || !['budgetCents','usedCents','reservedCents','revision'].every(k=>Number.isSafeInteger(q[k])&&q[k]>=0) || typeof q.month!=='string' || !(q.lastRewardId===null || typeof q.lastRewardId==='string')) throw new ApiError(400,'invalid_quote');
  const canonical={firstName,lastName,phoneHash,valueCents:body.valueCents,reason:manualReason,quote:{month:q.month,budgetCents:q.budgetCents,usedCents:q.usedCents,reservedCents:q.reservedCents,revision:q.revision,lastRewardId:q.lastRewardId},authorizeBudgetOverrun:body.authorizeBudgetOverrun,budgetReason,authorizeCooldown:body.authorizeCooldown,cooldownReason};
  const hash=await fingerprint(canonical);
  const prior=async()=> {
    const row=await stmt(env.DB,"SELECT * FROM rewards WHERE source='manual' AND manual_request_id=?",body.requestId).first();
    if (!row) return null;
    // Initial issuer is retained in the immutable allocation audit, whereas
    // last_actor_sub changes during redemption.
    const audit=await stmt(env.DB,"SELECT actor_sub FROM audit WHERE reward_id=? AND action='manual_confirmed' ORDER BY id LIMIT 1",row.id).first();
    if (row.manual_fingerprint!==hash || audit?.actor_sub!==actor.sub) throw new ApiError(409,'manual_request_conflict');
    return row;
  };
  const existing=await prior();
  if(existing) return {reward:await adminCustomerView(env,existing,now),repeated:true};
  if(q.month!==monthWindow(now).month) throw new ApiError(409,'quote_stale','Le mois a changé. Recalculez la proposition.');
  const overrun=Math.max(0,q.usedCents+q.reservedCents+body.valueCents-q.budgetCents);
  const exceptional=overrun-Math.max(0,q.usedCents+q.reservedCents-q.budgetCents);
  if(overrun>0 && !body.authorizeBudgetOverrun) throw new ApiError(400,'budget_override_required','Confirmez explicitement le dépassement et sa justification.');
  if(overrun===0 && body.authorizeBudgetOverrun) throw new ApiError(400,'unnecessary_budget_override');
  if(q.lastRewardId && !body.authorizeCooldown) throw new ApiError(400,'cooldown_override_required');
  if(!q.lastRewardId && body.authorizeCooldown) throw new ApiError(400,'unnecessary_cooldown_override');
  const id=secureId(),code='GOAT-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const customer=await customerColumns(env,{phone,firstName,lastName,rewardId:id});
  let result;
  try {
    result=await env.DB.batch([
      stmt(env.DB,'INSERT INTO budgets(month,limit_cents) SELECT ?,default_monthly_limit_cents FROM reward_budget_settings WHERE id=1 ON CONFLICT(month) DO NOTHING',q.month),
      stmt(env.DB,`INSERT INTO rewards(id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,last_actor_sub,last_actor_name,source,manual_reason,manual_request_id,manual_fingerprint,budget_override,budget_override_reason,exceptional_cents,cooldown_override,cooldown_override_reason,phone_ciphertext,phone_last4,name_search,phone_verified)
        SELECT ?,NULL,?,?,?,b.month,?,?,NULL,?,?,e.sub,e.name,'manual',?,?,?,?,?,?,?,?,?,?,?,0
        FROM budgets b JOIN employees e ON e.sub=? WHERE e.active=1 AND e.role='manager' AND b.month=? AND b.limit_cents=? AND b.used_cents=? AND b.reserved_cents=? AND b.revision=?
        AND COALESCE((SELECT id FROM rewards WHERE phone_hash=? AND confirmed_at>? ORDER BY confirmed_at DESC,id DESC LIMIT 1),'')=? RETURNING *`,
        id,phoneHash,code,body.valueCents,firstName,lastName,now,now+DAYS30,manualReason,body.requestId,hash,body.authorizeBudgetOverrun?1:0,budgetReason,exceptional,body.authorizeCooldown?1:0,cooldownReason,customer.phoneCiphertext,customer.phoneLast4,customer.nameSearch,actor.sub,q.month,q.budgetCents,q.usedCents,q.reservedCents,q.revision,phoneHash,now-DAYS30,q.lastRewardId??'')
    ]);
  } catch(error) {const completed=await prior();if(completed)return{reward:await adminCustomerView(env,completed,now),repeated:true};throw error;}
  const row=result[1].results?.[0];
  if(!row){const completed=await prior();if(completed)return{reward:await adminCustomerView(env,completed,now),repeated:true};}
  if(!row) throw new ApiError(409,'quote_stale','Le budget ou les gains de ce client ont changé. Recalculez puis confirmez la nouvelle proposition.');
  return {reward:await adminCustomerView(env,row,now),repeated:false};
}
