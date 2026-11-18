import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainThread,parentPort,Worker,workerData } from 'node:worker_threads';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { migrateSqlite } from './helpers/migrations.cjs';
import { quoteManual,createManual } from '../server/manual-rewards.mjs';
import { startSession } from '../server/store.mjs';
import { handleRequest } from '../server/api.mjs';
import { secureId,monthWindow } from '../server/common.mjs';

const NOW=Date.parse('2026-11-15T17:00:00Z'),MANAGER={sub:'manager',name:'Manon',email:'manager@example.com',role:'manager'};
const envBase={MANUAL_REWARDS_ENABLED:'true',TERMS_APPROVED:'true',REWARDS_HMAC_SECRET:'manual-test-secret-'.repeat(3),APP_ORIGIN:'https://manual.example',ACCESS_TEAM_DOMAIN:'manual.cloudflareaccess.com',ACCESS_AUD:'manual-audience'};
const phone='+15145551234';
if(!isMainThread) {
  const f=openReviewDatabase(workerData.file);parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);
  try {parentPort.postMessage({ok:true,result:await createManual({...envBase,DB:f.DB},MANAGER,workerData.body,NOW)});}
  catch(error){parentPort.postMessage({ok:false,status:error.status,code:error.code,message:error.message});}finally{f.sqlite.close();}
} else {
  function fixture(t) {
    const dir=mkdtempSync(join(tmpdir(),'boreal-manual-')),file=join(dir,'test.db'),f=openReviewDatabase(file);f.sqlite.exec('PRAGMA journal_mode=WAL');migrateSqlite(f.sqlite);f.sqlite.prepare('INSERT INTO employees(sub,email,name,role) VALUES(?,?,?,?)').run(MANAGER.sub,MANAGER.email,MANAGER.name,MANAGER.role);
    t.after(()=>{f.sqlite.close();rmSync(dir,{recursive:true,force:true});});return {...f,file,env:{...envBase,DB:f.DB}};
  }
  async function body(f,overrides={}) {
    const p={phone,valueCents:2000,...overrides},quote=await quoteManual(f.env,MANAGER,p,NOW);
    return {phone:p.phone,valueCents:p.valueCents,firstName:'Camille',lastName:'Essai',reason:'Geste commercial motivé',requestId:secureId(),quote:quote.quote,authorizeBudgetOverrun:false,authorizeCooldown:false,...overrides};
  }
  async function race(file,inputs) {
    const barrier=new SharedArrayBuffer(4),workers=[];let ready=0;
    try{return await Promise.all(inputs.map(body=>new Promise((resolve,reject)=>{
      const worker=new Worker(new URL(import.meta.url),{workerData:{file,barrier,body}});workers.push(worker);let answer;
      worker.on('message',m=>{if(m.ready){if(++ready===inputs.length){Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,inputs.length);}}else answer=m;});worker.once('error',reject);worker.once('exit',code=>code===0&&answer?resolve(answer):reject(Error('worker failed')));
    })));}finally{await Promise.allSettled(workers.map(w=>w.terminate()));}
  }
  test('manual code has a server-generated 128-bit code, true source, no fake game or score, 30-day expiry and private audit',async t=>{
    const f=fixture(t),b=await body(f),result=await createManual(f.env,MANAGER,b,NOW),r=result.reward;
    assert.match(r.code,/^GOAT-[A-F0-9]{32}$/);assert.equal(r.source,'manual');assert.equal(r.score,null);assert.equal(r.status,'pending');assert.equal(Date.parse(r.claimBy)-Date.parse(r.confirmedAt),2592000000);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
    const stored=f.sqlite.prepare('SELECT * FROM rewards').get();assert.equal(stored.session_id,null);assert.ok(!JSON.stringify(stored).includes(phone));
    const a=f.sqlite.prepare("SELECT * FROM audit WHERE action='manual_confirmed'").get();assert.equal(a.actor_sub,MANAGER.sub);assert.equal(a.actor_name,MANAGER.name);assert.equal(JSON.parse(a.details).valueCents,2000);
    assert.equal((await createManual(f.env,MANAGER,b,NOW+10)).reward.code,r.code);
    await assert.rejects(createManual(f.env,MANAGER,{...b,reason:'Autre justification'},NOW),e=>e.status===409);
  });
  test('manual issuance stays disabled without explicit configuration and rejects staff/inactive manager',async t=>{
    const f=fixture(t),b=await body(f);
    for(const changes of [{MANUAL_REWARDS_ENABLED:'false'},{TERMS_APPROVED:'false'}])await assert.rejects(createManual({...f.env,...changes},MANAGER,b,NOW),e=>e.status===503);
    await assert.rejects(createManual(f.env,{...MANAGER,role:'staff'},b,NOW),e=>e.status===403);
    f.sqlite.prepare("UPDATE employees SET active=0 WHERE sub='manager'").run();await assert.rejects(createManual(f.env,MANAGER,b,NOW),e=>e.status===403);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);
  });
  test('intentional excess needs explicit confirmation/reason, stays in spending and never increases game ceiling',async t=>{
    const f=fixture(t);f.sqlite.prepare("UPDATE reward_budget_settings SET default_monthly_limit_cents=0").run();const b=await body(f);
    assert.equal((await quoteManual(f.env,MANAGER,b,NOW)).projectedOverrunCents,2000);
    await assert.rejects(createManual(f.env,MANAGER,b,NOW),e=>e.code==='budget_override_required');
    await assert.rejects(createManual(f.env,MANAGER,{...b,authorizeBudgetOverrun:true,budgetReason:''},NOW),e=>e.status===400);
    await createManual(f.env,MANAGER,{...b,authorizeBudgetOverrun:true,budgetReason:'Exception commerciale approuvée'},NOW);
    assert.deepEqual({...f.sqlite.prepare('SELECT used_cents,reserved_cents,limit_cents,exceptional_cents FROM budgets').get()},{used_cents:2000,reserved_cents:0,limit_cents:0,exceptional_cents:2000});
    const run=await startSession(f.DB,{id:secureId(),ownerHash:'test',seed:1,width:360,height:640,engineVersion:'test',month:monthWindow(NOW).month,now:NOW,expiresAt:NOW+600000,allowRewards:true,quotaDay:'2026-11-15',quotaLimit:20});assert.equal(run.mode,'extreme');
    // Even deliberately added historical slack never opens the game budget.
    f.sqlite.prepare('UPDATE budgets SET exceptional_cents=4000').run();assert.throws(()=>f.sqlite.prepare("INSERT INTO sessions(id,owner_hash,seed,width,height,mode,engine_version,month,cap_cents,created_at,expires_at,reservation_active,sms_day,sms_reserved) VALUES('bypass','owner',1,360,640,'rewards','test','2026-11',500,1,2,1,'2026-11-15',1)").run(),/normal_budget_exhausted/);
  });
  test('30-day exception is separate and justified; ordinary duplicate phone remains blocked',async t=>{
    const f=fixture(t);await createManual(f.env,MANAGER,await body(f),NOW);const b=await body(f);assert.ok(b.quote.lastRewardId);
    await assert.rejects(createManual(f.env,MANAGER,b,NOW),e=>e.code==='cooldown_override_required');
    await createManual(f.env,MANAGER,{...b,authorizeCooldown:true,cooldownReason:'Décision exceptionnelle du gestionnaire'},NOW+1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,2);const a=f.sqlite.prepare("SELECT details FROM audit WHERE action='manual_confirmed' ORDER BY id DESC LIMIT 1").get();assert.equal(JSON.parse(a.details).cooldownOverride,true);
  });
  test('16 independent manager retries allocate one code and one expenditure; competing quotes allow one emission',async t=>{
    const f=fixture(t),b=await body(f),results=await race(f.file,Array(16).fill(b));assert.ok(results.every(r=>r.ok));assert.equal(new Set(results.map(r=>r.result.reward.code)).size,1);assert.equal(f.sqlite.prepare('SELECT used_cents FROM budgets').get().used_cents,2000);
    const other=await body(f,{phone:'+15145551235'}),compete=await race(f.file,Array.from({length:12},()=>({...other,requestId:secureId()})));assert.equal(compete.filter(r=>r.ok).length,1);assert.ok(compete.filter(r=>!r.ok).every(r=>r.status===409));assert.equal(f.sqlite.prepare('SELECT used_cents FROM budgets').get().used_cents,4000);
  });
  test('stale budget quote and role revocation inside transaction cannot issue',async t=>{
    const f=fixture(t),b=await body(f);f.sqlite.prepare("INSERT INTO budgets(month,limit_cents,revision) VALUES('2026-11',5000,1)").run();await assert.rejects(createManual(f.env,MANAGER,b,NOW),e=>e.code==='quote_stale');
    const fresh=await body(f),raceEnv={...f.env,DB:{prepare:q=>f.DB.prepare(q),batch:async statements=>{f.sqlite.prepare("UPDATE employees SET active=0").run();return f.DB.batch(statements);}}};await assert.rejects(createManual(raceEnv,MANAGER,fresh,NOW),e=>e.status===409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);
  });
  test('food-only redemption computes partial value, forfeits remainder and is immutable and single-use',async t=>{
    const f=fixture(t),r=(await createManual(f.env,MANAGER,await body(f),NOW)).reward;
    f.sqlite.prepare("UPDATE rewards SET status='claimed',claimed_by='manager',claimed_by_name='Manon',claimed_at=?,last_actor_sub='manager',last_actor_name='Manon' WHERE id=?").run(NOW,r.id);
    const sql="UPDATE rewards SET status='issued',discount_applied=1,food_only_confirmed=?,eligible_food_cents=?,applied_value_cents=?,issued_by='manager',issued_by_name='Manon',issued_at=?,last_actor_sub='manager',last_actor_name='Manon' WHERE id=?";
    assert.throws(()=>f.sqlite.prepare(sql).run(0,300,300,NOW,r.id),/food_confirmation_required/);assert.throws(()=>f.sqlite.prepare(sql).run(1,300,2000,NOW,r.id),/food_confirmation_required/);assert.throws(()=>f.sqlite.prepare(sql).run(1,0,0,NOW,r.id));
    f.sqlite.prepare(sql).run(1,300,300,NOW,r.id);assert.equal(f.sqlite.prepare('SELECT used_cents FROM budgets').get().used_cents,2000);
    const details=JSON.parse(f.sqlite.prepare("SELECT details FROM audit WHERE action='issued'").get().details);assert.equal(details.appliedValueCents,300);assert.equal(details.unusedCents,1700);assert.equal(details.foodOnlyConfirmed,true);assert.throws(()=>f.sqlite.prepare(sql).run(1,2000,2000,NOW,r.id),/invalid_transition/);
  });
  test('manual endpoint refuses unsigned/forged identity and origin before any allocation',async t=>{
    const f=fixture(t),b=await body(f);
    for(const headers of [{Origin:envBase.APP_ORIGIN},{Origin:envBase.APP_ORIGIN,'Cf-Access-Authenticated-User-Email':MANAGER.email},{Origin:'https://attacker.example'}]){
      const response=await handleRequest(new Request(envBase.APP_ORIGIN+'/api/admin/manual-rewards',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)}),f.env);assert.ok([401,403].includes(response.status));
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);
  });
}
