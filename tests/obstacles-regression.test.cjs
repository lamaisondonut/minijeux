const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../v3/expeditions.js');const M=globalThis.BorealMechanics;
test('restored generator keeps V3 density through collectible groups',()=>{
 for(const route of Object.keys(E.configs)){
  const s=E.create(123,390,844,route);
  // Diagnostic only: moving the test avatar offscreen lets us measure the entire
  // spawn schedule independently of skill. This does NOT prove playability.
  s.player.x=-100000;
  while(!s.ended)E.step(s,false);
  const active=s.route.seconds-4;
  assert(s.spawnedHazards>=Math.floor((active-1.9)/2.87),`${route}: density regressed (${s.spawnedHazards})`);
  assert(Math.abs(s.hazardSpawns[0].tick/120-1.9)<=1/120+.00001);
  for(let i=1;i<s.hazardSpawns.length;i++){
   const prev=s.hazardSpawns[i-1],next=s.hazardSpawns[i];
   assert(Math.abs((next.tick-prev.tick)/120-prev.nextSpawn)<1/120+.00001,`${route}: generator gap changed`);
  }
  assert(s.hazardSpawns.every(o=>o.tick/120<active));
 }
});
test('original progressive generator retains rock,log,stump,high stump and branch',()=>{
 const found=new Set();
 for(let seed=0;seed<20;seed++){
  const s=E.create(seed,390,844,'r3');s.player.x=-100000;
  // Controlled diagnostic score unlocks every existing obstacle variant.
  s.score=3000;
  while(!s.ended)E.step(s,false);
  for(const [type,count]of Object.entries(s.hazardCounts))if(count)found.add(type);
 }
 assert.deepEqual([...found].sort(),['branch','high','log','rock','stump']);
});
test('all five obstacle variants retain real collisions',()=>{
 for(const key of ['rock','log','stump','high','branch']){
  const s=E.create(1,390,844,'r0'),shape=M.dimensions[key];
  s.obstacles=[{...shape,x:s.player.x,y:s.ground-(key==='branch'?125:shape.h)}];
  if(key==='branch'){s.player.y=s.ground-140;s.player.grounded=false;}
  E.step(s,false);assert.equal(s.reason,'collision',key);
 }
});
