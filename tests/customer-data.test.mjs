import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptCustomerPhone,decryptCustomerPhone,normalizeNameSearch,adminCustomerView } from '../server/customer.mjs';
import { publicRewardView,secureId } from '../server/common.mjs';
import { openReviewDatabase } from './helpers/review-d1.mjs';
import { migrateSqlite,migrationFiles,migrationSql,splitMigration } from './helpers/migrations.cjs';
const env={REWARDS_HMAC_SECRET:'customer-confidentiality-fixture-secret-'.repeat(2)};
test('phone encryption uses a fresh nonce, authenticated reward ID and server key',async()=>{
 const id=secureId(),other=secureId(),a=await encryptCustomerPhone(env,'+1 (514) 555-1234',id),b=await encryptCustomerPhone(env,'+15145551234',id);
 assert.notEqual(a,b);assert.ok(!a.includes('15145551234'));assert.equal(await decryptCustomerPhone(env,a,id),'+15145551234');
 await assert.rejects(decryptCustomerPhone(env,a,other),e=>e.status===503);await assert.rejects(decryptCustomerPhone({...env,REWARDS_HMAC_SECRET:'different-key-'.repeat(5)},a,id),e=>e.status===503);
 await assert.rejects(decryptCustomerPhone(env,a.slice(0,-5)+'AAAAA',id),e=>e.status===503);assert.equal(await decryptCustomerPhone(env,null,id),null);
});
test('phone is exposed only by the private staff projection and name search supports French accents',async()=>{
 const id=secureId(),row={id,source:'game',phone_verified:0,code:'GOAT-PRIVATE',phone_ciphertext:await encryptCustomerPhone(env,'+15145551234',id),phone_last4:'1234',first_name:'Émilie',last_name:'NOËL',status:'pending',confirmed_at:Date.now(),claim_by:Date.now()+100000};
 const privateData=await adminCustomerView(env,row),publicData=publicRewardView(row);assert.equal(privateData.phone,'+15145551234');assert.equal(privateData.phoneVerified,false);assert.ok(!JSON.stringify(publicData).includes('15145551234'));
 for(const key of ['phone','phoneCiphertext','phone_ciphertext','phone_last4','device_hash'])assert.equal(Object.hasOwn(publicData,key),false);
 assert.equal(normalizeNameSearch('  ÉMILIE   Noël  '),'emilie noel');
});
test('device migration preserves old awards, balances and audit, and rolls back every statement on error',async()=>{
 const f=openReviewDatabase(':memory:');
 try{
  migrateSqlite(f.sqlite,{before:'0009'});const now=Date.now(),sid=secureId(),id=secureId();f.sqlite.prepare("INSERT INTO budgets(month) VALUES('2026-11')").run();f.sqlite.prepare("INSERT INTO sms_daily(day) VALUES('2026-11-15')").run();
  f.sqlite.prepare("INSERT INTO sessions(id,owner_hash,seed,width,height,mode,engine_version,month,cap_cents,created_at,expires_at,state,reservation_active,score,claim_deadline,bound_phone_hash,first_name,last_name,sms_day,sms_reserved) VALUES(?,'legacy-browser',1,390,844,'rewards','test','2026-11',2000,?,?,'eligible',1,10000,?,'legacy-phone','Camille','Noël','2026-11-15',1)").run(sid,now-1000,now+100000,now+100000);
  f.sqlite.prepare("INSERT INTO rewards(id,session_id,phone_hash,code,value_cents,month,first_name,last_name,score,confirmed_at,claim_by,last_actor_sub,last_actor_name) VALUES(?,?,'legacy-phone','LEGACY-UNIQUE',2000,'2026-11','Camille','Noël',10000,?,?,'owner','Player')").run(id,sid,now,now+2592000000);
  const before={reward:f.sqlite.prepare('SELECT * FROM rewards').get(),budget:f.sqlite.prepare('SELECT * FROM budgets').get(),audit:f.sqlite.prepare('SELECT * FROM audit').all()};
  const sql=migrationSql[migrationFiles.findIndex(n=>n.startsWith('0009'))],statements=splitMigration(sql).map(q=>f.DB.prepare(q));
  await assert.rejects(f.DB.batch([...statements,f.DB.prepare('SELECT * FROM deliberately_missing_device_test_table')]));assert.ok(!f.sqlite.prepare('PRAGMA table_info(rewards)').all().some(c=>c.name==='device_hash'));assert.deepEqual(f.sqlite.prepare('SELECT * FROM audit').all(),before.audit);
  await f.DB.batch(splitMigration(sql).map(q=>f.DB.prepare(q)));const reward=f.sqlite.prepare('SELECT * FROM rewards').get();assert.equal(reward.device_hash,'legacy-browser');for(const [key,value]of Object.entries(before.reward))assert.deepEqual(reward[key],value);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM budgets').get(),before.budget);assert.deepEqual(f.sqlite.prepare('SELECT * FROM audit').all(),before.audit);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.sqlite.close();}
});
