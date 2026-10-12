'use strict';
const assert = require('node:assert/strict');
require('../v3/mechanics.js');
const M = globalThis.BorealMechanics;
const { config: C } = M;
const dt = C.fixedStep;
const ground = 640;
const speeds = [315, 340, 380, 430, 480, 530];
const keys = Object.keys(M.dimensions);
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

// This deliberately reproduces the V2 game's integration order and 5px AABB
// inset, not a continuous ballistic approximation of the new generator.
function collision(a, b) {
  const m = 5;
  return a.x + m < b.x + b.w - m && a.x + a.w - m > b.x + m &&
    a.y + m < b.y + b.h - m && a.y + a.h - m > b.y + m;
}
function player() { return { x: 72, y: ground - C.playerHeight, w: C.playerWidth, h: C.playerHeight, vy: 0, jumps: 0, grounded: true }; }
function obstacle(key, x) {
  const shape = M.dimensions[key];
  return { ...shape, key, x, y: ground - (key === 'branch' ? 125 : shape.h), started: false };
}
function jump(p) {
  if (p.jumps >= 2) return false;
  p.vy = p.jumps ? C.secondJump : C.firstJump;
  p.grounded = false;
  p.jumps++;
  return true;
}
function step(p, active, speed) {
  p.vy += C.gravity * dt;
  p.y += p.vy * dt;
  if (p.y >= ground - p.h) { p.y = ground - p.h; p.vy = 0; p.grounded = true; p.jumps = 0; }
  for (const o of active) { o.x -= speed * dt; if (collision(p, o)) return o; }
  return null;
}

// A conservative timing policy; branches are crossed on the ground. A high
// stump receives a second jump 0.23s after take-off. Other objects use one jump.
function policy(p, active, speed, time, timingOffset = 0, allowDouble = true) {
  const target = active.find(o => o.x + o.w > p.x + 5);
  if (!target || target.key === 'branch') return;
  const lead = (target.key === 'high' ? 0.38 : 0.23) + timingOffset;
  if (!target.started && target.x <= p.x + p.w - 10 + speed * lead) {
    if (!p.grounded) throw new Error(`No landing/reset before ${target.key}`);
    jump(p); target.started = true; target.startTime = time;
  }
  if (allowDouble && target.key === 'high' && target.started && p.jumps === 1 && time - target.startTime >= 0.23) jump(p);
}

function traverse(sequence, speedAt, timingOffset = 0, allowDouble = true) {
  const p = player();
  const objects = sequence.map(([key, x]) => obstacle(key, x));
  for (let i = 0; i < 3600; i++) {
    const time = i * dt, speed = speedAt(time);
    policy(p, objects, speed, time, timingOffset, allowDouble);
    const hit = step(p, objects, speed);
    if (hit) return { safe: false, hit, p, time };
    if (objects.every(o => o.x + o.w < p.x)) return { safe: true, p, time };
  }
  throw new Error('Simulation timed out');
}

check(Object.isFrozen(M) && Object.isFrozen(C), 'public configuration frozen');
check(C.initialSpeed === 315 && C.maxSpeed === 530 && C.maxJumps === 2, 'speed and jump budget');
check(C.playerWidth === 32 && C.playerHeight === 72, 'V3 sprite body dimensions');
const jumpBudget = player();
check(jump(jumpBudget) && jump(jumpBudget), 'first and second jump accepted');
const secondImpulse = jumpBudget.vy;
check(!jump(jumpBudget) && jumpBudget.vy === secondImpulse, 'third jump rejected');
for (let i = 0; i < 240; i++) step(jumpBudget, [], C.initialSpeed);
check(jumpBudget.grounded && jumpBudget.jumps === 0, 'landing resets jump budget');
const a = M.rng(42), b = M.rng(42), c = M.rng(43);
const xs = Array.from({ length: 100 }, () => a());
check(xs.every(n => n >= 0 && n < 1), 'PRNG bounds');
check(xs.join(',') === Array.from({ length: 100 }, () => b()).join(','), 'seed replay');
check(xs.join(',') !== Array.from({ length: 100 }, () => c()).join(','), 'different seed');

// Prove each actual collision box is traversable, including ±25ms of timing
// variation. This also detects accidentally moving branches into standing heads.
for (const speed of speeds) for (const key of keys) for (const offset of [-0.025, 0, 0.025]) {
  const result = traverse([[key, 600]], () => speed, offset);
  check(result.safe, `${key} traversable at ${speed}px/s, timing ${offset}s`);
}
for (const speed of speeds) {
  check(!traverse([['high', 600]], () => speed, 0, false).safe, `high stump requires a double jump at ${speed}`);
}

// All ordered pairs are separated by the strict minimum distance guaranteed by
// the generator. Test at the cap (shortest elapsed recovery interval).
const minDistance = C.maxSpeed * C.minEncounterGap;
for (const first of keys) for (const second of keys) {
  const result = traverse([[first, 600], [second, 600 + minDistance]], () => C.maxSpeed);
  check(result.safe, `pair ${first}/${second} at minimum separation`);
}

// Sample and simulate generated mixed sequences. Accelerating all the way from
// 315 to 530 over 2.7s is more aggressive than the score-only progression here.
for (const seed of [1, 2, 37, 2026, 0xFFFFFFFF]) {
  const random = M.rng(seed), p = player();
  let nextSpawn = 0, time = 0, spawned = 0, passed = 0, active = [];
  for (let i = 0; i < 36000 && passed < 120; i++) {
    time = i * dt;
    const speed = Math.min(C.maxSpeed, C.initialSpeed + time * 80);
    nextSpawn -= dt;
    if (nextSpawn <= 0 && spawned < 120) {
      const generated = M.nextObstacle({ width: 390, ground, score: 10000, speed, rng: random });
      const key = generated.obstacle.variant === 'high' ? 'high' : generated.obstacle.type;
      active.push({ ...generated.obstacle, key, started: false });
      nextSpawn = generated.nextSpawn;
      check(speed * nextSpawn >= minDistance, `guaranteed distance seed ${seed}, obstacle ${spawned}`);
      spawned++;
    }
    policy(p, active, speed, time);
    const hit = step(p, active, speed);
    assert.ok(!hit, `generated collision seed ${seed}, frame ${i}${hit ? `: ${hit.key}` : ''}`);
    const remaining = active.filter(o => o.x + o.w >= p.x);
    passed += active.length - remaining.length; active = remaining;
  }
  check(passed === 120, `120 generated obstacles crossed, seed ${seed}`);
}

const dummyRandom = values => () => values.shift() ?? 0;
const narrow = M.nextObstacle({ width: 280, ground, score: 2000, speed: 530, rng: dummyRandom([0.95, 0]) });
check(narrow.obstacle.h === 58, 'narrow layouts avoid late high obstacle');
check(M.recommendCollectibleY({ x: 450, ground, type: 'board', obstacles: [obstacle('branch', 440)] }) === null, 'branch collectible bait suppressed');
check(M.recommendCollectibleY({ x: 450, ground, type: 'berry', obstacles: [obstacle('high', 440)] }) === null, 'high stump collectible bait suppressed');
for (const type of ['berry', 'board']) {
  const y = M.recommendCollectibleY({ x: 450, ground, type, rng: () => 0.5 });
  check(y < ground - C.playerHeight && y > ground - 187 - C.playerHeight, `${type} height within jump reach`);
}
console.log(`V3 mechanics: ${checks} assertions passed; 90 single-hazard simulations, 25 ordered pairs and 600 generated hazards.`);
