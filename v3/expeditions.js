/* Finite, playable expeditions for the demonstration only. No real rewards,
 * credentials, server authority or monetary budget live in this module. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) require('./mechanics.js');
  const api = factory(root.BorealMechanics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BorealExpeditions = api;
})(typeof globalThis === 'object' ? globalThis : this, function (mechanics) {
  'use strict';
  if(!mechanics)throw new Error('Original V3 mechanics must load before expeditions');
  const DT = 1 / 120;
  const physics = Object.freeze({initialSpeed:315,maxSpeed:530,acceleration:2.8,gravity:1520,firstJump:-565,secondJump:-510,maxJumps:2,playerWidth:32,playerHeight:72,fixedStep:DT});
  // The score ceiling is a mathematical upper bound: elapsed time contributes
  // at most 22 points/s and each of the finite boards contributes at most 250.
  // Scores are never clamped. Unsafe collectibles may be omitted by the same
  // placement rules as V3; this reduces actual points without changing rules.
  const configs = Object.freeze({
    r0:Object.freeze({id:'r0',seconds:45,groups:3,boardsPerGroup:4,maxItems:12,maxScore:3990,name:'La clairière'}),
    r1:Object.freeze({id:'r1',seconds:90,groups:4,boardsPerGroup:5,maxItems:20,maxScore:6980,name:'Le sentier du lac'}),
    r2:Object.freeze({id:'r2',seconds:120,groups:4,boardsPerGroup:7,maxItems:28,maxScore:9640,name:'La traversée des pins'}),
    r3:Object.freeze({id:'r3',seconds:150,groups:5,boardsPerGroup:8,maxItems:40,maxScore:13300,name:'La grande expédition'})
  });
  function rng(seed) {
    let n = seed >>> 0;
    return function () {n=(n+0x6D2B79F5)>>>0;let x=Math.imul(n^(n>>>15),1|n);x^=x+Math.imul(x^(x>>>7),61|x);return((x^(x>>>14))>>>0)/4294967296;};
  }
  const collision=(a,b)=>a.x+5<b.x+b.w-5&&a.x+a.w-5>b.x+5&&a.y+5<b.y+b.h-5&&a.y+a.h-5>b.y+5;
  function schedule(route) {
    const items=[],span=(route.boardsPerGroup-1)*1.25;
    const lastStart=route.seconds-7-span;
    for(let group=0;group<route.groups;group++){
      const start=4+(lastStart-4)*group/(route.groups-1);
      for(let i=0;i<route.boardsPerGroup;i++)items.push(Math.round((start+i*1.25)/DT));
    }
    return {items};
  }
  function create(seed,width,height,routeId) {
    if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid expedition seed');
    if(!Number.isFinite(width)||width<280||width>1600||!Number.isFinite(height)||height<280||height>2000)throw new Error('Invalid expedition dimensions');
    if(!Object.prototype.hasOwnProperty.call(configs,routeId))throw new Error('Unknown expedition');
    const route=configs[routeId];
    const ground=Math.round(height*.8);
    return {routeId,route,width,height,ground,random:rng(seed),schedule:schedule(route),nextItem:0,spawn:1.9,spawnedHazards:0,hazardCounts:{rock:0,log:0,stump:0,high:0,branch:0},hazardSpawns:[],ticks:0,elapsed:0,world:0,score:0,speed:physics.initialSpeed,combo:0,comboTimer:0,landingTimer:0,obstacles:[],items:[],collected:0,finished:false,ended:false,arrived:false,reason:null,player:{x:72,y:ground-physics.playerHeight,w:physics.playerWidth,h:physics.playerHeight,vy:0,grounded:true,jumps:0,run:0}};
  }
  function step(s,jump) {
    if(s.ended)return s;
    const p=s.player;
    if(jump&&p.jumps<physics.maxJumps){p.vy=p.jumps===0?physics.firstJump:physics.secondJump;p.grounded=false;p.jumps++;}
    s.ticks++;s.elapsed=s.ticks*DT;
    s.speed=Math.min(physics.maxSpeed,physics.initialSpeed+Math.sqrt(s.score)*physics.acceleration);s.world+=s.speed*DT;
    s.score+=22*DT;s.comboTimer-=DT;if(s.comboTimer<=0)s.combo=0;
    s.spawn-=DT;
    // Preserve the original V3 generator and encounter spacing. Only the final
    // approach to the refuge suppresses new spawns; existing hazards stay live.
    if(s.spawn<=0&&s.elapsed<s.route.seconds-4){
      const next=mechanics.nextObstacle({width:s.width,ground:s.ground,score:s.score,speed:s.speed,rng:s.random});
      s.obstacles.push(next.obstacle);s.spawn=next.nextSpawn;s.spawnedHazards++;
      const kind=next.obstacle.variant==='high'?'high':next.obstacle.type;
      s.hazardCounts[kind]++;s.hazardSpawns.push({tick:s.ticks,type:kind,score:s.score,nextSpawn:next.nextSpawn});
      if(kind==='branch'||kind==='high')s.items=s.items.filter(it=>it.x+it.w<next.obstacle.x-100||it.x>next.obstacle.x+next.obstacle.w+100);
    }
    while(s.nextItem<s.schedule.items.length&&s.schedule.items[s.nextItem]<=s.ticks){
      const x=s.width+25,y=mechanics.recommendCollectibleY({x,ground:s.ground,type:'board',obstacles:s.obstacles,rng:s.random});
      if(y!==null)s.items.push({type:'board',x,y,w:29,h:16,taken:false});
      s.nextItem++;
    }
    s.landingTimer=Math.max(0,s.landingTimer-DT);p.run+=DT*12;p.vy+=physics.gravity*DT;p.y+=p.vy*DT;
    if(p.y>=s.ground-p.h){if(!p.grounded)s.landingTimer=.12;p.y=s.ground-p.h;p.vy=0;p.grounded=true;p.jumps=0;}
    for(const o of s.obstacles)o.x-=s.speed*DT;for(const it of s.items)it.x-=s.speed*DT;
    s.obstacles=s.obstacles.filter(o=>o.x+o.w>-30);s.items=s.items.filter(it=>it.x+it.w>-30&&!it.taken);
    if(s.obstacles.some(o=>collision(p,o))){s.ended=true;s.reason='collision';return s;}
    for(const it of s.items)if(collision(p,it)){it.taken=true;s.collected++;s.combo=s.comboTimer>0?s.combo+1:1;s.comboTimer=2.7;s.score+=125+Math.min(s.combo,5)*25;}
    if(s.ticks>=Math.round(s.route.seconds/DT)){s.finished=true;s.arrived=true;s.ended=true;s.reason='arrival';}
    return s;
  }
  function result(score) {
    if(!Number.isFinite(score)||score<0)throw new Error('Invalid demonstration score');
    return score>=10000?20:score>=7500?10:score>=5000?5:0;
  }
  function progress(s) {return Math.min(1,s.ticks/Math.round(s.route.seconds/DT));}
  return Object.freeze({configs,physics,create,step,progress,result});
});
