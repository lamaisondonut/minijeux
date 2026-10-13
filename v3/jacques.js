/* Atlas original basé sur la maquette et la photo de Jacques. Aucun personnage de substitution. */
(()=>{
'use strict';
const base=document.currentScript?.src||document.baseURI,sheet=new Image(),embedded=window.BorealEmbeddedAssets;
const imageURL=path=>embedded?.images[path]||new URL(path,base).href;
const stateFrames={},rates={},loops=new Set();
let frames=[],scale=1,lastState='',stateStarted=0,lastTime=0;
const imageReady=new Promise((resolve,reject)=>{sheet.onload=resolve;sheet.onerror=()=>reject(new Error('Atlas Jacques inaccessible'));sheet.src=imageURL('assets/jacques-atlas.png')});
const metadataReady=embedded?.jacques?Promise.resolve(embedded.jacques):fetch(new URL('assets/jacques-atlas.json',base)).then(r=>{if(!r.ok)throw new Error('Animations Jacques inaccessibles');return r.json()});
const ready=Promise.all([imageReady,metadataReady]).then(([,metadata])=>{
 if(!sheet.naturalWidth||!sheet.naturalHeight)throw new Error('Atlas vide');
 for(const [name,animation] of Object.entries(metadata.animations)){stateFrames[name]=animation.frames;rates[name]=animation.fps;if(animation.loop)loops.add(name)}
 const source=document.createElement('canvas');source.width=sheet.naturalWidth;source.height=sheet.naturalHeight;
 const c=source.getContext('2d',{willReadFrequently:true});c.drawImage(sheet,0,0);
 const pixels=c.getImageData(0,0,source.width,source.height).data;
 for(let index=0;index<metadata.frames.length;index++){
  const [sx,sy,sw,sh]=metadata.frames[index];
  if(sw<1||sh<1||sx<0||sy<0||sx+sw>source.width||sy+sh>source.height)throw new Error('Rectangle d’animation invalide');
  const image=c.getImageData(sx,sy,sw,sh),data=image.data,seen=new Uint8Array(sw*sh),queue=new Int32Array(sw*sh);
  let largest=[];
  // Isoler la silhouette complète ; une tête de frame voisine peut dépasser dans son rectangle.
  for(let start=0;start<seen.length;start++){
   if(seen[start]||data[start*4+3]<=30)continue;
   let head=0,tail=1;queue[0]=start;seen[start]=1;
   while(head<tail){const at=queue[head++],x=at%sw,y=Math.floor(at/sw);
    const next=[x>0?at-1:-1,x+1<sw?at+1:-1,y>0?at-sw:-1,y+1<sh?at+sw:-1];
    for(const n of next)if(n>=0&&!seen[n]&&data[n*4+3]>30){seen[n]=1;queue[tail++]=n}
   }
   if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
  }
  if(largest.length<1000)throw new Error('Silhouette manquante : '+index);
  const keep=new Uint8Array(seen.length);for(const at of largest)keep[at]=1;
  for(let at=0;at<keep.length;at++)if(!keep[at])data[at*4+3]=0;
  const frame=document.createElement('canvas');frame.width=sw;frame.height=sh;frame.dataset.sourceAsset=sheet.src;frame.dataset.frame=String(index);
  frame.getContext('2d').putImageData(image,0,0);
  frames.push({image:frame,sw,sh});
 }
 // Une échelle commune conserve les proportions et les pieds restent alignés.
 scale=80/frames[stateFrames.idle[0]].sh;
});
function draw(ctx,player,state,time){
 if(!frames.length)return;
 if(!stateFrames[state])state='idle';
 if(lastState!==state||time<lastTime){stateStarted=time;lastState=state}
 lastTime=time;
 const animation=stateFrames[state],elapsed=Math.max(0,time-stateStarted),step=Math.floor(elapsed*rates[state]);
 const index=animation[loops.has(state)?step%animation.length:Math.min(step,animation.length-1)];
 const f=frames[index],w=f.sw*scale,h=f.sh*scale;
 ctx.imageSmoothingEnabled=false;
 ctx.drawImage(f.image,0,0,f.sw,f.sh,Math.round(player.x+player.w/2-w/2),Math.round(player.y+player.h-h),Math.round(w),Math.round(h));
}
window.JacquesSprites={ready,draw,states:['idle','run','jump','doubleJump','fall','land','collision'],animations:stateFrames,frameCount:24,frameRects:()=>frames.map(f=>({width:f.sw,height:f.sh}))};
})();
