'use strict';
// Actual workerd, D1 migration parser, compiled Pages worker and asset router.
// No credentials, paid provider or production resource is used by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const temp = fs.mkdtempSync(path.join(root,'work/pages-smoke-'));
const cli = path.join(root,'node_modules/wrangler/bin/wrangler.js');
const origin = 'http://127.0.0.1:8792';
const env = {...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(temp,'wrangler.log')};
const config = {
  name:'boreal-local-test',pages_build_output_dir:path.join(root,'v3'),compatibility_date:'2026-11-14',
  d1_databases:[{binding:'DB',database_name:'boreal-local-test',database_id:'00000000-0000-4000-8000-000000000001',migrations_dir:path.join(root,'migrations')}],
  vars:{REWARDS_ENABLED:'false',SMS_APPROVED:'false',TERMS_APPROVED:'false',APP_ORIGIN:origin},
};
fs.writeFileSync(path.join(temp,'wrangler.jsonc'),JSON.stringify(config));
const persisted = path.join(temp,'state');
const migrated = spawnSync(process.execPath,[cli,'d1','migrations','apply','DB','--local','--persist-to',persisted,'--config',path.join(temp,'wrangler.jsonc')],{cwd:root,env,encoding:'utf8'});
assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
let output='', browser;
const worker = spawn(process.execPath,[cli,'pages','dev',path.join(root,'v3'),'--d1','DB=00000000-0000-4000-8000-000000000001','--binding','REWARDS_ENABLED=false','--binding','SMS_APPROVED=false','--binding','TERMS_APPROVED=false','--binding',`APP_ORIGIN=${origin}`,'--persist-to',persisted,'--port','8792','--ip','127.0.0.1','--inspector-port','0'],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
worker.stdout.on('data',chunk=>{output+=chunk});worker.stderr.on('data',chunk=>{output+=chunk});
(async()=>{
 try {
  for(let i=0;i<120;i++){
   if(worker.exitCode!==null)throw new Error(output);
   try{if((await fetch(origin+'/api/rewards/status')).ok)break}catch{}
   if(i===119)throw new Error('Pages runtime did not start: '+output);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  let response=await fetch(origin+'/api/rewards/status');
  assert.match(response.headers.get('cache-control'),/no-store/);
  const status=await response.json();assert.equal(status.mode,'pending');assert.equal(status.rewardsEnabled,false);
  assert.ok(!/budget|remainingCents|usedCents|phone|employee/i.test(JSON.stringify(status)));
  for(const pathname of ['/admin','/admin/','/admin/index.html','/admin%2Findex.html','/api/admin/me','/api/admin/rewards','/api/admin/export']){
   response=await fetch(origin+pathname,{redirect:'manual',headers:{'Cf-Access-Authenticated-User-Email':'forged@example.test'}});
   assert.ok([401,403,503].includes(response.status),`${pathname}: ${response.status}`);
   assert.match(response.headers.get('cache-control'),/no-store/);
   assert.ok(!(await response.text()).includes('<html'),`${pathname}: no protected HTML leaked`);
  }
  response=await fetch(origin+'/api/games/start',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({width:390,height:844,expectedMode:'rewards'})});
  assert.equal(response.status,503);
  response=await fetch(origin+'/api/rewards/sms/request',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(response.status,503);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.BorealRewards&&document.querySelector('#game').dataset.ready==='true');
  assert.equal(await page.locator('#home').getAttribute('data-game-mode'),'pending');
  assert.equal(await page.locator('.boreal-brand-logo').evaluate(img=>img.naturalWidth),320);
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#home').classList.contains('off'));
  assert.match(await page.locator('#rewardStartNote').innerText(),/aucune récompense monétaire/);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Pages worker + D1 migration, private routes fail closed, pending status, browser practice play');
 } finally {
  await browser?.close();worker.kill('SIGTERM');
  await new Promise(resolve=>{if(worker.exitCode!==null)resolve();else{worker.once('exit',resolve);setTimeout(()=>{worker.kill('SIGKILL');resolve()},2000).unref()}});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
