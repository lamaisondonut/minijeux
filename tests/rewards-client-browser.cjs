'use strict';
// All network substitutions and engine visibility below exist only in this test.
// The delivered module and shared engine execute without modification.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:8779';
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/game-session-winning-rewards.json')));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log('PASS', message); };
const hash = data => createHash('sha256').update(data).digest('hex');
const baseline = fs.readFileSync(path.join(root, 'tests/noel-browser.cjs'), 'utf8').match(/const originalFiles=\{([\s\S]*?)\n\};/);
assert.ok(baseline);
for (const [,file,pinned] of baseline[1].matchAll(/'([^']+)':'([a-f0-9]{64})'/g)) check(hash(fs.readFileSync(path.join(root,file))) === pinned, `${file}: pinned original artwork and mechanics preserved`);
const holidayFiles = {
 'v3/jacques-noel.js':'d52dd3eafd0dc444caa87810b979760a2c33c8cec087c232f8f8959ff32b3f19',
 'v3/noel-sleigh.js':'d18a5a36002ee6f38b715f83039ded9185ac268ef7004dfbc460de4dc2a31a97',
 'v3/noel-scenery.js':'c205677faeaee30e158fd4605296f0d9ca32469fd3bf63cc79e604ac796a8f1f',
 'v3/assets/noel/forest-landscape-noel.png':'02ea0222a9fc7a43754040e8c62cd14e93c8c6fb4c149eea9f93d929286b1cd6',
 'v3/assets/noel/forest-panorama-noel.png':'2d5d2630bc217436c0797c6873444700ad5ca0a4f98588d8501802d14c929d4a',
 'v3/assets/noel/jacques-noel-atlas.json':'e7f985b9e9b519aa550f42b6401320d8b53430f8cd0b1df1bd66c2195543acee',
 'v3/assets/noel/jacques-noel-atlas.png':'053e177bf5e3d39c924d260ad4fc8dd9f752271ae83b41ee02f984ba000a5ca7',
 'v3/assets/noel/santa-sleigh-six-reindeer.png':'0477ddcd3c22d0cdadec91ca928f641ff179275d13402b129a4fb126f7ebd6c0'
};
for (const [file,pinned] of Object.entries(holidayFiles)) check(hash(fs.readFileSync(path.join(root,file))) === pinned, `${file}: baseline Christmas art preserved`);
const hook = `
window.rewardsTest={
 frame:advanceFrame,jump,draw,pause,resize,
 state:()=>({mode,score,speed,ground,width:W,height:H,player:{...player},shared:sharedSession?{ticks:sharedSession.state.ticks,mode:sharedSession.state.mode,score:sharedSession.state.score,ended:sharedSession.state.ended,width:sharedSession.state.width,height:sharedSession.state.height}:null}),
 playTo(target,jumps){const inputs=new Set(jumps);while(sharedSession&&!sharedSession.state.ended&&sharedSession.state.ticks<target){if(inputs.has(sharedSession.state.ticks))jump();advanceFrame(1/120)}return this.state()}
};
`;
let html = fs.readFileSync(path.join(root,'v3/index.html'),'utf8');
const marker = html.lastIndexOf('\n})();'); assert.ok(marker > 0);
html = html.slice(0,marker) + '\n' + hook + html.slice(marker);
const status = (overrides={}) => ({ mode:'rewards',rewardsEnabled:true,capCents:1000,policyVersion:'test-policy',turnstileSiteKey:'test-sitekey',tiers:[{score:5000,valueCents:500,available:true},{score:7500,valueCents:1000,available:true},{score:10000,valueCents:2000,available:false}],...overrides });
async function open(browser, options={}) {
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[], requests=[], external=[];
 await context.addInitScript(() => {
  window.requestAnimationFrame=()=>0;
  window.__turnstileCalls=[];
  let callbacks;
  window.turnstile={render(target,settings){callbacks=settings;window.__turnstileCalls.push({target,sitekey:settings.sitekey,action:settings.action});return 'widget-test'},execute(){queueMicrotask(()=>callbacks.callback('test-turnstile-token'))},remove(){}};
  window.__heroDraws=[];window.__heroBounds=[];
  const opaqueBounds=new WeakMap();
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){
   const source=args[0];
   if(this.canvas.id==='game'&&/jacques-noel/.test(source.dataset?.sourceAsset||source.src||'')){
    window.__heroDraws.push([source.dataset?.frame,...args.slice(1,5)]);
    let bounds=opaqueBounds.get(source);
    if(!bounds){const width=source.width,height=source.height,data=source.getContext('2d').getImageData(0,0,width,height).data;let left=width,top=height,right=0,bottom=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>30){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}bounds={left,top,right,bottom};opaqueBounds.set(source,bounds)}
    let sx=0,sy=0,sw=source.width,sh=source.height,dx,dy,dw,dh;
    if(args.length===9)[,sx,sy,sw,sh,dx,dy,dw,dh]=args;else if(args.length===5)[,dx,dy,dw,dh]=args;else[,dx,dy]=args,dw=sw,dh=sh;
    const matrix=this.getTransform(),box=this.canvas.getBoundingClientRect(),ratio=this.canvas.width/box.width;
    const points=[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.left,bounds.bottom],[bounds.right,bounds.bottom]].map(([x,y])=>new DOMPoint(dx+(x-sx)/sw*dw,dy+(y-sy)/sh*dh).matrixTransform(matrix));
    window.__heroBounds.push({left:Math.min(...points.map(p=>p.x))/ratio+box.left,top:Math.min(...points.map(p=>p.y))/ratio+box.top,right:Math.max(...points.map(p=>p.x))/ratio+box.left,bottom:Math.max(...points.map(p=>p.y))/ratio+box.top});
   }
   return draw.apply(this,args)
  };
 });
 const page = await context.newPage();
 const waitForFunction=page.waitForFunction.bind(page);
 page.waitForFunction=(fn,arg,settings={})=>waitForFunction(fn,arg,{polling:20,...settings});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('data:'))external.push(r.url())});
 let releaseModule;const moduleGate=new Promise(resolve=>{releaseModule=resolve});
 if(options.delayModule||options.abortModule)await page.route('**/v3/rewards-client.js',async route=>{if(options.abortModule)return route.abort();await moduleGate;await route.continue()});
 await page.route('**/v3/__rewards_test__.html',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  let body=null;try{body=request.postDataJSON()}catch{}
  requests.push({pathname,method:request.method(),body});
  let response;
  if(pathname==='/api/rewards/status')response={body:options.status||status()};
  else if(options.handle)response=await options.handle(pathname,body,requests);
  if(!response)throw new Error(`Unexpected test API request ${pathname}`);
  await route.fulfill({status:response.status||200,contentType:'application/json',body:JSON.stringify(response.body)});
 });
 await page.goto(origin+'/v3/__rewards_test__.html',{waitUntil:'commit'});
 if(options.beforeReady)await options.beforeReady(page,releaseModule);
 if(options.abortModule)await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true'&&!document.querySelector('#start').disabled);
 else await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true'&&window.BorealRewards);
 await page.evaluate(()=>BorealRewardMenu.ready);
 return {context,page,errors,requests,external,async close(){check(errors.length===0,`no browser errors (${options.name||'scenario'})`);check(external.length===0,'no real external security or SMS request');await context.close()}};
}
const text = page => page.locator('#rewardClaim').innerText();
(async()=>{
 const {ENGINE_VERSION,replayGame}=await import('../v3/game-session-engine.mjs');
 const server=spawn('python3',['-m','http.server','8779','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<40;i++){try{if((await fetch(origin+'/v3/index.html')).ok)break}catch{}if(i===39)throw Error('Test server unavailable');await new Promise(resolve=>setTimeout(resolve,50))}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  {
   const test=await open(browser,{name:'delayed module startup gate',delayModule:true,beforeReady:async(page,release)=>{
    await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true'&&window.BorealRewardMenu?.getStatus().mode==='rewards');
    check(await page.locator('#start').isDisabled()&&await page.locator('#fromHow').isDisabled(),'loaded art and reward status keep play disabled while the shared client module is pending');
    check(await page.evaluate(()=>!window.BorealRewards&&rewardsTest.state().shared===null),'no original score engine can begin a reward run during module startup');
    release();
   }});
   check(await test.page.locator('#start').isEnabled(),'client ready event opens play after the shared module finishes loading');
   check(test.requests.every(r=>r.pathname==='/api/rewards/status'),'waiting for the module does not create any financial session');
   await test.close();
  }
  {
   const test=await open(browser,{name:'failed module ordinary fallback',abortModule:true}),{page}=test;
   await page.click('#start');
   check(await page.evaluate(()=>!window.BorealRewards&&rewardsTest.state().mode==='playing'&&rewardsTest.state().shared===null),'failed module opens the explicit ordinary offline fallback');
   check((await page.locator('#rewardStartNote').innerText()).includes('aucune récompense monétaire'),'fallback HUD is explicitly marked without money');
   check(test.requests.every(r=>r.pathname==='/api/rewards/status'),'failed client module cannot call reward start or submit an original score');
   await test.close();
  }
  {
   const test=await open(browser,{name:'pending practice',status:status({mode:'pending',rewardsEnabled:false,capCents:0,turnstileSiteKey:null})}),{page}=test;
   check(await page.locator('input[name=phone]').count()===0,'no account or phone form before ordinary play');
   for(const size of [{width:320,height:568},{width:620,height:900},{width:844,height:390},{width:390,height:844}]){
    await page.setViewportSize(size);await page.waitForTimeout(35);await page.evaluate(()=>{rewardsTest.resize();document.querySelector('#home').scrollTop=0;rewardsTest.draw()});
    const hero=await page.evaluate(()=>window.__heroBounds.at(-1)),card=await page.locator('.boreal-reward-info').boundingBox();
    check(hero&&!(hero.left<card.x+card.width&&hero.right>card.x&&hero.top<card.y+card.height&&hero.bottom>card.y),`reward card leaves Jacques fully unobscured at ${size.width}x${size.height}`);
    if(process.env.BOREAL_SCREENSHOTS)await page.screenshot({path:`/tmp/boreal-rewards-menu-${size.width}x${size.height}.png`});
    await page.locator('#start').scrollIntoViewIfNeeded();const bounds=await page.locator('#start').boundingBox();
    check(bounds&&bounds.y>=-1&&bounds.y+bounds.height<=size.height+1,`actual branded menu start is reachable at ${size.width}x${size.height}`);
   }
   await page.locator('#boreal-open-rules').click();check(await page.locator('#boreal-rules').isVisible(),'provided rules dialog is accessible from the actual menu');
   await page.keyboard.press('Escape');check(!await page.locator('#boreal-rules').isVisible(),'rules dialog closes with Escape before play');
   await page.click('#start');
   check((await page.locator('#rewardStartNote').innerText()).includes('Entraînement — aucune récompense monétaire'),'pending state clearly starts free practice without a promise');
   await page.evaluate(()=>{rewardsTest.playTo(60,[]);rewardsTest.draw();rewardsTest.playTo(120,[]);rewardsTest.draw()});
   check(await page.evaluate(()=>rewardsTest.state().score>0&&new Set(window.__heroDraws.map(x=>JSON.stringify(x))).size>=2),'actual shared practice engine scores and draws different Christmas running frames');
   await page.evaluate(()=>rewardsTest.playTo(1000,[]));
   check((await page.locator('#feedback').innerText()).includes('aucune récompense monétaire'),'practice result clearly has no money');
   check(test.requests.every(r=>r.pathname==='/api/rewards/status'),'pending practice sends no start, finish, identity or SMS request');
   await test.close();
  }
  {
   let startBody;
   const test=await open(browser,{name:'upfront extreme confirmation',handle:async(pathname,body)=>{
    if(pathname==='/api/games/start'){startBody=body;return{body:{sessionId:'mode-changed',seed:1,mode:'extreme',engineVersion:ENGINE_VERSION,capCents:0,expiresAt:new Date(Date.now()+1800000).toISOString(),policyVersion:'test-policy',requiresModeConfirmation:true}}}
    if(pathname==='/api/games/finish'){const result=replayGame({seed:1,width:startBody.width,height:startBody.height,mode:'extreme',...body});return{body:{score:result.score,eligible:false,mode:'extreme',capCents:0}}}
   }}),{page}=test;
   check(await page.locator('.boreal-reward-tiers span').count()===3&&await page.locator('.boreal-reward-tiers .unavailable').count()===1,'actual menu disables the higher unoffered tier above the announced cap');
   await page.click('#start');await page.waitForFunction(()=>!document.querySelector('#rewardClaim').classList.contains('off'));
   check(startBody.expectedMode==='rewards'&&startBody.turnstileToken==='test-turnstile-token','reward start sends the requested mode and actual challenge token');
   check(await page.evaluate(()=>window.__turnstileCalls[0].action==='boreal-session'),'Turnstile start action is boreal-session');
   check(await page.evaluate(()=>rewardsTest.state().mode==='home'&&rewardsTest.state().shared===null),'server mode change does not silently start the engine');
   check((await text(page)).includes('Défi extrême')&&(await text(page)).includes('Aucune récompense monétaire'),'actual extreme difficulty and absence of money are shown before a second click');
   await page.getByRole('button',{name:'Commencer en Défi extrême'}).click();
   check(await page.evaluate(()=>rewardsTest.state().shared.mode==='extreme'&&rewardsTest.state().speed===380),'second explicit click starts the extreme shared physics');
   await page.evaluate(()=>BorealRewardMenu.renderStatus({mode:'rewards',rewardsEnabled:true,capCents:2000}));
   await page.evaluate(()=>rewardsTest.playTo(100,[]));
   check(await page.evaluate(()=>rewardsTest.state().shared.mode==='extreme'&&rewardsTest.state().speed>=380),'later status refresh cannot change a running extreme session');
   await page.click('#pauseBtn');const frozen=await page.evaluate(()=>rewardsTest.state().shared.ticks);
   await page.evaluate(()=>{for(let i=0;i<300;i++)rewardsTest.frame(1/60)});
   check(await page.evaluate(()=>rewardsTest.state().shared.ticks)===frozen,'pause preserves tick proof and score');
   await page.click('#resume');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   check(await page.evaluate(()=>rewardsTest.state().mode==='paused'),'background focus change pauses the actual session');
   await page.click('#resume');await page.setViewportSize({width:390,height:900});await page.evaluate(()=>rewardsTest.resize());
   await page.evaluate(()=>rewardsTest.playTo(2000,[]));
   await page.waitForFunction(()=>document.querySelector('#rewardClaim').textContent.includes('points vérifiés'));
   const finish=test.requests.find(r=>r.pathname==='/api/games/finish').body;
   check(finish.resizes.some(r=>r.height===900)&&!('score'in finish),'resize stays in replay proof and client never submits an asserted score');
   check((await text(page)).includes('Ce mode ne donne aucune récompense monétaire'),'extreme result remains without money after resize and pause');
   check(test.requests.filter(r=>r.pathname==='/api/games/start').length===1,'mode confirmation uses the one reserved session');
   await test.close();
  }
  {
   let startBody,finishAttempts=0,verifyAttempts=0;
   const finishBodies=[];
   const test=await open(browser,{name:'real winning replay and verified SMS',handle:async(pathname,body)=>{
    if(pathname==='/api/games/start'){startBody=body;return{body:{sessionId:'genuine-winning-session',seed:fixture.seed,mode:'rewards',engineVersion:ENGINE_VERSION,capCents:1000,expiresAt:new Date(Date.now()+1800000).toISOString(),policyVersion:'test-policy'}}}
    if(pathname==='/api/games/finish'){
     finishBodies.push(body);finishAttempts++;
     if(finishAttempts===1)return{status:503,body:{message:'Réessaie après cette interruption de test.'}};
     const result=replayGame({seed:fixture.seed,width:startBody.width,height:startBody.height,mode:'rewards',...body});
     assert.ok(result.ended&&result.score===fixture.expectedScore);
     return{body:{score:result.score,eligible:true,mode:'rewards',capCents:1000,claimDeadline:new Date(Date.now()+1800000).toISOString()}};
    }
    if(pathname==='/api/rewards/confirmation')return{body:{score:fixture.expectedScore,reward:{code:'BOREAL-TEST-VERIFIED',valueCents:1000,confirmedAt:new Date().toISOString(),claimBy:new Date(Date.now()+30*86400000).toISOString(),status:'claimed'}}};
    if(pathname==='/api/rewards/sms/request')return{body:{challengeId:'test-sms-challenge'}};
    if(pathname==='/api/rewards/sms/verify'){
     verifyAttempts++;
     if(verifyAttempts===1)return{body:{awarded:false,score:fixture.expectedScore,reason:'invalid_code'}};
     return{body:{awarded:true,score:fixture.expectedScore,reward:{code:'BOREAL-TEST-VERIFIED',valueCents:1000,confirmedAt:new Date().toISOString(),claimBy:new Date(Date.now()+30*86400000).toISOString(),status:'pending'}}};
    }
   }}),{page}=test;
   check(await page.locator('input').count()===0,'winning run also starts without identity collection');
   const announced=await page.locator('.boreal-reward-info').innerText();
   check(/30 minutes, pauses comprises/.test(announced)&&/15 minutes de jeu effectif/.test(announced)&&/10 minutes suivant la fin/.test(announced),'real menu announces reservation, active play and SMS confirmation time limits before play');
   await page.click('#start');await page.waitForFunction(()=>rewardsTest.state().shared?.mode==='rewards');
   check((await page.locator('#rewardStartNote').innerText()).includes('Valable jusqu’à')&&(await page.locator('#rewardStartNote').innerText()).includes('Plafond réservé'),'announced cap and wall-clock expiry are visible at start');
   await page.evaluate(jumps=>rewardsTest.playTo(100,jumps),fixture.jumps);
   await page.setViewportSize({width:390,height:900});await page.evaluate(()=>rewardsTest.resize());
   await page.evaluate(jumps=>rewardsTest.playTo(120,jumps),fixture.jumps);
   await page.click('#pauseBtn');await page.evaluate(()=>{for(let i=0;i<120;i++)rewardsTest.frame(1/30)});await page.click('#resume');
   await page.evaluate(jumps=>rewardsTest.playTo(160,jumps),fixture.jumps);
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>rewardsTest.resize());
   const ended=await page.evaluate(({ticks,jumps})=>rewardsTest.playTo(ticks,jumps),fixture);
   check(ended.shared.ended&&Math.floor(ended.shared.score)===fixture.expectedScore&&ended.shared.ticks===fixture.ticks,'browser plays the genuine >10000-point shared-engine fixture with pause and two resizes');
   await page.getByRole('button',{name:'Réessayer la vérification',exact:true}).waitFor();
   check((await text(page)).includes('preuve de la partie est conservée'),'finish network error retains replay proof for retry');
   await page.getByRole('button',{name:'Réessayer la vérification',exact:true}).click();
   await page.locator('input[name=phone]').waitFor();
   check(finishBodies.length===2&&JSON.stringify(finishBodies[0])===JSON.stringify(finishBodies[1]),'finish retry sends the identical session, tick, jump and resize log');
   check(finishBodies[1].ticks===fixture.ticks&&JSON.stringify(finishBodies[1].jumps)===JSON.stringify(fixture.jumps)&&finishBodies[1].resizes.length===2&&!('score'in finishBodies[1]),'real browser proof has original jump inputs and no fabricated score');
   check(await page.locator('.reward-code').count()===0&&(await text(page)).includes('Aucun code n’est attribué avant confirmation du serveur'),'qualifying score alone never displays an awarded code');
   await page.locator('input[name=firstName]').fill('JacquesTest');await page.locator('input[name=lastName]').fill('BorealTest');await page.locator('input[name=phone]').fill('+15145551234');await page.locator('input[name=consent]').check();
   await page.getByRole('button',{name:'Recevoir mon code SMS'}).click();await page.locator('input[name=code]').waitFor();
   const sms=test.requests.find(r=>r.pathname==='/api/rewards/sms/request').body;
   check(sms.sessionId==='genuine-winning-session'&&sms.phone==='+15145551234'&&sms.firstName==='JacquesTest'&&sms.lastName==='BorealTest'&&sms.consentVersion==='rewards-2026-11-v1','SMS identity and consent are requested only after the verified winning run');
   check(await page.locator('.reward-code').count()===0,'requesting an SMS still does not confirm a gain');
   await page.locator('input[name=code]').fill('123456');await page.getByRole('button',{name:'Vérifier et réclamer'}).click();
   await page.getByText('Le code SMS est incorrect. Réessaie avec le code reçu.',{exact:true}).waitFor();
   check(await page.locator('.reward-code').count()===0&&await page.getByRole('button',{name:'Vérifier et réclamer'}).isEnabled(),'unawarded server verification stays retryable without a code');
   await page.getByRole('button',{name:'Vérifier et réclamer'}).click();await page.locator('.reward-code').waitFor();
   check(await page.locator('.reward-code').innerText()==='BOREAL-TEST-VERIFIED'&&(await text(page)).includes('Code à usage unique'),'code appears only after explicit server award with one-use terms');
   const stored=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
   check(!/15145551234|JacquesTest|BorealTest|123456|BOREAL-TEST-VERIFIED/.test(stored),'phone, names, SMS and award code are absent from browser storage');
   await page.getByRole('button',{name:'Voir le résultat',exact:true}).click();
   await page.locator('#rewardResultAction').click();await page.locator('.reward-code').waitFor();
   check(await page.locator('.reward-code').innerText()==='BOREAL-TEST-VERIFIED','confirmed award can be reopened from the result without losing its code');
   await page.reload();await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true'&&window.BorealRewards);await page.evaluate(()=>BorealRewardMenu.ready);
   check(test.requests.every(r=>r.pathname!=='/api/rewards/confirmation'),'page reload does not automatically look up identity or a confirmed code');
   await page.locator('#rewardRecover').click();await page.locator('.reward-code').waitFor();
   check((await text(page)).includes('Ce code a déjà été présenté au restaurant.')&&!(await text(page)).includes('Code à usage unique'),'explicit server recovery reflects an already claimed code without presenting it as usable');
   await test.close();
  }
  {
   const test=await open(browser,{name:'failed security allows practice',status:status({turnstileSiteKey:null})}),{page}=test;
   await page.click('#start');await page.getByRole('button',{name:'Jouer sans récompense'}).waitFor();
   check(await page.evaluate(()=>rewardsTest.state().shared===null),'missing security configuration fails closed before financial play');
   await page.getByRole('button',{name:'Jouer sans récompense'}).click();
   check(await page.evaluate(()=>rewardsTest.state().mode==='playing')&&test.requests.every(r=>r.pathname==='/api/rewards/status'),'ordinary practice remains available without a security challenge or financial API');
   await test.close();
  }
  console.log(`Rewards client browser: ${checks} checks passed, with mocked test APIs only.`);
 }finally{await browser?.close();server.kill('SIGTERM')}
})().catch(error=>{console.error(error);process.exitCode=1});
