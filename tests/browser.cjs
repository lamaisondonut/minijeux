const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {spawn}=require('node:child_process');
const origin='http://127.0.0.1:8765';
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;console.log('PASS',message)};
(async()=>{
 const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 try {
 for(let i=0;i<40;i++){try{const r=await fetch(origin+'/current/index.html');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,50));if(i===39)throw new Error('Serveur de test indisponible')}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/current/index.html`);
 check(await page.locator('#home').isVisible(),'menu visible');
 await page.click('#how');check(await page.locator('#instructions').isVisible(),'instructions');await page.click('#back');
 await page.screenshot({path:path.join(root,'artifacts/menu-mobile.png')});
 await page.click('#start');await page.waitForTimeout(2400);
 check(Number(await page.locator('#score').textContent())>0,'progression réelle dans Chromium');
 await page.screenshot({path:path.join(root,'artifacts/jeu-mobile.png')});
 await page.click('#pauseBtn');const pausedScore=await page.locator('#score').textContent();await page.waitForTimeout(250);
 check(pausedScore===await page.locator('#score').textContent(),'pause sans progression');
 await page.click('#resume');check(await page.locator('#paused').isHidden(),'reprise');await page.click('#pauseBtn');await page.click('#exit');check(await page.locator('#home').isVisible(),'retour au menu');
 check(errors.length===0,'aucune erreur navigateur');
 // Instrumentation limitée à la réponse de test : aucun accès de debug dans le HTML distribué.
 const html=fs.readFileSync(path.join(root,process.env.REFERENCE||'current/index.html'),'utf8');
 const hook=`window.testGame={reset,jump,update,resize,rank,end,step:typeof advanceFrame==='function'?advanceFrame:update,state:()=>({mode,score,best,ground,player:{...player},obstacles:obstacles.map(o=>({...o})),items:items.map(o=>({...o})),combo}),quiet:()=>{spawn=1e9;collectSpawn=1e9;obstacles=[];items=[]},obstacle:()=>obstacles.push({type:'log',x:player.x,y:player.y,w:48,h:35}),item:()=>items.push({type:'berry',x:player.x,y:player.y,w:18,h:18}),fixtures:()=>{obstacles=[{type:'log',x:300,y:ground-35,w:48,h:35}];items=[{type:'berry',x:300,y:ground-100,w:18,h:18}]}};`;
 await page.route('**/test.html',route=>route.fulfill({contentType:'text/html',body:html.replace('resize();show(\'home\');requestAnimationFrame(loop);',`resize();show('home');${hook}`)}));
 await page.goto(`${origin}/test.html`);
 const run=fn=>page.evaluate(fn);
 await run(()=>{testGame.reset();testGame.quiet();testGame.jump()});check(await run(()=>testGame.state().player.jumps===1),'premier saut');
 await run(()=>testGame.jump());check(await run(()=>testGame.state().player.jumps===2),'double saut');
 const velocity=await run(()=>testGame.state().player.vy);await run(()=>testGame.jump());check(await run(()=>testGame.state().player.vy)===velocity,'troisième saut refusé');
 await run(()=>{for(let i=0;i<240;i++)testGame.update(1/120)});check(await run(()=>testGame.state().player.grounded&&testGame.state().player.jumps===0),'atterrissage réinitialise les sauts');
 await run(()=>{testGame.reset();testGame.quiet();testGame.item();testGame.update(1/120)});check(await run(()=>testGame.state().score>74&&testGame.state().combo===1),'collectible et bonus');
 await run(()=>{testGame.item();testGame.update(1/120)});check(await run(()=>testGame.state().combo===2),'combo');
 await run(()=>{for(let i=0;i<360;i++)testGame.update(1/120)});check(await run(()=>testGame.state().combo===0),'expiration combo');
 await run(()=>{testGame.obstacle();testGame.update(1/120)});check(await run(()=>testGame.state().mode==='over'),'collision termine la partie');
 await page.click('#retry');check(await run(()=>testGame.state().mode==='playing'&&testGame.state().score===0),'redémarrage propre');
 check(await run(()=>[0,900,2200,4000,6500,10000].map(testGame.rank).join('|'))==='Promeneur boréal|Cueilleur des bois|Éclaireur boréal|Maître cueilleur|Gardien du Grand Nord|Légende des Boréalistes','six seuils de titres');
 const scores=await run(()=>[30,60,120].map(fps=>{testGame.reset();testGame.quiet();testGame.jump();for(let i=0;i<fps/2;i++)testGame.step(1/fps);return testGame.state()}));
 check(Math.max(...scores.map(s=>s.score))-Math.min(...scores.map(s=>s.score))<1e-6,'score indépendant de la fréquence');
 check(Math.max(...scores.map(s=>s.player.y))-Math.min(...scores.map(s=>s.player.y))<1e-6,'physique indépendante de la fréquence');
 await run(()=>{testGame.reset();testGame.quiet();testGame.fixtures();testGame.jump()});const before=await run(()=>testGame.state());
 await page.setViewportSize({width:844,height:390});await run(()=>testGame.resize());const after=await run(()=>testGame.state());
 check(Math.abs((before.ground-before.player.y)-(after.ground-after.player.y))<1e-6,'hauteur de saut conservée après redimensionnement');
 check(before.ground-before.obstacles[0].y===after.ground-after.obstacles[0].y&&before.ground-before.items[0].y===after.ground-after.items[0].y,'obstacles et collectibles restent alignés au sol');
 await run(()=>window.dispatchEvent(new Event('blur')));check(await run(()=>testGame.state().mode==='paused'),'perte de focus met en pause');
 await run(()=>localStorage.setItem('boreal_v1_best','Infinity'));await page.reload();check(await run(()=>testGame.state().best===0),'record local invalide rejeté');
 check(errors.length===0,'aucune erreur pendant les scénarios');
 console.log(`${checks} contrôles réussis. Chromium avec viewport mobile, sans validation sur téléphone physique.`);
 } finally {if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
