const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const origin='http://127.0.0.1:8766';
const artifactDir=path.join(root,'artifacts/v3');
let checks=0;
const results=[];
const check=(condition,message)=>{
 assert.ok(condition,message);checks++;results.push(message);console.log('PASS',message);
};
const viewport={width:390,height:844};
const ready=page=>page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true');
const screenshot=(page,name)=>page.screenshot({path:path.join(artifactDir,name)});
const hook=`
window.testGame={reset,jump,update,resize,rank,end,draw,step:advanceFrame,
 state:()=>({mode,score,best,speed,world,ground,player:{...player},obstacles:obstacles.map(o=>({...o})),items:items.map(o=>({...o})),combo}),
 quiet:()=>{spawn=1e9;collectSpawn=1e9;obstacles=[];items=[]},
 obstacle:(type='log',x=player.x)=>{const shape=window.BorealMechanics.dimensions[type];obstacles.push({...shape,x,y:ground-(type==='branch'?125:shape.h)})},
 item:()=>items.push({type:'berry',x:player.x,y:player.y,w:18,h:18}),
 fixtures:()=>{obstacles=[{type:'log',x:300,y:ground-35,w:48,h:35}];items=[{type:'berry',x:300,y:ground-100,w:18,h:18}]}
};
`;
function instrument(html){
 const marker='\n})();';
 const end=html.lastIndexOf(marker);
 assert.ok(end>=0,'IIFE du moteur introuvable pour les tests isolés');
 return html.slice(0,end)+'\n'+hook+html.slice(end);
}
const imageTracker=()=>{
 window.__spriteDraws=[];
 const original=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(...args){
  const source=args[0];
  if((source instanceof HTMLImageElement&&/jacques/i.test(source.currentSrc||source.src))||(source instanceof HTMLCanvasElement&&/jacques/i.test(source.dataset.sourceAsset||''))){
   window.__spriteDraws.push({src:source.currentSrc||source.src||source.dataset.sourceAsset,clip:[source.dataset?.frame,...args.slice(1,5)],naturalWidth:source.naturalWidth||source.width,naturalHeight:source.naturalHeight||source.height});
   if(window.__spriteDraws.length>500)window.__spriteDraws.shift();
  }
  return original.apply(this,args);
 };
};
(async()=>{
 fs.mkdirSync(artifactDir,{recursive:true});
 const server=spawn('python3',['-m','http.server','8766','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 let metrics;
 try{
  for(let i=0;i<40;i++){
   try{const response=await fetch(origin+'/v3/index.html');if(response.ok)break}catch{}
   if(i===39)throw new Error('Serveur de test indisponible');
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
  const live=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  await live.addInitScript(imageTracker);
  const page=await live.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const externalRequests=[];
  page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))externalRequests.push(request.url())});
  await page.goto(origin+'/v3/index.html');await ready(page);
  check(await page.locator('#home').isVisible(),'menu V3 et ressources prêts');
  check(await page.locator('#start').isEnabled(),'jeu activé après chargement des sprites');
  check(await page.evaluate(()=>JacquesSprites.frameRects().length===24&&JacquesSprites.frameRects()[6].height>256&&JacquesSprites.frameRects()[3].width>256),'silhouettes complètes préservées au-delà de la grille indicative');
  check(await page.evaluate(()=>window.JacquesSprites.states.every(name=>['idle','run','jump','doubleJump','fall','land','collision'].includes(name))&&window.JacquesSprites.states.includes('collision')),'états de sprites disponibles');
  await screenshot(page,'menu-mobile.png');
  await page.click('#how');check(await page.locator('#instructions').isVisible(),'instructions conservées');
  await page.click('#back');await page.click('#start');await page.waitForTimeout(700);
  check(Number((await page.locator('#score').textContent()).replace(/\D/g,''))>0,'partie réelle avance dans Chromium');
  await screenshot(page,'jeu-mobile.png');
  const drawn=await page.evaluate(()=>window.__spriteDraws);
  check(drawn.length>2&&drawn.every(draw=>draw.naturalWidth>0&&draw.naturalHeight>0),'personnage affiché depuis un vrai fichier image chargé');
  check(new Set(drawn.map(draw=>JSON.stringify(draw.clip))).size>1,'animation de course change réellement de frame');
  await page.click('#pauseBtn');const pausedScore=await page.locator('#score').textContent();await page.waitForTimeout(250);
  check(pausedScore===await page.locator('#score').textContent(),'pause bloque le score');
  await screenshot(page,'pause-mobile.png');
  await page.click('#resume');check(await page.locator('#paused').isHidden(),'reprise de la partie');
  await page.click('#pauseBtn');await page.click('#exit');check(await page.locator('#home').isVisible(),'retour au menu');
  for(const [name,size] of [['compact',{width:320,height:568}],['landscape',{width:844,height:390}]]){
   await page.setViewportSize(size);await page.click('#start');await page.waitForTimeout(650);
   check(await page.locator('#hud').isVisible(),`partie jouable en ${name}`);
   await screenshot(page,`jeu-${name}.png`);
   await page.click('#pauseBtn');await page.click('#exit');
   const homeButton=await page.locator('#start').boundingBox();
   check(homeButton&&homeButton.y>=0&&homeButton.y+homeButton.height<=size.height,`bouton de jeu accessible en ${name}`);
  }
  await page.setViewportSize(viewport);await page.click('#start');
  metrics=await page.evaluate(()=>new Promise(resolve=>{
   const times=[];let previous;
   function frame(time){if(previous!==undefined)times.push(time-previous);previous=time;if(times.length<90)requestAnimationFrame(frame);else{const sorted=[...times].sort((a,b)=>a-b);resolve({samples:times.length,medianFrameMs:sorted[Math.floor(sorted.length/2)],p95FrameMs:sorted[Math.floor(sorted.length*.95)],observedFps:1000/(times.reduce((sum,value)=>sum+value,0)/times.length)})}}
   requestAnimationFrame(frame);
  }));
  check(metrics.samples===90&&Number.isFinite(metrics.observedFps),'mesure du rendu dans Chromium terminée');
  check(errors.length===0,'aucune erreur JavaScript sur les pages réelles');
  check(externalRequests.length===0,'V3 autonome sans appel backend ou service de récompenses');
  await live.close();

  // Instrumentation de la réponse HTTP réservée aux tests : aucun hook dans le jeu livré.
  const deterministic=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  await deterministic.addInitScript(()=>{window.requestAnimationFrame=()=>0});
  await deterministic.addInitScript(imageTracker);
  const testPage=await deterministic.newPage();
  const testErrors=[];testPage.on('pageerror',error=>testErrors.push(error.message));
  const html=instrument(fs.readFileSync(path.join(root,'v3/index.html'),'utf8'));
  await testPage.route('**/v3/test.html',route=>route.fulfill({contentType:'text/html',body:html}));
  await testPage.goto(origin+'/v3/test.html');await ready(testPage);
  const run=fn=>testPage.evaluate(fn);
  const scenery=await run(()=>{
   const canvas=document.createElement('canvas');canvas.width=620;canvas.height=390;
   const context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
   const options={width:620,height:390,ground:312,world:0,time:0};
   const positions=[];let current;
   const original=context.drawImage;
   context.drawImage=function(...args){
    if(args[0]===BorealScenery.sprites.trees[0]&&args[3]<30)current.far.push(args[1]);
    if(args[0]===BorealScenery.sprites.ferns[0])current.ferns.push(args[1]);
    return original.apply(this,args);
   };
   function scene(world){current={far:[],ferns:[]};BorealScenery.draw(context,{...options,world});positions.push(current)}
   context.fillStyle='#ff00ff';context.fillRect(0,0,canvas.width,canvas.height);
   scene(0);const initial=context.getImageData(0,0,canvas.width,canvas.height).data;
   scene(100);scene(0);const final=context.getImageData(0,0,canvas.width,canvas.height).data;
   let changed=0;for(let i=0;i<initial.length;i++)if(initial[i]!==final[i])changed++;
   const corners=[0,(canvas.width-1)*4].map(index=>Array.from(initial.slice(index,index+3)));
   return {layers:BorealScenery.layers.map(layer=>({...layer})),positions,changed,corners};
  });
  check(scenery.layers.length===9&&new Set(scenery.layers.map(layer=>layer.speed)).size===9,'neuf plans de décor ont des vitesses distinctes');
  const farMovement=Math.abs(scenery.positions[0].far[0]-scenery.positions[1].far[0]);
  const foregroundMovement=Math.abs(scenery.positions[0].ferns[1]-scenery.positions[1].ferns[1]);
  check(farMovement>0&&foregroundMovement>farMovement*5,'les images de premier plan défilent réellement plus vite que les arbres lointains');
  check(scenery.changed===0&&scenery.corners.every(pixel=>pixel.join(',')!=='255,0,255'),'chaque image paysage est entièrement repeinte sans traces précédentes');
  const animations=await run(()=>{
   const canvas=document.createElement('canvas');canvas.width=130;canvas.height=130;
   const context=canvas.getContext('2d');const clips=[];
   const original=context.drawImage;context.drawImage=function(...args){clips.push([args[0].dataset?.frame,...args.slice(1,5)]);return original.apply(this,args)};
   return ['run','jump','doubleJump','fall','collision'].map(state=>{
    clips.length=0;
    for(let i=0;i<=9;i++)JacquesSprites.draw(context,{x:45,y:70,w:27,h:53},state,i*.1);
    return {state,frames:new Set(clips.map(clip=>clip.join(','))).size};
   });
  });
  check(animations.every(animation=>animation.frames>=2),'chaque état demandé possède plusieurs frames PNG réellement dessinées');
  await run(()=>{
   window.__drawStates=[];
   const renderer=JacquesSprites;
   window.JacquesSprites={...renderer,draw(...args){window.__drawStates.push(args[2]);return renderer.draw.apply(renderer,args)}};
   testGame.reset();testGame.quiet();testGame.draw();
  });
  check(await run(()=>testGame.state().speed>240),'vitesse initiale supérieure à la V2.1');
  await testPage.keyboard.down('Space');await testPage.keyboard.down('Space');await testPage.keyboard.up('Space');
  check(await run(()=>testGame.state().player.jumps===1),'touche maintenue ne déclenche pas deux sauts');
  await testPage.keyboard.press('ArrowUp');check(await run(()=>testGame.state().player.jumps===2),'clavier déclenche le second saut');
  await run(()=>{testGame.reset();testGame.quiet()});
  await testPage.touchscreen.tap(150,450);check(await run(()=>testGame.state().player.jumps===1),'commande tactile déclenche le premier saut');
  await testPage.touchscreen.tap(150,450);check(await run(()=>testGame.state().player.jumps===2),'commande tactile déclenche le double saut');
  await run(()=>{testGame.reset();testGame.quiet()});
  await run(()=>{testGame.fixtures();testGame.draw()});await screenshot(testPage,'jeu-obstacles-mobile.png');
  await run(()=>{testGame.reset();testGame.quiet()});
  await run(()=>testGame.jump());check(await run(()=>testGame.state().player.jumps===1),'premier saut conservé');
  await run(()=>{for(let i=0;i<14;i++)testGame.update(1/120);testGame.draw()});
  await screenshot(testPage,'saut-mobile.png');
  await run(()=>testGame.jump());check(await run(()=>testGame.state().player.jumps===2),'double saut conservé');
  await run(()=>{for(let i=0;i<14;i++)testGame.update(1/120);testGame.draw()});
  await screenshot(testPage,'double-saut-mobile.png');
  const velocity=await run(()=>testGame.state().player.vy);await run(()=>testGame.jump());
  check(await run(()=>testGame.state().player.vy)===velocity,'troisième saut refusé');
  await run(()=>{while(testGame.state().player.vy<0)testGame.update(1/120);for(let i=0;i<12;i++)testGame.update(1/120);testGame.draw()});
  await screenshot(testPage,'descente-mobile.png');
  check(await run(()=>['run','jump','doubleJump','fall'].every(state=>window.__drawStates.includes(state))),'course, saut, double saut et descente emploient leurs sprites');
  await run(()=>{for(let i=0;i<240;i++)testGame.update(1/120);testGame.draw()});
  check(await run(()=>testGame.state().player.grounded&&testGame.state().player.jumps===0),'atterrissage recharge les deux sauts');
  await run(()=>{testGame.reset();testGame.quiet();testGame.item();testGame.update(1/120)});
  check(await run(()=>testGame.state().score>74&&testGame.state().combo===1),'collectible et bonus conservés');
  await run(()=>{testGame.item();testGame.update(1/120)});check(await run(()=>testGame.state().combo===2),'combo conservé');
  await run(()=>{for(let i=0;i<360;i++)testGame.update(1/120)});check(await run(()=>testGame.state().combo===0),'expiration du combo');
  for(const type of ['log','rock','stump']){
   await testPage.evaluate(type=>{testGame.reset();testGame.quiet();testGame.obstacle(type,200);testGame.jump();for(let i=0;i<100;i++)testGame.update(1/120)},type);
   check(await run(()=>testGame.state().mode==='playing'),`un saut franchit un obstacle ${type} placé à temps`);
  }
  await run(()=>{testGame.reset();testGame.quiet();testGame.obstacle('high',240);testGame.jump();for(let i=0;i<120;i++)testGame.update(1/120)});
  check(await run(()=>testGame.state().mode==='over'),'souche haute demande un double saut');
  await run(()=>{testGame.reset();testGame.quiet();testGame.obstacle('high',240);testGame.jump();for(let i=0;i<18;i++)testGame.update(1/120);testGame.jump();for(let i=0;i<120;i++)testGame.update(1/120)});
  check(await run(()=>testGame.state().mode==='playing'),'double saut franchit la souche haute');
  await run(()=>{testGame.reset();testGame.quiet();testGame.obstacle('branch',200);for(let i=0;i<100;i++)testGame.update(1/120)});
  check(await run(()=>testGame.state().mode==='playing'),'branche haute franchissable en restant au sol');
  await run(()=>{testGame.reset();testGame.quiet();testGame.obstacle();testGame.update(1/120);testGame.draw()});
  check(await run(()=>testGame.state().mode==='over'),'collision termine la partie');
  check(await run(()=>window.__drawStates.includes('collision')),'sprite de collision utilisé par le jeu');
  await screenshot(testPage,'collision-mobile.png');
  await testPage.locator('#over').evaluate(element=>{element.style.visibility='hidden'});
  await screenshot(testPage,'collision-sprite-mobile.png');
  await testPage.locator('#over').evaluate(element=>{element.style.visibility=''});
  await testPage.click('#retry');check(await run(()=>testGame.state().mode==='playing'&&testGame.state().score===0),'redémarrage propre');
  check(await run(()=>[0,900,2200,4000,6500,10000].map(testGame.rank).join('|'))==='Promeneur boréal|Cueilleur des bois|Éclaireur boréal|Maître cueilleur|Gardien du Grand Nord|Légende des Boréalistes','six titres et seuils conservés');
  const frequency=await run(()=>[30,60,120].map(fps=>{testGame.reset();testGame.quiet();testGame.jump();for(let i=0;i<fps/2;i++)testGame.step(1/fps);return testGame.state()}));
  check(Math.max(...frequency.map(state=>state.score))-Math.min(...frequency.map(state=>state.score))<1e-6,'score indépendant de la fréquence de simulation');
  check(Math.max(...frequency.map(state=>state.player.y))-Math.min(...frequency.map(state=>state.player.y))<1e-6,'physique indépendante de la fréquence de simulation');
  await run(()=>{testGame.reset();testGame.quiet();testGame.fixtures();testGame.jump()});const before=await run(()=>testGame.state());
  await testPage.setViewportSize({width:844,height:390});await run(()=>testGame.resize());const after=await run(()=>testGame.state());
  check(Math.abs((before.ground-before.player.y)-(after.ground-after.player.y))<1e-6,'hauteur du saut conservée après rotation');
  check(before.ground-before.obstacles[0].y===after.ground-after.obstacles[0].y&&before.ground-before.items[0].y===after.ground-after.items[0].y,'obstacles et collectibles restent alignés après rotation');
  await run(()=>window.dispatchEvent(new Event('blur')));check(await run(()=>testGame.state().mode==='paused'),'perte de focus met en pause');
  await run(()=>{testGame.reset();testGame.quiet();testGame.item();testGame.update(1/120);testGame.end()});
  const savedBest=await run(()=>testGame.state().best);await testPage.reload();await ready(testPage);
  check(await run(()=>testGame.state().best)===savedBest&&savedBest>0,'record personnel persisté après rechargement');
  await run(()=>localStorage.setItem('boreal_v1_best','Infinity'));await testPage.reload();await ready(testPage);
  check(await run(()=>testGame.state().best===0),'record local invalide rejeté');
  check(testErrors.length===0,'aucune erreur JavaScript dans les scénarios déterministes');
  await deterministic.close();

  const unavailable=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  await unavailable.route(/jacques.*\.png/i,route=>route.abort());
  const failurePage=await unavailable.newPage();
  await failurePage.goto(origin+'/v3/index.html');
  await failurePage.locator('#assetError').waitFor({state:'visible'});
  check(await failurePage.locator('#start').isDisabled(),'ressource manquante bloque le démarrage');
  check((await failurePage.locator('#assetError').textContent()).trim().length>15,'erreur graphique visible et explicite');
  await screenshot(failurePage,'ressource-manquante.png');
  await unavailable.unroute(/jacques.*\.png/i);
  await failurePage.click('#reloadAssets');await ready(failurePage);
  check(await failurePage.locator('#start').isEnabled()&&await failurePage.locator('#assetError').isHidden(),'rechargement rétablit les ressources et le jeu');
  await unavailable.close();
  fs.writeFileSync(path.join(artifactDir,'results.json'),JSON.stringify({checks,results,chromiumVersion:browser.version(),viewports:[viewport,{width:320,height:568},{width:844,height:390}],renderMetrics:metrics,limitations:['Chromium headless; aucun téléphone physique testé.','Les captures de sauts et collision contrôlent le temps de simulation du vrai moteur.','Le débit observé ne garantit pas les performances sur mobile.']},null,2)+'\n');
  console.log(`${checks} contrôles V3 réussis. Mesure Chromium : ${metrics.observedFps.toFixed(1)} images/s observées.`);
 }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
