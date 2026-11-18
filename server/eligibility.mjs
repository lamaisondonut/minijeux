import { ApiError,iso,secureId,string } from './common.mjs';
import { stmt } from './store.mjs';

const WINDOW=2592000000;
async function restriction(db,scope,hash,now) {
  if(!hash)return {blocked:false,nextEligibleAt:null,latest:null,exception:null};
  const column=scope==='phone'?'phone_hash':'device_hash';
  const latest=await stmt(db,`SELECT id,confirmed_at,first_name,last_name FROM rewards WHERE ${column}=? AND confirmed_at>? ORDER BY confirmed_at DESC,id DESC LIMIT 1`,hash,now-WINDOW).first();
  if(!latest)return {blocked:false,nextEligibleAt:null,latest:null,exception:null};
  const exception=await stmt(db,'SELECT id,expires_at FROM reward_exceptions WHERE scope=? AND subject_hash=? AND blocked_reward_id=? AND used_reward_id IS NULL AND approved_at<=? AND expires_at>? ORDER BY approved_at DESC,id DESC LIMIT 1',scope,hash,latest.id,now,now).first();
  return {blocked:!exception,nextEligibleAt:iso(latest.confirmed_at+WINDOW),latest,exception};
}
export async function getRestrictions(db,{phoneHash=null,deviceHash=null,now=Date.now()}) {
  const [phone,device]=await Promise.all([restriction(db,'phone',phoneHash,now),restriction(db,'device',deviceHash,now)]);
  const dates=[phone,device].filter(r=>r.blocked).map(r=>r.nextEligibleAt).sort();
  return {blocked:phone.blocked||device.blocked,reason:device.blocked?'device_cooldown':phone.blocked?'phone_cooldown':null,nextEligibleAt:dates.at(-1)??null,phone,device};
}
export const publicRestriction = result=>({reason:result.reason,nextEligibleAt:result.nextEligibleAt});

export async function recordDuplicate(db,{restriction,ownerHash,firstName,lastName,now}) {
  const block=restriction.device.blocked?restriction.device:restriction.phone;
  if(!block.latest)return;
  const normalize=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
  const differentName=normalize([firstName,lastName].join(' '))!==normalize([block.latest.first_name,block.latest.last_name].join(' '));
  await stmt(db,"INSERT INTO audit(reward_id,action,actor_sub,actor_name,created_at,details) VALUES(?,'duplicate_detected',?,'Joueur',?,?)",block.latest.id,ownerHash,now,JSON.stringify({reason:restriction.reason,differentName,nextEligibleAt:restriction.nextEligibleAt})).run();
}

export async function adminEligibility(db,reward,now=Date.now()) {
  const limits=await getRestrictions(db,{phoneHash:reward.phone_hash,deviceHash:reward.device_hash,now});
  const history=await stmt(db,`SELECT id,code,first_name,last_name,value_cents,confirmed_at,status,phone_hash=? AS same_phone,CASE WHEN ? IS NOT NULL AND device_hash=? THEN 1 ELSE 0 END AS same_device FROM rewards WHERE phone_hash=? OR (? IS NOT NULL AND device_hash=?) ORDER BY confirmed_at DESC,id DESC LIMIT 50`,reward.phone_hash,reward.device_hash,reward.device_hash,reward.phone_hash,reward.device_hash,reward.device_hash).all();
  const signals=(await stmt(db,"SELECT created_at,details FROM audit WHERE action='duplicate_detected' AND reward_id IN(SELECT id FROM rewards WHERE phone_hash=? OR (? IS NOT NULL AND device_hash=?)) ORDER BY id DESC LIMIT 20",reward.phone_hash,reward.device_hash,reward.device_hash).all()).results.map(r=>({createdAt:iso(r.created_at),...JSON.parse(r.details)}));
  const summarize=r=>({blocked:r.blocked,nextEligibleAt:r.nextEligibleAt,latestRewardId:r.latest?.id??null,exceptionAvailable:Boolean(r.exception),exceptionExpiresAt:r.exception?iso(r.exception.expires_at):null});
  return {phone:summarize(limits.phone),device:{...summarize(limits.device),tracked:Boolean(reward.device_hash)},nextEligibleAt:limits.nextEligibleAt,
    potentialDuplicate:history.results.length>1||signals.length>0,signals,history:history.results.map(r=>({id:r.id,code:r.code,fullName:[r.first_name,r.last_name].join(' '),valueCents:r.value_cents,confirmedAt:iso(r.confirmed_at),status:r.status,samePhone:r.same_phone===1,sameDevice:r.same_device===1}))};
}

export async function grantException(db,employee,reward,body,now=Date.now()) {
  if(employee.role!=='manager')throw new ApiError(403,'manager_required');
  const reason=string(body.reason,'reason',500),scope=body.scope;
  if(reason.length<8||!['phone','device','both'].includes(scope)||!/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId||''))throw new ApiError(400,'exception_reason_required','Choisissez la portée et une justification d’au moins 8 caractères.');
  if(scope!=='phone'&&!reward.device_hash)throw new ApiError(400,'device_not_tracked');
  const scopes=scope==='both'?['phone','device']:[scope];
  const fingerprint=JSON.stringify({rewardId:reward.id,scope,reason});
  const previous=async()=>{
    const rows=(await stmt(db,'SELECT * FROM reward_exceptions WHERE request_id=? ORDER BY scope',body.requestId).all()).results;
    if(!rows.length)return null;
    if(rows.length!==scopes.length||rows.some(r=>r.approved_by!==employee.sub||r.fingerprint!==fingerprint))throw new ApiError(409,'exception_request_conflict');
    return rows.map(r=>({id:r.id,scope:r.scope,expiresAt:iso(r.expires_at),used:Boolean(r.used_reward_id)}));
  };
  const prior=await previous();if(prior)return{exceptions:prior,repeated:true};
  const condition=scopes.map(s=>`(SELECT id FROM rewards WHERE ${s==='phone'?'phone_hash':'device_hash'}=? AND confirmed_at>? ORDER BY confirmed_at DESC,id DESC LIMIT 1)=?`).join(' AND ');
  const conditionArgs=scopes.flatMap(s=>[s==='phone'?reward.phone_hash:reward.device_hash,now-WINDOW,reward.id]);
  try {
    await db.batch(scopes.map(s=>stmt(db,`INSERT INTO reward_exceptions(id,scope,subject_hash,blocked_reward_id,request_id,fingerprint,approved_by,approved_by_name,approved_at,expires_at,reason)
      SELECT ?,?,?,?,?,?,e.sub,e.name,?,?,? FROM employees e WHERE e.sub=? AND e.active=1 AND e.role='manager' AND ${condition}`,secureId(),s,s==='phone'?reward.phone_hash:reward.device_hash,reward.id,body.requestId,fingerprint,now,now+86400000,reason,employee.sub,...conditionArgs)));
  }catch(error){const committed=await previous();if(committed)return{exceptions:committed,repeated:true};throw error;}
  const result=await previous();if(!result)throw new ApiError(409,'exception_stale','La période est terminée ou un gain plus récent existe. Actualisez puis sélectionnez le dernier gain.');
  return {exceptions:result,repeated:false};
}
