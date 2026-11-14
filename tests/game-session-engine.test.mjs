import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGame, stepGame, resizeGame, replayGame, ENGINE_VERSION, MAX_TICKS } from '../v3/game-session-engine.mjs';
const root = new URL('../', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(new URL('fixtures/game-session-winning-rewards.json', import.meta.url)));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const rejects = (fn, message) => { assert.throws(fn, undefined, message); checks++; };
function functionSource(html, name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `Original function ${name} exists`);
  let at = html.indexOf('{', start) + 1, depth = 1, quote = null, escaped = false;
  for (; at < html.length && depth; at++) {
    const c = html[at];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = null; }
    else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  assert.equal(depth, 0); return html.slice(start, at);
}
// Execute the preserved, original drawing engine's actual normal-mode functions
// as a separate reference. This catches changes to integration order, PRNG calls,
// collision boxes, scoring, progression and obstacle/collectible density.
function original() {
  const html = fs.readFileSync(new URL('v3/index.html', root), 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('v3/mechanics.js', root), 'utf8'), sandbox);
  const declarations = `
 const CONFIG={initialSpeed:315,maxSpeed:530,acceleration:2.8,gravity:1520,firstJump:-565,secondJump:-510,maxJumps:2,progressPointsPerSecond:22,comboSeconds:2.7,comboCap:5,comboBonus:25,fixedStep:1/120,maxFrameSeconds:.1,...window.BorealMechanics.config};
 const $=()=>({textContent:''}); const rank=()=>'';
 let W=390,H=844,ground=Math.round(H*.8),mode='playing',elapsed=0,score=0,speed=315,world=0,spawn=1.9,collectSpawn=1.7,combo=0,comboTimer=0,landingTimer=0,flash=0,obstacles=[],items=[],dust=[];
 let random=window.BorealMechanics.rng(1);
 let player={x:72,y:ground-72,w:32,h:72,vy:0,grounded:true,jumps:0,run:0};
 function end(){mode='over'}
 ${['jump', 'collision', 'addObstacle', 'addItem', 'update'].map(name => functionSource(html, name)).join('\n')}
 globalThis.original={step(j){if(j)jump();update(1/120)},state(){return {score,speed,world,elapsed,spawn,collectSpawn,combo,comboTimer,landingTimer,flash,ground,player,obstacles,items,ended:mode==='over'}}};`;
  vm.runInContext(declarations, sandbox);
  return sandbox.original;
}
const fields = ['score','speed','world','elapsed','spawn','collectSpawn','combo','comboTimer','landingTimer','flash','ground','player','obstacles','items','ended'];
const comparable = s => JSON.stringify(Object.fromEntries(fields.map(k => [k,s[k]])));
for (const fps of [30, 60, 120]) {
  const reference = original(), s = createGame({ seed: 1, width: 390, height: 844, mode: 'rewards' });
  const inputs = new Set(fixture.jumps);
  let accumulator = 0;
  while (!s.ended) {
    accumulator += 1 / fps;
    while (accumulator + 1e-10 >= 1 / 120 && !s.ended) {
      const input = inputs.has(s.ticks);
      reference.step(input); stepGame(s,input); accumulator -= 1 / 120;
      assert.equal(comparable(s), comparable(reference.state()), `original V3 parity at ${fps}fps tick ${s.ticks}`);
    }
  }
  check(Math.floor(s.score) === fixture.expectedScore, `full winning original parity at ${fps}fps`);
}
for (const mode of ['rewards','extreme']) {
  const f = JSON.parse(fs.readFileSync(new URL(`fixtures/game-session-winning-${mode}.json`, import.meta.url)));
  check(f.engineVersion === ENGINE_VERSION, `${mode}: winning fixture binds the current engine version`);
  const result = replayGame(f);
  check(result.ended && result.state.endReason === 'collision' && result.score === f.expectedScore && result.score >= 10000, `${mode}: real replay passes all three award thresholds`);
  check(result.ticks === f.ticks && result.mode === mode, `${mode}: replay uses original immutable mode and exact tick count`);
  const changed = { ...f, jumps: f.jumps.filter((_,i) => i !== 0) };
  rejects(() => replayGame(changed), `${mode}: a removed jump cannot retain the winning replay`);
}
check(typeof ENGINE_VERSION === 'string' && ENGINE_VERSION.length > 0, 'explicit version for session binding');
const s = createGame({ seed: 0, width: 390, height: 844, mode: 'rewards' });
rejects(() => { s.mode = 'extreme'; }, 'session mode cannot change');
check(Object.isFrozen(s.config), 'physics configuration is frozen');
const extreme = createGame({seed:0,width:390,height:844,mode:'extreme'});
check(extreme.config.initialSpeed===380&&extreme.config.maxSpeed===640&&extreme.config.minEncounterGap===1.35,'extreme explicitly changes speed and safe gap');
stepGame(s,true); const old = { ground:s.ground,player:s.player.y,vy:s.player.vy,jumps:s.player.jumps,score:s.score };
s.obstacles.push({type:'log',x:300,y:s.ground-38,w:58,h:38});s.items.push({type:'berry',x:200,y:s.ground-90,w:18,h:18});
resizeGame(s,844,390);const delta=s.ground-old.ground;
check(s.player.y===old.player+delta&&s.player.vy===old.vy&&s.player.jumps===old.jumps&&s.score===old.score,'resize translates an airborne player without changing physics or score');
check(s.obstacles[0].y===s.ground-38&&s.items[0].y===s.ground-90,'resize translates all collision entities with the ground');
const resized = createGame({seed:7,width:390,height:844,mode:'extreme'}), jumps=[],resizes=[];
for(let tick=0;tick<200;tick++){
  if(tick===12){resizeGame(resized,844,390);resizes.push({tick,width:844,height:390});}
  if(tick===36){resizeGame(resized,320,568);resizes.push({tick,width:320,height:568});}
  const jump=tick===8||tick===42;if(jump)jumps.push(tick);stepGame(resized,jump);
}
check(comparable(replayGame({seed:7,width:390,height:844,mode:'extreme',ticks:200,jumps,resizes}).state)===comparable(resized),'replay applies real resize events before their recorded tick');
const valid={seed:1,width:390,height:844,mode:'rewards',ticks:100,jumps:[],resizes:[]};
for(const override of [{seed:-1},{seed:2**32},{width:0},{width:390.1},{height:239},{mode:'normal'},{ticks:MAX_TICKS+1},{ticks:-1},{ticks:1.5},{jumps:[1,1]},{jumps:[4,3]},{jumps:[100]},{jumps:Array(9001).fill(1)},{resizes:[{tick:3,width:0,height:844}]},{resizes:[{tick:3,width:390,height:844},{tick:3,width:320,height:568}]},{resizes:Array(61).fill({tick:3,width:390,height:844})}])rejects(()=>replayGame({...valid,...override}),'malformed or excessive proof rejected');
const noInput=replayGame({...valid,ticks:352});check(noInput.ended&&noInput.state.endReason==='collision','collision terminates proof deterministically');
rejects(()=>replayGame({...valid,ticks:353}),'proof cannot continue past collision');
check(!replayGame(valid).ended,'unfinished result explicitly remains unfinished for server rejection');

// Independently exercise all physical obstacle boxes and every ordered pair at
// the most compressed permitted extreme encounter gap. No replay fixture is
// produced by altering these test states.
const shapes={rock:{type:'rock',w:36,h:30},log:{type:'log',w:58,h:38},stump:{type:'stump',w:36,h:58},high:{type:'stump',variant:'high',w:46,h:126},branch:{type:'branch',w:72,h:19}};
const keys=Object.keys(shapes),ground=700,dt=1/120,c=extreme.config;
const collides=(a,b)=>a.x+5<b.x+b.w-5&&a.x+a.w-5>b.x+5&&a.y+5<b.y+b.h-5&&a.y+a.h-5>b.y+5;
function traverse(sequence,speed,offset=0){
 const p={x:72,y:ground-72,w:32,h:72,vy:0,jumps:0,grounded:true};
 const obstacles=sequence.map(([key,x])=>({...shapes[key],key,x,y:ground-(key==='branch'?125:shapes[key].h)}));
 for(let tick=0;tick<3600;tick++){
  const target=obstacles.find(o=>o.x+o.w>p.x+5);let jump=false;
  if(target&&target.key!=='branch'){
   if(target.start===undefined&&target.x<=p.x+p.w-10+speed*((target.key==='high'?.38:.23)+offset)){
    if(!p.grounded)return false;jump=true;target.start=tick;
   }else if(target.key==='high'&&p.jumps===1&&tick-target.start>=28)jump=true;
  }
  if(jump&&p.jumps<2){p.vy=p.jumps?c.secondJump:c.firstJump;p.grounded=false;p.jumps++;}
  p.vy+=c.gravity*dt;p.y+=p.vy*dt;
  if(p.y>=ground-p.h){p.y=ground-p.h;p.vy=0;p.grounded=true;p.jumps=0;}
  for(const o of obstacles){o.x-=speed*dt;if(collides(p,o))return false;}
  if(obstacles.every(o=>o.x+o.w<p.x))return true;
 }
 return false;
}
for(const speed of [380,450,530,600,640])for(const key of keys)for(const offset of [-.025,0,.025])check(traverse([[key,600]],speed,offset),`${key} traversable at ${speed}px/s with ${offset}s timing variation`);
for(const first of keys)for(const second of keys)check(traverse([[first,600],[second,600+c.maxSpeed*c.minEncounterGap]],c.maxSpeed),`extreme minimum-gap pair ${first}/${second} is possible`);
// Even the highest allowed collectible intersects a legal double-jump arc.
for(const type of ['berry','board'])for(const fraction of [0,.5,1]){
 const p={x:72,y:ground-72,w:32,h:72,vy:c.firstJump,jumps:1};
 const height=(type==='berry'?86+fraction*24:138+fraction*34)+10+fraction*8;
 const item={x:74,y:ground-height,w:type==='berry'?18:29,h:type==='berry'?18:16};let reached=false;
 for(let tick=0;tick<160;tick++){if(tick===28)p.vy=c.secondJump;p.vy+=c.gravity*dt;p.y+=p.vy*dt;if(collides(p,item))reached=true;}
 check(reached,`extreme ${type} at lift ${10+fraction*8}px is reachable with two jumps`);
}
console.log(`Shared V3 engine: ${checks} checks, original normal parity at 30/60/120fps, all extreme hazard pairs, and two genuine >10000-point completed replays.`);
