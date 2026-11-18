/* Decorative home canvas only; never resizes or changes the game's canvas. */
(() => {
 'use strict';
 const home=document.getElementById('home'),stage=home?.querySelector('.boreal-home-scene');
 const sprites=window.JacquesNoelSprites,sleigh=window.BorealNoelSleigh,scenery=window.BorealNoelScenery;
 if(!stage||!sprites||!sleigh||!scenery)return;
 const canvas=document.createElement('canvas');canvas.id='boreal-home-art';canvas.setAttribute('aria-hidden','true');home.prepend(canvas);
 const ctx=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
 let loaded=false,frame=0,last=0,started=0;
 function draw(now=0){
  if(!loaded||home.classList.contains('off')||document.hidden)return;
  const w=home.clientWidth,h=home.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=false;
  const reduced=motion.matches,t=reduced?0:(now-started)/1000;
  const parent=canvas.getBoundingClientRect(),bounds=stage.getBoundingClientRect(),mobile=w<900&&(h>500||h>=w);
  // Original six-reindeer artwork and red-nose animation, enlarged in the home sky.
  const sw=mobile?Math.min(w*.88,470):Math.min(w*.43,600),logicalW=620,logicalH=900;
  const base=sleigh.layout({width:logicalW,height:logicalH,time:t}),factor=sw/base.w;
  const sx=mobile?(w-sw)/2:Math.min(w-sw-30,bounds.left-parent.left+10);
  const sy=mobile?(h<=710?30:Math.max(34,Math.min(65,h*.065))):Math.max(52,Math.min(95,h*.11));
  ctx.save();ctx.translate(sx-base.x*factor,sy-base.y*factor);ctx.scale(factor,factor);sleigh.draw(ctx,{width:logicalW,height:logicalH,time:t});ctx.restore();
  // A light strand uses the cached seasonal sprite, without covering the text.
  const garland=scenery.sprites.festoon;
  if(garland)for(let x=0;x<w;x+=garland.width)ctx.drawImage(garland,x,-7);
  // A stable stage keeps Jacques clear of title and commands on every format.
  const heroHeight=Math.min(bounds.height*.95,mobile?220:390),size=heroHeight/80;
  const x=bounds.left-parent.left+bounds.width*.54,y=bounds.bottom-parent.top-4;
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(size,size);sprites.draw(ctx,{x:-17,y:-58,w:34,h:58},'idle',t);ctx.restore();
  // Sparse deterministic flakes; no allocations or external assets per frame.
  ctx.fillStyle='#f4f7f0';
  for(let i=0;i<34;i++){const px=(i*113+Math.sin(t*.25+i)*9)%w,py=(i*83+(reduced?0:t*(8+i%5)))%h;ctx.globalAlpha=.2+(i%3)*.12;ctx.fillRect(Math.round(px),Math.round(py),i%4===0?2:1,2)}
  ctx.globalAlpha=1;
 }
 function tick(now){frame=0;if(home.classList.contains('off')||document.hidden||motion.matches)return;if(now-last>=50){draw(now);last=now}frame=requestAnimationFrame(tick)}
 function refresh(){if(!loaded)return;draw(performance.now());if(!frame&&!motion.matches&&!home.classList.contains('off')&&!document.hidden)frame=requestAnimationFrame(tick)}
 new ResizeObserver(refresh).observe(home);
 new MutationObserver(refresh).observe(home,{attributes:true,attributeFilter:['class']});
 window.addEventListener('resize',refresh);window.addEventListener('boreal:menu-layout',refresh);document.addEventListener('visibilitychange',refresh);motion.addEventListener('change',refresh);
 Promise.all([sprites.ready,sleigh.ready,scenery.ready]).then(()=>{loaded=true;started=performance.now();refresh()}).catch(()=>{/* The existing game asset screen reports loading failures. */});
})();
