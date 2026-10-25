const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../v3/expeditions.js');
const M=globalThis.BorealMechanics;
const fixtures=require('./fixtures/expeditions-inputs.json');

// Recorded button presses are replayed against the untouched engine. No scores,
// objects, collision flags or player coordinates are modified during a run.
function replay(input){
 const state=E.create(input.seed,input.width,input.height,input.routeId);
 let index=0;
 while(!state.ended){
  const jump=input.jumps[index]===state.ticks;
  if(jump)index++;
  E.step(state,jump);
 }
 assert.equal(index,input.jumps.length,'every recorded input was consumed');
 return state;
}

const completed=Object.fromEntries(Object.entries(fixtures).map(([id,input])=>[id,replay(input)]));

test('finite boards and elapsed time prove the advertised mathematical score ceilings',()=>{
 const nextThreshold={r0:5000,r1:7500,r2:10000};
 for(const [id,route] of Object.entries(E.configs)){
  assert.equal(route.maxItems,route.groups*route.boardsPerGroup);
  assert.equal(route.maxScore,route.seconds*22+route.maxItems*250);
  if(nextThreshold[id])assert(route.maxScore<nextThreshold[id],id+' ceiling crosses next tier');
  const s=E.create(1,390,844,id);
  assert.equal(s.schedule.items.length,route.maxItems);
  assert(s.schedule.items.every((tick,index,ticks)=>tick<route.seconds*120&&(index===0||tick>ticks[index-1])));
 }
});

test('recorded jump inputs reach every refuge with the full obstacle generator and actual scores',()=>{
 assert.deepEqual(Object.keys(fixtures).sort(),Object.keys(E.configs).sort());
 const intendedTier={r0:0,r1:5,r2:10,r3:20};
 for(const [id,input] of Object.entries(fixtures)){
  const s=completed[id];
  assert.equal(input.routeId,id);
  assert(input.jumps.every((tick,index,ticks)=>Number.isInteger(tick)&&tick>=0&&(index===0||tick>ticks[index-1])));
  assert.equal(s.reason,'arrival',id);assert.equal(s.arrived,true,id);assert.equal(s.finished,true,id);
  assert.equal(s.ticks,s.route.seconds*120,id);assert.equal(s.ticks,input.ticks,id);
  assert(Math.abs(s.score-input.score)<1e-7,id+' recorded score');
  assert(s.score<=s.route.maxScore,id+' score ceiling');
  assert.equal(E.result(s.score),intendedTier[id],id+' earned reward tier');
  assert(s.collected>0&&s.collected<=s.route.maxItems,id+' actual board pickups');
  assert.equal(E.progress(s),1,id);
  // This conservative floor follows the original maximum encounter wait. It
  // catches replacing the V3 generator with a few sparse scripted hazards.
  const minimum=Math.floor((s.route.seconds-4-1.9)/2.87);
  assert(s.spawnedHazards>=minimum,`${id}: only ${s.spawnedHazards} hazards`);
  assert.equal(s.spawnedHazards,s.hazardSpawns.length,id);
  for(let i=1;i<s.hazardSpawns.length;i++){
   const before=s.hazardSpawns[i-1],after=s.hazardSpawns[i];
   assert(Math.abs((after.tick-before.tick)/120-before.nextSpawn)<1/120+1e-8,id+' original spawn timing');
  }
  assert(s.hazardSpawns.every(o=>o.tick/120<s.route.seconds-4),id+' final approach');
 }
});

test('successful ordinary play retains all five original progressive obstacle variants',()=>{
 const counts=completed.r3.hazardCounts;
 assert.deepEqual(Object.keys(counts).sort(),['branch','high','log','rock','stump']);
 for(const [kind,count] of Object.entries(counts))assert(count>0,kind+' absent from the successful expedition');
 assert(completed.r3.hazardSpawns.some(o=>o.type==='high'&&o.score>=1800));
 assert(completed.r3.hazardSpawns.some(o=>o.type==='branch'&&o.score>=2700));
});

test('each original obstacle variant produces a real collision',()=>{
 for(const kind of ['rock','log','stump','high','branch']){
  const s=E.create(1,390,844,'r0'),shape=M.dimensions[kind];
  s.obstacles=[{...shape,x:s.player.x,y:s.ground-(kind==='branch'?125:shape.h)}];
  if(kind==='branch'){s.player.y=s.ground-140;s.player.grounded=false;}
  E.step(s,false);
  assert.equal(s.reason,'collision',kind);assert.equal(s.arrived,false,kind);assert.equal(s.finished,false,kind);
 }
});

test('a normal collision freezes score, time and progression on every route',()=>{
 for(const id of Object.keys(E.configs)){
  const s=E.create(1,390,844,id);
  while(!s.ended)E.step(s,false);
  assert.equal(s.reason,'collision',id);assert.equal(s.arrived,false);assert.equal(s.finished,false);
  assert(s.ticks<s.route.seconds*120);assert(s.score<s.route.maxScore);
  const before=JSON.stringify(s),progress=E.progress(s);
  for(let i=0;i<240;i++)E.step(s,true);
  assert.equal(JSON.stringify(s),before,id);assert.equal(E.progress(s),progress,id);
 }
});

test('the same seed and recorded input reproduce the entire expedition',()=>{
 for(const [id,input] of Object.entries(fixtures)){
  const again=replay(input),first=completed[id];
  for(const property of ['ticks','score','reason','collected','world','player','items','obstacles','spawnedHazards','hazardCounts','hazardSpawns'])assert.deepEqual(again[property],first[property],id+'/'+property);
 }
});

test('the original double jump refuses a third jump and resets on landing',()=>{
 const s=E.create(1,390,844,'r0');
 E.step(s,true);assert.equal(s.player.jumps,1);assert.equal(s.player.vy,E.physics.firstJump+E.physics.gravity/120);
 E.step(s,true);assert.equal(s.player.jumps,2);assert.equal(s.player.vy,E.physics.secondJump+E.physics.gravity/120);
 const velocity=s.player.vy;E.step(s,true);assert.equal(s.player.jumps,2);assert(s.player.vy>velocity);
 while(!s.player.grounded)E.step(s,false);
 assert.equal(s.player.jumps,0);assert.equal(s.player.vy,0);
 assert.equal(E.physics.gravity,1520);assert.equal(E.physics.firstJump,-565);assert.equal(E.physics.secondJump,-510);
 assert.equal(E.physics.fixedStep,1/120);
});

test('valid mobile, landscape and desktop dimensions retain the same original physics',()=>{
 for(const [width,height] of [[280,420],[320,568],[390,844],[620,390],[1366,768]]){
  const s=E.create(42,width,height,'r0');
  assert.equal(s.ground,Math.round(height*.8));
  assert.equal(s.player.w,32);assert.equal(s.player.h,72);
  E.step(s,true);assert.equal(s.player.vy,-565+1520/120);assert.equal(s.player.jumps,1);
 }
});

test('demonstration results use only the single highest earned tier and reject invalid inputs',()=>{
 for(const [score,value] of [[0,0],[4999,0],[5000,5],[7499,5],[7500,10],[9999,10],[10000,20],[40000,20]])assert.equal(E.result(score),value);
 for(const score of [-1,NaN,Infinity])assert.throws(()=>E.result(score));
 for(const id of ['missing','__proto__','toString'])assert.throws(()=>E.create(1,390,844,id));
 for(const seed of [-1,1.5,NaN,Infinity,4294967296])assert.throws(()=>E.create(seed,390,844,'r0'));
 for(const [width,height] of [[10,844],[390,10],[1601,844],[390,2001],[NaN,844],[390,Infinity]])assert.throws(()=>E.create(1,width,height,'r0'));
});
