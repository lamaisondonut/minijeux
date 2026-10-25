const {chromium}=require('playwright');const fs=require('node:fs');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:8942';
const hook=`window.expeditionTest={state:()=>expedition,mode:()=>mode,step:()=>{const s=expedition;const target=[...s.items.filter(i=>!i.taken),...s.obstacles].filter(i=>i.x+i.w>s.player.x+5).sort((a,b)=>a.x-b.x)[0];if(s.player.grounded&&target&&target.x-s.player.x<s.speed*.28)jump();update(1/120)},draw,advanceFrame};`;
(async()=>{let browser;const server=spawn('python3',['-m','http.server','8942','--bind','127.0.0.1'],{cwd:path.join(root,'v3'),stdio:'ignore'});let checks=0;const check=(value,label)=>{assert(value,label);console.log('PASS',label);checks++};
try{
 for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const [routeId,prize] of [['r0',0],['r1',5],['r2',10],['r3',20]]){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/?parcours=*',async route=>{const response=await route.fetch();let html=await response.text();const index=html.lastIndexOf('\n})();');assert(index>0);html=html.slice(0,index)+'\n'+hook+html.slice(index);await route.fulfill({response,body:html})});
  await page.goto(origin+'/?parcours='+routeId);await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true');
  const text=await page.locator('body').innerText();check(!/budget|récompense|disponib|admissible/i.test(text),routeId+' accueil sans information financière');
  await page.click('#start');await page.click('#pauseBtn');const before=await page.locator('#score').textContent();await page.waitForTimeout(100);check(before===await page.locator('#score').textContent(),routeId+' pause');await page.click('#resume');
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0});await page.waitForTimeout(40);
  await page.evaluate(()=>{const t=window.expeditionTest;while(t.mode()==='playing')t.step();t.draw()});
  check(await page.evaluate(()=>window.expeditionTest.state().finished),routeId+' arrivée naturelle');
  await page.waitForTimeout(1250);check(await page.locator('#over .brand').textContent()==='EXPÉDITION RÉUSSIE',routeId+' écran arrivée');
  if(prize)check((await page.locator('#demoPrize').textContent()).includes(prize+' $'),routeId+' résultat fictif correct');else check(await page.locator('#demoPrize').count()===0,routeId+' fin sans faux prix');
  check(errors.length===0,routeId+' aucune erreur JavaScript');
  if(routeId==='r0'){fs.mkdirSync(path.join(root,'work/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'work/screenshots/arrival-mobile.png')})}
  await page.click('#retry');check(await page.evaluate(()=>window.expeditionTest.mode()==='playing'&&window.expeditionTest.state().ticks<120),routeId+' rejouer');
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto(origin+'/?parcours=r0');await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true');await page.click('#start');await page.waitForTimeout(500);check(Number((await page.locator('#score').textContent()).replace(/\D/g,''))>0,'ordinateur partie réelle sans instrumentation');
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);check(await page.locator('#hud').isVisible(),'rotation paysage sans interruption');await page.close();
 const offline=await browser.newContext({offline:true,viewport:{width:390,height:844}});const p=await offline.newPage();const requests=[];p.on('request',r=>requests.push(r.url()));await p.setContent(fs.readFileSync(path.join(root,'work/expedition-demo/index.html'),'utf8'));await p.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true');await p.click('#start');await p.waitForTimeout(400);check(Number((await p.locator('#score').textContent()).replace(/\D/g,''))>0,'livraison autonome jouable hors ligne');check(requests.filter(u=>/^https?:/.test(u)).length===0,'aucun réseau requis pour le HTML autonome');
 console.log(checks+' contrôles navigateur réussis.');
}finally{if(browser)await browser.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
