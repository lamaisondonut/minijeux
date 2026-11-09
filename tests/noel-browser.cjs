const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const origin='http://127.0.0.1:8767';
const artifactDir=path.join(root,'artifacts/noel');
let checks=0;
const results=[];
const check=(condition,message)=>{
 assert.ok(condition,message);checks++;results.push(message);console.log('PASS',message);
};
const viewport={width:390,height:844};
const desktopViewport={width:1366,height:768};
const sha256=content=>createHash('sha256').update(content).digest('hex');
// SHA-256 values are pinned to original V3 commit 106dfa8, not to files in this
// checkout. The suite therefore remains useful after cloning edition-noel alone.
const originalFiles={
 'v3/jacques.js':'3fd01da2cb02eaca120db70a0899f304efb9eeb08e937addf97f07d10876eab9',
 'v3/scenery.js':'aec2f467242f725adf3c8f851c78d154bc896cbb2a9acf6eac688c9c21dc0282',
 'v3/mechanics.js':'aee3fa1f0a4c877c082fbefcb46a8cdf0b13be2418a14a132122a0ad33ff3b21',
 'v3/assets/forest-landscape.png':'ad93e84242204a348965041e3fd9890069978c1e1737585b9e81246ea68e5be5',
 'v3/assets/forest-panorama.png':'2cfd5c23f3d16376f9976f7eab5bee31aac61c51f04d2087cf7faa226442f431',
 'v3/assets/forest-sprites.png':'510ac9ce20581485da0efca0f475afa1910b9d2650ff59e164b50f6e243c0cf2',
 'v3/assets/forest-trees.png':'5fbd10cb4a53f399a9a2ca635f42a2e504a9dbdbddee8570ea948d3ca7ed2073',
 'v3/assets/jacques-atlas.json':'2ac86d2e1aaf3b96dccc9b9e25e0ab415b9d85bff2c3b6a02892aa24bd65a5e9',
 'v3/assets/jacques-atlas.png':'432f7dc720d8af5dd384498b08a8ecb1f1601d1658c4ec4c3e49c5c8c9f8a963'
};
const originalFunctions={
 rank:'7fe84b402acc52fcd3e9e7e9532a0f20c746729fc94819b9b82347723a9c644a',
 show:'a87de9f67dae9262712e4c11d94cf871a02cf210b7f83aa7e9cfcd8fd9203ad9',
 resize:'1b8f06c728077594e2d8bc51cc1ab309348fa7c28df2ed0047c6431760b8e84d',
 reset:'180661628b59d753c3a26d92b69c8d14f987d865e1aeaab2d45c5cbd8a311bb5',
 end:'e7deb855b312af8417fd71b1e468d99de0c5ec717925df7075b63b9ce63c7ce3',
 jump:'e216cf2dbccea25db35d25bd5f1801c8a99322c19b7b72048eab554467b81d46',
 addObstacle:'da57bb653ea0574d3f1f31ae8e8d51bc25da1960cf50d85a63d5b6a66fcfe01e',
 addItem:'6deeffa8ffde30322a56c54e6ff8861a463de5650d697a5df7b5f3286ee3b228',
 collision:'4e7eb7623844e5be934f534554b13bf79f4af35ebd371c3db337e207c7d57a49',
 update:'ce0fd50e19183b0e2c45baa40aeb94d1dc452479acc6f6e639cdd2e95e99a860',
 heroState:'8f33c17d319b887b53a2df5d71862866bb8146e83cd3a2845761a28d59678967',
 advanceFrame:'c491e130558634c4919f33b0b8d154b703351e8685e8c8b50014130e9bfab5fa',
 loop:'90c0e74ce48e117790f343d041168f6ff88f3fa14e2afca3f107d02602768501',
 pause:'8cb8432607c35da6a172741e83af5d1af76a98be2c4b39d6a856cdad75430d9c'
};
function functionSource(html,name){
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,'Fonction originale introuvable : '+name);
 let at=html.indexOf('{',start)+1,depth=1,quote=null,escaped=false;
 for(;at<html.length&&depth;at++){
  const char=html[at];
  if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null}
  else if(char==='"'||char==="'"||char==='`')quote=char;
  else if(char==='{')depth++;
  else if(char==='}')depth--;
 }
 assert.equal(depth,0,'Fonction originale incomplète : '+name);
 return html.slice(start,at);
}
const ready=page=>page.waitForFunction(()=>document.querySelector('#game').dataset.ready==='true');
const screenshot=(page,name)=>page.screenshot({path:path.join(artifactDir,name)});
const hook=`
window.testGame={reset,jump,update,resize,rank,end,draw,scene,drawHero,itemDraw,heroState,collision,addItem,step:advanceFrame,
 state:()=>({mode,score,best,speed,world,ground,player:{...player},obstacles:obstacles.map(o=>({...o})),items:items.map(o=>({...o})),combo,comboTimer,landingTimer,config:{...CONFIG}}),
 quiet:()=>{spawn=1e9;collectSpawn=1e9;obstacles=[];items=[]},
 home:()=>{mode='home';show('home')},
 obstacle:(type='log',x=player.x)=>{const shape=window.BorealMechanics.dimensions[type];obstacles.push({...shape,x,y:ground-(type==='branch'?125:shape.h)})},
 item:(type='berry',x=player.x,y=player.y)=>items.push({type,x,y,w:type==='berry'?18:29,h:type==='berry'?18:16}),
 generateItems:()=>{items=[];random=window.BorealMechanics.rng(42);for(let i=0;i<100;i++)addItem();return items.map(item=>({...item}))},
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
 window.__winterBackdropDraws=[];
 const original=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(...args){
  const source=args[0];
  if(source instanceof HTMLImageElement&&/forest-(panorama|landscape)-noel\.png/.test(source.currentSrc||source.src)){
   window.__winterBackdropDraws.push({src:source.currentSrc||source.src,naturalWidth:source.naturalWidth,naturalHeight:source.naturalHeight});
   if(window.__winterBackdropDraws.length>500)window.__winterBackdropDraws.shift();
  }
  if((source instanceof HTMLImageElement&&/jacques/i.test(source.currentSrc||source.src))||(source instanceof HTMLCanvasElement&&/jacques/i.test(source.dataset.sourceAsset||''))){
   window.__spriteDraws.push({src:source.currentSrc||source.src||source.dataset.sourceAsset,clip:[source.dataset?.frame,...args.slice(1,5)],naturalWidth:source.naturalWidth||source.width,naturalHeight:source.naturalHeight||source.height});
   if(window.__spriteDraws.length>500)window.__spriteDraws.shift();
  }
  return original.apply(this,args);
 };
};
(async()=>{
 fs.mkdirSync(artifactDir,{recursive:true});
 const sourceHTML=fs.readFileSync(path.join(root,'v3/index.html'),'utf8');
 const originalMetadata=JSON.parse(fs.readFileSync(path.join(root,'v3/assets/jacques-atlas.json'),'utf8'));
 for(const [file,hash] of Object.entries(originalFiles))check(sha256(fs.readFileSync(path.join(root,file)))===hash,`${file} strictement identique à la V3 originale`);
 check(['panorama','landscape'].every(kind=>{
  const original=fs.readFileSync(path.join(root,`v3/assets/forest-${kind}.png`));
  const winter=fs.readFileSync(path.join(root,`v3/assets/noel/forest-${kind}-noel.png`));
  return original.readUInt32BE(16)===winter.readUInt32BE(16)&&original.readUInt32BE(20)===winter.readUInt32BE(20)&&sha256(original)!==sha256(winter);
 }),'les deux nouveaux fonds hivernaux conservent exactement les dimensions des originaux');
 for(const [name,hash] of Object.entries(originalFunctions))check(sha256(functionSource(sourceHTML,name))===hash,`fonction ${name} strictement identique à la V3 originale`);
 check(!sourceHTML.includes('window.testGame'),'aucun accès de test présent dans le HTML livré');
 const server=spawn('python3',['-m','http.server','8767','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
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
  const requestedResources=[];
  page.on('request',request=>{requestedResources.push(request.url());if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))externalRequests.push(request.url())});
  await page.goto(origin+'/v3/index.html');await ready(page);
  await page.evaluate(()=>JacquesNoelSprites.ready);
  check(['forest-panorama-noel.png','forest-landscape-noel.png'].every(file=>requestedResources.includes(origin+'/v3/assets/noel/'+file))&&!requestedResources.some(url=>/\/assets\/forest-(panorama|landscape)\.png$/.test(url)),'les requêtes chargent les deux fonds hivernaux distincts par la carte de ressources');
  check(await page.evaluate(()=>Object.entries(BorealNoelAssets.images).length===2&&['panorama','landscape'].every(kind=>BorealEmbeddedAssets.images[`assets/forest-${kind}.png`]===new URL(`assets/noel/forest-${kind}-noel.png`,document.baseURI).href)),'le loader V3 original reçoit exactement la carte des deux fonds de Noël');
  check(await page.locator('#home').isVisible(),'menu Noël et ressources prêts');
  check(await page.locator('#start').isEnabled(),'jeu activé après chargement des sprites');
  check(originalMetadata.frames.length===24&&originalMetadata.frames[6][3]>256&&originalMetadata.frames[3][2]>256,'24 silhouettes originales complètes préservées au-delà de la grille indicative');
  check(await page.evaluate(()=>JacquesNoelSprites.frameCount===24&&JacquesNoelSprites.frameRects().length===24&&JacquesNoelSprites!==window.JacquesSprites),'atlas saisonnier distinct chargé avec ses 24 silhouettes');
  check(await page.evaluate(()=>JacquesNoelSprites.states.every(name=>['idle','run','jump','doubleJump','fall','land','collision'].includes(name))&&JacquesNoelSprites.states.includes('collision')),'états de sprites disponibles');
  check(await page.evaluate(original=>JacquesNoelSprites.states.join('|')===Object.keys(original.animations).join('|')&&JSON.stringify(JacquesNoelSprites.animations)===JSON.stringify(Object.fromEntries(Object.entries(original.animations).map(([name,animation])=>[name,animation.frames]))),originalMetadata),'sept états et séquences originales conservés dans le costume');
  await screenshot(page,'menu-mobile.png');
  await page.click('#how');check(await page.locator('#instructions').isVisible(),'instructions conservées');
  await page.click('#back');await page.click('#start');await page.waitForTimeout(700);
  check(Number((await page.locator('#score').textContent()).replace(/\D/g,''))>0,'partie réelle avance dans Chromium');
  await screenshot(page,'jeu-mobile.png');
  const drawn=await page.evaluate(()=>window.__spriteDraws);
  check(drawn.length>2&&drawn.every(draw=>draw.naturalWidth>0&&draw.naturalHeight>0),'personnage affiché depuis un vrai fichier image chargé');
  const holidayDrawn=drawn.filter(draw=>draw.clip[0]!==undefined);
  check(holidayDrawn.length>2&&holidayDrawn.every(draw=>draw.src.includes('/assets/noel/'))&&new Set(holidayDrawn.map(draw=>JSON.stringify(draw.clip))).size>1,'le vrai jeu anime exclusivement les frames du PNG de Jacques en costume');
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
  const winterDraws=await page.evaluate(()=>window.__winterBackdropDraws);
  check(['panorama','landscape'].every(kind=>winterDraws.some(draw=>draw.src.endsWith(`forest-${kind}-noel.png`)&&draw.naturalWidth>0&&draw.naturalHeight>0)),'les vrais Canvas portrait et paysage dessinent leurs nouveaux PNG hivernaux');
  metrics=await page.evaluate(()=>new Promise(resolve=>{
   const times=[];let previous;
   function frame(time){if(previous!==undefined)times.push(time-previous);previous=time;if(times.length<90)requestAnimationFrame(frame);else{const sorted=[...times].sort((a,b)=>a-b);resolve({samples:times.length,medianFrameMs:sorted[Math.floor(sorted.length/2)],p95FrameMs:sorted[Math.floor(sorted.length*.95)],observedFps:1000/(times.reduce((sum,value)=>sum+value,0)/times.length)})}}
   requestAnimationFrame(frame);
  }));
  check(metrics.samples===90&&Number.isFinite(metrics.observedFps),'mesure du rendu dans Chromium terminée');
  check(errors.length===0,'aucune erreur JavaScript sur les pages réelles');
  check(externalRequests.length===0,'édition Noël autonome sans appel backend ou service de récompenses');
  await live.close();

  const desktop=await browser.newContext({viewport:desktopViewport});
  const desktopPage=await desktop.newPage();
  const desktopErrors=[],desktopExternal=[];
  desktopPage.on('pageerror',error=>desktopErrors.push(error.message));
  desktopPage.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:'))desktopExternal.push(request.url())});
  await desktopPage.goto(origin+'/v3/index.html');await ready(desktopPage);
  check(await desktopPage.locator('#home').isVisible(),'menu Noël réel affiché en 1366×768');
  await screenshot(desktopPage,'menu-desktop.png');
  await desktopPage.click('#start');await desktopPage.waitForTimeout(700);
  check(await desktopPage.locator('#hud').isVisible()&&Number((await desktopPage.locator('#score').textContent()).replace(/\D/g,''))>0,'partie réelle et score actifs en 1366×768');
  await desktopPage.keyboard.press('Space');
  await screenshot(desktopPage,'jeu-desktop.png');
  await desktopPage.click('#pauseBtn');await desktopPage.click('#resume');
  check(await desktopPage.locator('#paused').isHidden(),'pause et reprise au bureau');
  check(desktopErrors.length===0&&desktopExternal.length===0,'aucune erreur JavaScript ni requête externe au bureau');
  await desktop.close();

  // Instrumentation de la réponse HTTP réservée aux tests : aucun hook dans le jeu livré.
  const deterministic=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  await deterministic.addInitScript(()=>{window.requestAnimationFrame=()=>0});
  await deterministic.addInitScript(imageTracker);
  const testPage=await deterministic.newPage();
  const testErrors=[];testPage.on('pageerror',error=>testErrors.push(error.message));
  const html=instrument(sourceHTML);
  await testPage.route('**/v3/test.html',route=>route.fulfill({contentType:'text/html',body:html}));
  await testPage.goto(origin+'/v3/test.html');await ready(testPage);
  const run=fn=>testPage.evaluate(fn);
  const montage=await run(async()=>{
   const [original,metadata]=await Promise.all([fetch('assets/jacques-atlas.json').then(response=>response.json()),fetch('assets/noel/jacques-noel-atlas.json').then(response=>response.json())]);
   const sheet=new Image();sheet.src='assets/noel/'+metadata.image;await sheet.decode();
   const source=document.createElement('canvas');source.width=sheet.naturalWidth;source.height=sheet.naturalHeight;
   const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(sheet,0,0);
   const grid=document.createElement('canvas');grid.width=1140;grid.height=920;
   const output=grid.getContext('2d');output.fillStyle='#122c36';output.fillRect(0,0,grid.width,grid.height);output.imageSmoothingEnabled=false;
   const frameReports=[];
   metadata.frames.forEach(([x,y,w,h],index)=>{
    const image=context.getImageData(x,y,w,h),data=image.data,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let largest=[];
    for(let start=0;start<seen.length;start++){
     if(seen[start]||data[start*4+3]<=30)continue;
     let head=0,tail=1;queue[0]=start;seen[start]=1;
     while(head<tail){const at=queue[head++],px=at%w,py=Math.floor(at/w);for(const next of [px>0?at-1:-1,px+1<w?at+1:-1,py>0?at-w:-1,py+1<h?at+w:-1])if(next>=0&&!seen[next]&&data[next*4+3]>30){seen[next]=1;queue[tail++]=next}}
     if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
    }
    const keep=new Uint8Array(seen.length);let red=0;for(const at of largest){keep[at]=1;const r=data[at*4],g=data[at*4+1],b=data[at*4+2];if(r>90&&r>g*1.5&&r>b*1.1)red++}
    for(let at=0;at<keep.length;at++)if(!keep[at])data[at*4+3]=0;
    const frame=document.createElement('canvas');frame.width=w;frame.height=h;frame.getContext('2d').putImageData(image,0,0);
    const cellX=(index%6)*190,cellY=Math.floor(index/6)*230,scale=Math.min(180/h,178/w);
    output.drawImage(frame,cellX+(190-w*scale)/2,cellY+190-h*scale,w*scale,h*scale);
    const state=Object.entries(metadata.animations).find(([,animation])=>animation.frames.includes(index))?.[0]||'réserve';
    output.fillStyle='#fff1d6';output.font='13px system-ui';output.textAlign='center';output.fillText(`${index} · ${state}`,cellX+95,cellY+216);
    frameReports.push({index,width:w,height:h,pixels:largest.length,red});
   });
   return {dataURL:grid.toDataURL('image/png'),frames:frameReports,animationsMatch:JSON.stringify(original.animations)===JSON.stringify(metadata.animations)};
  });
  fs.writeFileSync(path.join(artifactDir,'jacques-noel-24-poses.png'),Buffer.from(montage.dataURL.split(',')[1],'base64'));
  check(montage.frames.length===24&&montage.frames.every(frame=>frame.pixels>=1000&&frame.red>100),'24 silhouettes de costume contiennent une vraie tenue rouge et forment le montage de revue');
  check(montage.animationsMatch,'cadences, boucles et ordre des animations identiques à la V3 originale');
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
   function scene(world){current={far:[],ferns:[]};BorealNoelScenery.draw(context,{...options,world});positions.push(current)}
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
  check(await run(()=>BorealNoelScenery.base===BorealScenery&&BorealNoelScenery.loaded&&BorealNoelScenery.layers.length===12&&BorealNoelScenery.snowPlanes.length===3&&BorealNoelScenery.particleBudget===84),'décor de Noël ajoute trois plans de neige bornés aux neuf plans originaux');
  const cachedScenery=await run(()=>{
   const canvas=document.createElement('canvas');canvas.width=620;canvas.height=390;
   const context=canvas.getContext('2d');const sprites=Object.values(BorealNoelScenery.sprites).flat(),draws=new Set();
   let created=0;const create=document.createElement.bind(document),drawImage=context.drawImage;
   document.createElement=(...args)=>{if(args[0]==='canvas')created++;return create(...args)};
   context.drawImage=function(...args){if(sprites.includes(args[0]))draws.add(args[0]);return drawImage.apply(this,args)};
   try{for(let i=0;i<30;i++)BorealNoelScenery.draw(context,{width:620,height:390,ground:312,world:i*10,time:i/60})}finally{document.createElement=create}
   return {created,drawn:draws.size};
  });
  check(cachedScenery.created===0&&cachedScenery.drawn>=8,'sapins, poudrerie, neige et guirlande réemploient leurs sprites en cache sans créer de Canvas par image');
  const collectibleRendering=await run(()=>{
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d');const calls=[];
   const original=context.drawImage;context.drawImage=function(...args){calls.push({kind:args[0].dataset.festiveKind,args:args.slice(1)});return original.apply(this,args)};
   const items=BorealNoelCollectibles.kinds.map((festiveKind,index)=>({type:index<2?'berry':'board',x:70,y:90,w:index<2?18:29,h:index<2?18:16,festiveKind}));
   const before=JSON.stringify(items);
   for(const item of items)BorealNoelCollectibles.draw(context,item);
   return {scale:BorealNoelCollectibles.scale,calls,items,unchanged:before===JSON.stringify(items)};
  });
  check(collectibleRendering.scale===1.3&&collectibleRendering.unchanged&&collectibleRendering.calls.length===4&&collectibleRendering.calls.every((call,index)=>{
   const item=collectibleRendering.items[index],args=call.args;
   return Math.abs(args[2]-item.w*1.3)<1e-9&&Math.abs(args[3]-item.h*1.3)<1e-9&&Math.abs(args[0]+args[2]/2-item.x-item.w/2)<1e-9&&Math.abs(args[1]+args[3]/2-item.y-item.h/2)<1e-9;
  }),'quatre sprites festifs réellement dessinés à 1,3× centrés sans modifier les items');
  const collectibleOpaqueBounds=await run(()=>Object.entries(BorealNoelCollectibles.sprites).map(([kind,sprite])=>{
   const pixels=sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;
   let left=sprite.width,top=sprite.height,right=-1,bottom=-1;
   for(let y=0;y<sprite.height;y++)for(let x=0;x<sprite.width;x++)if(pixels[(y*sprite.width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
   return {kind,left,top,right,bottom,width:sprite.width,height:sprite.height};
  }));
  check(collectibleOpaqueBounds.length===4&&collectibleOpaqueBounds.every(bounds=>bounds.left===0&&bounds.top===0&&bounds.right===bounds.width-1&&bounds.bottom===bounds.height-1),'les quatre glyphes occupent réellement les bords de leur cache sans marge transparente');
  const cachedCollectibles=await run(()=>{
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
   const items=BorealNoelCollectibles.kinds.map((festiveKind,index)=>({type:index<2?'berry':'board',x:70,y:90,w:index<2?18:29,h:index<2?18:16,festiveKind}));
   let created=0,draws=0,reused=true;const create=document.createElement.bind(document),drawImage=context.drawImage;
   document.createElement=(...args)=>{if(args[0]==='canvas')created++;return create(...args)};
   context.drawImage=function(...args){draws++;if(!Object.values(BorealNoelCollectibles.sprites).includes(args[0]))reused=false;return drawImage.apply(this,args)};
   try{for(let i=0;i<30;i++)for(const item of items)BorealNoelCollectibles.draw(context,item)}finally{document.createElement=create}
   return {created,draws,reused};
  });
  check(cachedCollectibles.created===0&&cachedCollectibles.draws===120&&cachedCollectibles.reused,'120 dessins des quatre collectibles réemploient les caches sans créer de Canvas');
  const engineHolidayDraws=await run(()=>{
   const result={scene:0,item:0};const scenery=BorealNoelScenery,collectibles=BorealNoelCollectibles;
   window.BorealNoelScenery={...scenery,draw(...args){result.scene++;return scenery.draw(...args)}};
   window.BorealNoelCollectibles={...collectibles,draw(...args){result.item++;return collectibles.draw(...args)}};
   try{testGame.reset();testGame.quiet();testGame.fixtures();testGame.draw()}finally{window.BorealNoelScenery=scenery;window.BorealNoelCollectibles=collectibles}
   return result;
  });
  check(engineHolidayDraws.scene===1&&engineHolidayDraws.item===1,'le vrai moteur appelle les rendus de décor et collectible Noël');
  const animations=await run(()=>{
   const canvas=document.createElement('canvas');canvas.width=130;canvas.height=130;
   const context=canvas.getContext('2d');const clips=[];
   const original=context.drawImage;context.drawImage=function(...args){clips.push([args[0].dataset?.frame,...args.slice(1,5)]);return original.apply(this,args)};
   return ['idle','run','jump','doubleJump','fall','land','collision'].map(state=>{
    clips.length=0;
    for(let i=0;i<=9;i++)JacquesNoelSprites.draw(context,{x:45,y:70,w:27,h:53},state,i*.1);
    return {state,frames:new Set(clips.map(clip=>clip.join(','))).size};
   });
  });
  check(animations.every(animation=>animation.frames>=2),'chaque état demandé possède plusieurs frames PNG réellement dessinées');
  await run(()=>{
   window.__drawStates=[];
   const renderer=JacquesNoelSprites;
   window.JacquesNoelSprites={...renderer,draw(...args){window.__drawStates.push(args[2]);return renderer.draw.apply(renderer,args)}};
   testGame.home();testGame.draw();testGame.reset();testGame.quiet();testGame.draw();
  });
  check(await run(()=>testGame.state().speed>240),'vitesse initiale supérieure à la V2.1');
  check(await run(()=>{
   const c=testGame.state().config;
   return c.initialSpeed===315&&c.maxSpeed===530&&c.acceleration===2.8&&c.gravity===1520&&c.firstJump===-565&&c.secondJump===-510&&c.maxJumps===2&&c.playerWidth===32&&c.playerHeight===72&&c.progressPointsPerSecond===22&&c.comboSeconds===2.7&&c.comboCap===5&&c.comboBonus===25&&c.fixedStep===1/120&&c.maxFrameSeconds===.1;
  }),'vitesses, gravité, impulsions, corps et constantes de score originaux');
  check(await run(()=>{
   const expected={rock:[36,30],log:[58,38],stump:[36,58],high:[46,126],branch:[72,19]};
   return Object.entries(expected).every(([type,[w,h]])=>BorealMechanics.dimensions[type].w===w&&BorealMechanics.dimensions[type].h===h);
  }),'cinq variantes et dimensions originales des obstacles');
  const generatedItems=await run(()=>testGame.generateItems());
  check(new Set(generatedItems.map(item=>item.type)).size===2&&generatedItems.every(item=>item.w===(item.type==='berry'?18:29)&&item.h===(item.type==='berry'?18:16)),'génération des deux collectibles conserve les boîtes logiques 18×18 et 29×16');
  await run(()=>{testGame.reset();testGame.quiet()});
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
  await run(()=>{for(let i=0;i<240&&!testGame.state().player.grounded;i++)testGame.update(1/120);testGame.draw()});
  check(await run(()=>testGame.state().player.grounded&&testGame.state().player.jumps===0),'atterrissage recharge les deux sauts');
  check(await run(()=>window.__drawStates.includes('land')&&window.__drawStates.includes('idle')),'le vrai moteur affiche aussi les poses costume de repos et d’atterrissage');
  const collectibleScores=await run(()=>{
   testGame.reset();testGame.quiet();const deltas=[];
   for(const type of ['berry','board','berry','board','berry','board']){
    const before=testGame.state().score;testGame.item(type);testGame.update(1/120);
    deltas.push({type,delta:testGame.state().score-before-22/120,combo:testGame.state().combo});
   }
   return deltas;
  });
  check(collectibleScores.every(({type,delta,combo})=>Math.abs(delta-(type==='berry'?50:125)-Math.min(combo,5)*25)<1e-8),'scores exacts 50/125 et combo +25 plafonné à cinq conservés');
  check(collectibleScores.map(row=>row.combo).join(',')==='1,2,3,4,5,6','combo progresse à chaque collecte');
  await run(()=>{testGame.reset();testGame.quiet();const p=testGame.state().player;testGame.item('berry',p.x+p.w-9.5,p.y+10);testGame.draw();testGame.update(0)});
  check(await run(()=>testGame.state().combo===0&&testGame.state().items[0].w===18&&testGame.state().items[0].h===18),'débordement visuel du collectible ne modifie pas sa collision logique');
  await run(()=>{testGame.item();testGame.update(1/120)});
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
  for(const type of ['rock','log','stump','high','branch']){
   await testPage.evaluate(type=>{testGame.reset();testGame.quiet();testGame.obstacle(type);if(type==='branch')testGame.jump();for(let i=0;i<30;i++)testGame.update(1/120)},type);
   check(await run(()=>testGame.state().mode==='over'),`collision effective avec la variante ${type}`);
  }
  await run(()=>{testGame.reset();testGame.quiet();testGame.obstacle();testGame.update(1/120);testGame.draw()});
  check(await run(()=>testGame.state().mode==='over'),'collision termine la partie');
  check(await run(()=>window.__drawStates.includes('collision')),'sprite de collision utilisé par le jeu');
  check(await run(()=>['idle','run','jump','doubleJump','fall','land','collision'].every(state=>window.__drawStates.includes(state))),'sept états du costume transmis par le vrai moteur au renderer');
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

  const noelScripts=Array.from(sourceHTML.matchAll(/<script[^>]+src=["']([^"']*noel[^"']*)["']/gi),match=>match[1]);
  check(noelScripts.length===4,'quatre modules visuels Noël chargés par le HTML livré');
  const missingResources=[...noelScripts,'assets/noel/jacques-noel-atlas.png','assets/noel/jacques-noel-atlas.json','assets/noel/forest-panorama-noel.png','assets/noel/forest-landscape-noel.png'];
  for(const [index,resource] of missingResources.entries()){
   const unavailable=await browser.newContext({viewport,isMobile:true,hasTouch:true});
   const resourceURL=new URL(resource,origin+'/v3/index.html').href;
   let blocked=0;
   await unavailable.route(resourceURL,route=>{blocked++;return route.abort()});
   const failurePage=await unavailable.newPage();
   await failurePage.goto(origin+'/v3/index.html');
   await failurePage.locator('#assetError').waitFor({state:'visible'});
   check(blocked>0&&await failurePage.locator('#start').isDisabled(),`${resource} manquant bloque le démarrage`);
   check((await failurePage.locator('#assetError').textContent()).trim().length>15,`${resource} manquant affiche une erreur explicite`);
   await screenshot(failurePage,`ressource-manquante-${index+1}.png`);
   await unavailable.unroute(resourceURL);
   await failurePage.click('#reloadAssets');await ready(failurePage);
   check(await failurePage.locator('#start').isEnabled()&&await failurePage.locator('#assetError').isHidden(),`${resource} rétabli permet de recharger et jouer`);
   await unavailable.close();
  }
  fs.writeFileSync(path.join(artifactDir,'results.json'),JSON.stringify({checks,results,testedAt:new Date().toISOString(),originalCommit:'106dfa8',chromiumVersion:browser.version(),viewports:[viewport,desktopViewport,{width:320,height:568},{width:844,height:390}],renderMetrics:metrics,costumeFrames:montage.frames,limitations:['Chromium headless; aucun téléphone physique testé.','Les captures de sauts et collision contrôlent le temps de simulation du vrai moteur.','Le montage isole les 24 silhouettes du véritable atlas PNG saisonnier.','Le débit observé ne garantit pas les performances sur mobile.']},null,2)+'\n');
  console.log(`${checks} contrôles Noël réussis. Mesure Chromium : ${metrics.observedFps.toFixed(1)} images/s observées.`);
 }finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
