'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const origin='http://127.0.0.1:8768';
const artifactDir=path.join(root,'artifacts/noel-home');
const viewports=[{width:390,height:844},{width:320,height:568},{width:620,height:900},{width:844,height:390}];
const results=[],geometry=[];
const check=(condition,message)=>{assert.ok(condition,message);results.push(message);console.log('PASS',message)};
const hash=content=>createHash('sha256').update(content).digest('hex');
const ready=async page=>{await page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true'&&window.BorealRewards,undefined,{polling:20});await page.evaluate(()=>BorealRewardMenu.ready)};
const pendingStatus=async route=>route.fulfill({json:{mode:'pending',rewardsEnabled:false,capCents:0,tiers:[]}});
function functionSource(html,name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0,'Fonction originale introuvable : '+name);
 let at=html.indexOf('{',start)+1,depth=1,quote=null,escaped=false;
 for(;at<html.length&&depth;at++){
  const char=html[at];
  if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null}
  else if(char==='"'||char==="'"||char==='`')quote=char;
  else if(char==='{')depth++;
  else if(char==='}')depth--;
 }
 assert.equal(depth,0);return html.slice(start,at);
}
const hook=`
window.noelHomeTest={draw,drawHero,scene,reset,pause,resize,
 state:()=>({mode,animationTime,world,width:W,height:H,ground,player:{...player}}),
 quiet:()=>{spawn=1e9;collectSpawn=1e9;obstacles=[];items=[]},
 home:()=>{mode='home';show('home')}
};
`;
function instrument(html){
 const end=html.lastIndexOf('\n})();');assert.ok(end>=0,'Fermeture du moteur introuvable');
 return html.slice(0,end)+'\n'+hook+html.slice(end);
}
function drawTracker(){
 window.__homeHeroDraws=[];window.__sleighDraws=[];
 const opaqueBounds=new WeakMap(),original=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(...args){
  const source=args[0],isHero=source instanceof HTMLCanvasElement&&/jacques-noel/.test(source.dataset.sourceAsset||'');
  const isSleigh=source===window.BorealNoelSleigh?.image||source===window.BorealNoelSleigh?.sprite||/santa-sleigh-six-reindeer/.test(source.currentSrc||source.src||source.dataset?.sourceAsset||source.dataset?.decorativeKind||'');
  if(this.canvas.id==='game'&&(isHero||isSleigh)){
   const matrix=this.getTransform(),canvasBounds=this.canvas.getBoundingClientRect();
   let sourceBounds=opaqueBounds.get(source);
   if(!sourceBounds&&isHero){
    const width=source.width,height=source.height,pixels=source.getContext('2d').getImageData(0,0,width,height).data;
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>30){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
    sourceBounds={left,top,right:right+1,bottom:bottom+1};opaqueBounds.set(source,sourceBounds);
   }
   const sw=source.width||source.naturalWidth,sh=source.height||source.naturalHeight;
   let sx=0,sy=0,cw=sw,ch=sh,dx,dy,dw,dh;
   if(args.length===9)[,sx,sy,cw,ch,dx,dy,dw,dh]=args;
   else if(args.length===5)[,dx,dy,dw,dh]=args;
   else [,dx,dy]=args,dw=sw,dh=sh;
   sourceBounds||={left:sx,top:sy,right:sx+cw,bottom:sy+ch};
   const x0=dx+(sourceBounds.left-sx)/cw*dw,y0=dy+(sourceBounds.top-sy)/ch*dh;
   const x1=dx+(sourceBounds.right-sx)/cw*dw,y1=dy+(sourceBounds.bottom-sy)/ch*dh;
   const points=[[x0,y0],[x1,y0],[x0,y1],[x1,y1]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
   const ratio=this.canvas.width/canvasBounds.width;
   const left=Math.min(...points.map(p=>p.x))/ratio+canvasBounds.left,top=Math.min(...points.map(p=>p.y))/ratio+canvasBounds.top;
   const right=Math.max(...points.map(p=>p.x))/ratio+canvasBounds.left,bottom=Math.max(...points.map(p=>p.y))/ratio+canvasBounds.top;
   const record={left,top,right,bottom,width:right-left,height:bottom-top,scaleX:Math.hypot(matrix.a,matrix.b)/ratio,scaleY:Math.hypot(matrix.c,matrix.d)/ratio,frame:source.dataset?.frame,source:source.currentSrc||source.src||source.dataset?.sourceAsset||'',mode:window.noelHomeTest?.state().mode};
   const draws=isHero?window.__homeHeroDraws:window.__sleighDraws;draws.push(record);if(draws.length>300)draws.shift();
  }
  return original.apply(this,args);
 };
}
const overlaps=(a,b)=>a.left<b.x+b.width&&a.right>b.x&&a.top<b.y+b.height&&a.bottom>b.y;
const canvasHash=page=>page.evaluate(async()=>{
 const canvas=document.querySelector('#game'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
 const digest=await crypto.subtle.digest('SHA-256',pixels.buffer);return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
});
(async()=>{
 fs.mkdirSync(artifactDir,{recursive:true});
 const html=fs.readFileSync(path.join(root,'v3/index.html'),'utf8');
 const existing=fs.readFileSync(path.join(root,'tests/noel-browser.cjs'),'utf8');
 const functionsBlock=existing.match(/const originalFunctions=\{([\s\S]*?)\n\};/);assert.ok(functionsBlock);
 const pinnedFunctions=Object.fromEntries(Array.from(functionsBlock[1].matchAll(/(\w+):'([a-f0-9]{64})'/g),match=>[match[1],match[2]]));
 assert.equal(Object.keys(pinnedFunctions).length,14);
 for(const [name,pinned] of Object.entries(pinnedFunctions))check(hash(functionSource(html,name))===pinned,`fonction ${name} originale inchangée`);
 const filesBlock=existing.match(/const originalFiles=\{([\s\S]*?)\n\};/);assert.ok(filesBlock);
 for(const [,file,pinned] of filesBlock[1].matchAll(/'([^']+)':'([a-f0-9]{64})'/g))check(hash(fs.readFileSync(path.join(root,file)))===pinned,`${file} original inchangé`);
 check(!html.includes('window.noelHomeTest')&&!html.includes('window.testGame'),'aucun accès de test dans le HTML livré');
 const server=spawn('python3',['-m','http.server','8768','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<40;i++){
   try{if((await fetch(origin+'/v3/index.html')).ok)break}catch{}
   if(i===39)throw new Error('Serveur de test indisponible');await new Promise(resolve=>setTimeout(resolve,50));
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const errors=[],external=[];
  for(const viewport of viewports){
   const context=await browser.newContext({viewport,isMobile:viewport.width<=390,hasTouch:viewport.width<=390});
   await context.route('**/api/rewards/status',pendingStatus);
   await context.addInitScript(drawTracker);
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))external.push(request.url())});
   await page.route('**/v3/__home_test__.html',route=>route.fulfill({contentType:'text/html',body:instrument(html)}));
   await page.goto(origin+'/v3/__home_test__.html');await ready(page);await page.waitForTimeout(150);
   await page.evaluate(()=>noelHomeTest.drawHero());
   const hero=await page.evaluate(()=>window.__homeHeroDraws.at(-1));
   const title=await page.locator('#home h1').boundingBox(),start=await page.locator('#start').boundingBox(),how=await page.locator('#how').boundingBox(),reward=await page.locator('.boreal-reward-info').boundingBox();
   const label=`${viewport.width}×${viewport.height}`;
   check(hero&&hero.mode==='home'&&hero.left>=0&&hero.top>=0&&hero.right<=viewport.width&&hero.bottom<=viewport.height,`Jacques entièrement visible au menu ${label}`);
   check(!overlaps(hero,title)&&!overlaps(hero,start)&&!overlaps(hero,how),`Jacques ne chevauche ni titre ni boutons ${label}`);
   check(!overlaps(hero,reward),`la carte de récompenses ne recouvre pas Jacques ${label}`);
   for(const id of ['start','how','boreal-open-rules','rewardRecover']){await page.locator('#'+id).scrollIntoViewIfNeeded();const box=await page.locator('#'+id).boundingBox();check(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`bouton ${id} accessible par défilement ${label}`)}
   await page.evaluate(()=>{document.querySelector('#home').scrollTop=0;window.dispatchEvent(new Event('boreal:menu-layout'));noelHomeTest.draw()});
   if(viewport.height>viewport.width)check(hero.height>80*1.45&&hero.bottom>title.y+title.height*.75,`Jacques conserve sa grande taille de menu à côté du titre ${label}`);
   geometry.push({viewport,hero,title,start,how,reward});
   await page.screenshot({path:path.join(artifactDir,`menu-${viewport.width}x${viewport.height}.png`)});
   await page.click('#start');await page.waitForFunction(()=>noelHomeTest.state().mode==='playing',undefined,{polling:20});await page.evaluate(()=>{noelHomeTest.quiet();noelHomeTest.drawHero()});
   const gameHero=await page.evaluate(()=>window.__homeHeroDraws.at(-1));
   check(gameHero.mode==='playing'&&Math.abs(gameHero.scaleX-1)<1e-8&&Math.abs(gameHero.scaleY-1)<1e-8,`taille de Jacques en partie inchangée ${label}`);
   await page.click('#pauseBtn');await page.waitForTimeout(100);const before=await canvasHash(page);
   await page.waitForTimeout(250);check(before===await canvasHash(page),`pause fige tous les pixels du décor ${label}`);
   await page.click('#resume');await page.waitForTimeout(100);
   check(await page.evaluate(()=>noelHomeTest.state().mode==='playing'),'reprise de la partie '+label);
   await context.close();
  }
  const context=await browser.newContext({viewport:viewports[0]});
  await context.route('**/api/rewards/status',pendingStatus);
  await context.addInitScript(()=>{window.requestAnimationFrame=()=>0});await context.addInitScript(drawTracker);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v3/__home_test__.html',route=>route.fulfill({contentType:'text/html',body:instrument(html)}));
  await page.goto(origin+'/v3/__home_test__.html');await ready(page);
  check(await page.evaluate(()=>BorealNoelSleigh.reindeerCount===6&&!!BorealNoelSleigh.image),'module du traîneau chargé avec son image et six rennes déclarés');
  check(await page.evaluate(()=>BorealNoelSleigh.image.naturalWidth>0&&BorealNoelSleigh.image.naturalHeight>0&&BorealNoelSleigh.sprite.width>0&&BorealNoelSleigh.sprite.height>0),'image transparente du traîneau décodée et mise en cache');
  const birds=await page.evaluate(()=>BorealScenery.sprites.birds.map(sprite=>({width:sprite.width,height:sprite.height,opaque:sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data.some((value,index)=>index%4===3&&value>0)})));
  check(birds.length===2&&birds.every(bird=>bird.width>0&&bird.height>0&&!bird.opaque),'les deux anciennes poses de l’oiseau sont transparentes');
  await page.evaluate(()=>noelHomeTest.draw());
  check(await page.evaluate(()=>window.__sleighDraws.length>0),'le vrai décor dessine l’image du traîneau à six rennes');
  const cache=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=620;canvas.height=900;const context=canvas.getContext('2d');
   const create=document.createElement.bind(document),NativeImage=window.Image,NativeOffscreen=window.OffscreenCanvas;
   let canvases=0,images=0,offscreen=0;
   document.createElement=(tag,...args)=>{if(tag==='canvas')canvases++;if(tag==='img')images++;return create(tag,...args)};
   window.Image=function(...args){images++;return new NativeImage(...args)};window.Image.prototype=NativeImage.prototype;
   if(NativeOffscreen)window.OffscreenCanvas=class extends NativeOffscreen{constructor(...args){super(...args);offscreen++}};
   try{for(let i=0;i<60;i++)BorealNoelScenery.draw(context,{width:620,height:900,ground:720,world:i*10,time:i/60})}
   finally{document.createElement=create;window.Image=NativeImage;if(NativeOffscreen)window.OffscreenCanvas=NativeOffscreen}
   return {canvases,images,offscreen};
  });
  check(cache.canvases===0&&cache.images===0&&cache.offscreen===0,'60 dessins du décor et du traîneau ne créent aucune image ni Canvas');
  const nose=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=620;canvas.height=900;const c=canvas.getContext('2d');
   const sample=time=>{c.clearRect(0,0,620,900);const options={width:620,height:900,world:0,time};const p=BorealNoelSleigh.layout(options);BorealNoelSleigh.draw(c,options);const radius=Math.max(1.6,p.w/180);return {layout:p,rgba:[...c.getImageData(Math.round(p.noseX+radius*.55),Math.round(p.noseY),1,1).data]}};
   return {bright:sample(.25),dim:sample(.75)};
  });
  check(nose.bright.layout.noseX>nose.bright.layout.x+nose.bright.layout.w*.98,'le nez lumineux est porté par le renne de tête à droite');
  check(nose.bright.layout.noseAlpha>nose.dim.layout.noseAlpha+.4,'le nez rouge pulse avec le temps de l’animation');
  check(nose.bright.rgba[0]>nose.dim.rgba[0]+35&&nose.bright.rgba[0]>nose.bright.rgba[1]*2,'les pixels du nez deviennent effectivement rouge vif puis rouge sombre');
  await page.emulateMedia({reducedMotion:'reduce'});
  const reducedNose=await page.evaluate(()=>[.25,.75].map(time=>BorealNoelSleigh.layout({width:620,height:900,world:time*100,time})));
  check(reducedNose[0].noseAlpha===reducedNose[1].noseAlpha&&reducedNose[0].x===reducedNose[1].x&&reducedNose[0].y===reducedNose[1].y,'la préférence de réduction des animations stabilise le traîneau et son nez');
  await context.close();
  for(const resource of ['noel-sleigh.js','assets/noel/santa-sleigh-six-reindeer.png']){
   const unavailable=await browser.newContext({viewport:viewports[0]});await unavailable.route('**/api/rewards/status',pendingStatus);let blocked=0;
   const url=new URL(resource,origin+'/v3/index.html').href;
   await unavailable.route(url,route=>{blocked++;return route.abort()});
   const failed=await unavailable.newPage();await failed.goto(origin+'/v3/index.html');await failed.locator('#assetError').waitFor({state:'visible'});
   check(blocked>0&&await failed.locator('#start').isDisabled()&&(await failed.locator('#assetErrorMessage').textContent()).trim().length>15,`${resource} manquant bloque le jeu et affiche une erreur`);
   await unavailable.unroute(url);await failed.click('#reloadAssets');await ready(failed);check(await failed.locator('#start').isEnabled(),`${resource} rétabli permet de rejouer`);await unavailable.close();
  }
  check(errors.length===0,'aucune erreur JavaScript dans les scénarios normaux');
  check(external.length===0,'aucun service externe ; seul le statut public local est consulté');
  fs.writeFileSync(path.join(artifactDir,'results.json'),JSON.stringify({checks:results.length,results,geometry,testedAt:new Date().toISOString(),chromiumVersion:browser.version(),viewports,limitations:['Chromium headless sous Linux ; aucun téléphone physique testé.','Le nombre de six rennes doit également être vérifié par revue visuelle de l’image PNG.','Les accès au moteur sont injectés dans la seule réponse HTTP de test.']},null,2)+'\n');
  console.log(`${results.length} contrôles menu et traîneau réussis.`);
 }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
