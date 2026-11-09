/* Christmas sky decoration. This cached artwork has no gameplay state. */
(() => {
 'use strict';
 const base=document.currentScript?.src||document.baseURI;
 const image=new Image();
 const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 let sprite=null,sourceBounds=null;
 const glow=document.createElement('canvas');glow.width=64;glow.height=64;
 const gc=glow.getContext('2d'),gradient=gc.createRadialGradient(32,32,0,32,32,30);
 gradient.addColorStop(0,'rgba(255,110,90,1)');gradient.addColorStop(.22,'rgba(255,35,45,.9)');gradient.addColorStop(.6,'rgba(255,18,40,.27)');gradient.addColorStop(1,'rgba(255,18,40,0)');
 gc.fillStyle=gradient;gc.fillRect(0,0,64,64);
 const ready=new Promise((resolve,reject)=>{
  image.onerror=()=>reject(new Error('Le traîneau de Noël n’a pas pu être chargé.'));
  image.onload=()=>{
   try {
    const scan=document.createElement('canvas');scan.width=image.naturalWidth;scan.height=image.naturalHeight;
    const c=scan.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
    const pixels=c.getImageData(0,0,scan.width,scan.height).data;
    let minX=scan.width,minY=scan.height,maxX=-1,maxY=-1;
    for(let y=0;y<scan.height;y++)for(let x=0;x<scan.width;x++)if(pixels[(y*scan.width+x)*4+3]>30){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(maxX<minX||maxY<minY)throw new Error('Traîneau vide.');
    sourceBounds=Object.freeze({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
    sprite=document.createElement('canvas');sprite.width=sourceBounds.w;sprite.height=sourceBounds.h;sprite.dataset.decorativeKind='santa-sleigh-six-reindeer';
    sprite.getContext('2d').drawImage(image,minX,minY,sprite.width,sprite.height,0,0,sprite.width,sprite.height);
    resolve(Object.freeze({loaded:true,reindeerCount:6}));
   }catch(error){reject(error);}
  };
  image.src=new URL('assets/noel/santa-sleigh-six-reindeer.png',base).href;
 });
 function layout({width:W,height:H,world=0,time=0}){
  const landscape=W>H;
  const w=landscape?Math.min(W*.5,300):Math.min(W*.9,440),h=sourceBounds?w*sourceBounds.h/sourceBounds.w:0;
  const reduced=!!motion?.matches,span=W+w+64;
  let x=(landscape?18:(W-w)/2)+(reduced?0:(world*.012+time*7)%span);
  if(x>W+32)x-=span;
  const y=(landscape?38:H<=650?34:Math.max(58,Math.min(140,H*.165)))+(reduced?0:Math.sin(time*.65)*4);
  const scale=sourceBounds?w/sourceBounds.w:0;
  return {x,y,w,h,noseX:x+(2151-(sourceBounds?.x||0))*scale,noseY:y+(296-(sourceBounds?.y||0))*scale,noseAlpha:reduced ? .8 : .45+.55*(Math.sin(time*Math.PI*2)+1)/2};
 }
 function draw(c,options){
  if(!sprite)return;
  const p=layout(options),radius=Math.max(1.6,p.w/180),halo=radius*7;
  c.save();c.imageSmoothingEnabled=false;
  c.drawImage(sprite,p.x,p.y,p.w,p.h);
  c.globalAlpha=p.noseAlpha;c.drawImage(glow,p.noseX-halo/2,p.noseY-halo/2,halo,halo);
  c.globalAlpha=1;c.fillStyle=p.noseAlpha>.7?'#ff3045':'#a20f27';c.beginPath();c.arc(p.noseX,p.noseY,radius,0,Math.PI*2);c.fill();
  c.globalAlpha=p.noseAlpha;c.fillStyle='#ffd3c4';c.fillRect(p.noseX-radius*.4,p.noseY-radius*.5,Math.max(1,radius*.5),Math.max(1,radius*.5));
  c.restore();
 }
 window.BorealNoelSleigh=Object.freeze({ready,draw,layout,image,reindeerCount:6,get sprite(){return sprite;},get sourceBounds(){return sourceBounds;}});
})();
