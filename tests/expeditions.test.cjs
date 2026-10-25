const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../v3/expeditions.js');

// This driver is a deterministic test input generator, not part of the demo.
// Each object remains an ordinary collectible/hazard governed by V3 physics.
function play(seed,width,height,routeId,driver=true){
 const state=E.create(seed,width,height,routeId),log=[];
 while(!state.ended){
  const target=[...state.items.filter(item=>!item.taken),...state.obstacles]
   .filter(item=>item.x+item.w>state.player.x+5).sort((a,b)=>a.x-b.x)[0];
  const jump=!!(driver&&state.player.grounded&&target&&target.x-state.player.x<state.speed*.28);
  if(jump)log.push(state.ticks);
  E.step(state,jump);
 }
 return {state,log};
}

test('finite item count and time prove ceilings below the next reward tier',()=>{
 const thresholds={r0:5000,r1:7500,r2:10000};
 for(const [id,route] of Object.entries(E.configs)){
  assert.equal(route.maxItems,route.groups*route.boardsPerGroup);
  assert.equal(route.maxScore,route.seconds*22+route.maxItems*250);
  if(thresholds[id])assert(route.maxScore<thresholds[id],id+' ceiling crosses next tier');
  const s=E.create(1,390,844,id);
  assert.equal(s.schedule.items.length,route.maxItems);
  assert(s.schedule.items.every(tick=>tick<route.seconds*120));
  assert(s.schedule.hazards.length>=1,'each expedition includes ordinary obstacles');
 }
});

test('clean playable routes reach their intended tier and collect every actual board',()=>{
 const desired={r0:0,r1:5,r2:10,r3:20};
 const exact={r0:3240,r1:5980,r2:8640,r3:12050};
 for(const route of Object.keys(E.configs)){
  const {state}=play(123,390,844,route);
  assert.equal(state.reason,'arrival');assert.equal(state.arrived,true);assert.equal(state.finished,true);
  assert.equal(state.collected,state.route.maxItems);assert.equal(state.ticks,state.route.seconds*120);
  assert(Math.abs(state.score-exact[route])<1e-7);
  assert.equal(E.result(state.score),desired[route]);assert.equal(E.progress(state),1);
  assert(state.score<=state.route.maxScore);
 }
});

test('all collectibles and hazards are playable across mobile, landscape and desktop sizes',()=>{
 for(const id of Object.keys(E.configs))for(const [width,height] of [[280,420],[320,568],[390,844],[620,390],[1366,768]])for(const seed of [0,1,42,123,98765]){
  const {state}=play(seed,width,height,id);
  assert.equal(state.reason,'arrival',`${id}/${seed}/${width} collides`);
  assert.equal(state.collected,state.route.maxItems,`${id}/${seed}/${width} misses a board`);
  assert(state.score<=state.route.maxScore);assert(state.elapsed<=state.route.seconds);
 }
});

test('a collision ends normally and neither score nor progress changes afterward',()=>{
 for(const id of Object.keys(E.configs)){
  const {state}=play(1,390,844,id,false);
  assert.equal(state.reason,'collision');assert.equal(state.arrived,false);assert.equal(state.finished,false);
  assert(state.ticks<state.route.seconds*120);assert(state.score<state.route.maxScore);
  const score=state.score,ticks=state.ticks;E.step(state,true);assert.equal(state.score,score);assert.equal(state.ticks,ticks);
 }
});

test('seed and recorded jump inputs reproduce the identical expedition',()=>{
 const {state,log}=play(98765,390,844,'r3'),replay=E.create(98765,390,844,'r3');
 let index=0;while(!replay.ended){const jump=log[index]===replay.ticks;if(jump)index++;E.step(replay,jump);}
 for(const property of ['ticks','score','reason','collected','world','player','items','obstacles'])assert.deepEqual(replay[property],state[property]);
});

test('the original double-jump physics and refusal of a third jump remain',()=>{
 const state=E.create(1,390,844,'r0');E.step(state,true);assert.equal(state.player.jumps,1);
 E.step(state,true);assert.equal(state.player.jumps,2);const velocity=state.player.vy;
 E.step(state,true);assert.equal(state.player.jumps,2);assert(state.player.vy>velocity);
 while(!state.player.grounded)E.step(state,false);
 assert.equal(state.player.jumps,0);assert.equal(state.player.vy,0);
 assert.equal(E.physics.gravity,1520);assert.equal(E.physics.firstJump,-565);assert.equal(E.physics.secondJump,-510);
});

test('demonstration results always use the single highest tier',()=>{
 for(const [score,value] of [[0,0],[4999,0],[5000,5],[7499,5],[7500,10],[9999,10],[10000,20],[40000,20]])assert.equal(E.result(score),value);
 for(const score of [-1,NaN,Infinity])assert.throws(()=>E.result(score));
 for(const id of ['missing','__proto__','toString'])assert.throws(()=>E.create(1,390,844,id));
 assert.throws(()=>E.create(-1,390,844,'r0'));assert.throws(()=>E.create(1,10,844,'r0'));
});
