/* The same fixed-step V3 simulation runs in the browser and on the server.
 * Drawing, network calls and personal data deliberately live outside this file.
 * Tick n input and resize events apply immediately before simulation step n.
 */
export const ENGINE_VERSION = 'boreal-v3-2026-11-14.1';
export const MAX_TICKS = 108000;
export const MAX_JUMPS = 9000;
export const MAX_RESIZES = 60;
export const FIXED_STEP = 1 / 120;

const COMMON = Object.freeze({ acceleration: 2.8, gravity: 1520, firstJump: -565, secondJump: -510, maxJumps: 2, playerWidth: 32, playerHeight: 72, fixedStep: FIXED_STEP, progressPointsPerSecond: 22, comboSeconds: 2.7, comboCap: 5, comboBonus: 25, spawnPadding: 48 });
const CONFIGS = Object.freeze({
  rewards: Object.freeze({ ...COMMON, initialSpeed: 315, maxSpeed: 530, minEncounterGap: 1.5, collectibleLift: 0 }),
  extreme: Object.freeze({ ...COMMON, initialSpeed: 380, maxSpeed: 640, minEncounterGap: 1.35, collectibleLift: 10 })
});
const SHAPES = Object.freeze({
  rock: Object.freeze({ type: 'rock', w: 36, h: 30 }),
  log: Object.freeze({ type: 'log', w: 58, h: 38 }),
  stump: Object.freeze({ type: 'stump', w: 36, h: 58 }),
  high: Object.freeze({ type: 'stump', variant: 'high', w: 46, h: 126 }),
  branch: Object.freeze({ type: 'branch', w: 72, h: 19 })
});
function integer(value, low, high, label) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new TypeError(`Invalid ${label}`);
  return value;
}
function dimensions(width, height) {
  integer(width, 160, 4096, 'width');
  integer(height, 240, 4096, 'height');
}
function random(s) {
  s.rng = (s.rng + 0x6D2B79F5) >>> 0;
  let n = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}
export function createGame({ seed, width, height, mode = 'rewards' } = {}) {
  integer(seed, 0, 0xFFFFFFFF, 'seed');
  dimensions(width, height);
  if (!Object.hasOwn(CONFIGS, mode)) throw new TypeError('Invalid mode');
  const config = CONFIGS[mode], ground = Math.round(height * .80);
  const s = { seed, rng: seed, width, height, ground, config, ticks: 0, ended: false, endReason: null, elapsed: 0, score: 0, speed: config.initialSpeed, world: 0, spawn: 1.9, collectSpawn: 1.7, combo: 0, comboTimer: 0, landingTimer: 0, flash: 0, obstacles: [], items: [], player: { x: 72, y: ground - config.playerHeight, w: config.playerWidth, h: config.playerHeight, vy: 0, grounded: true, jumps: 0, run: 0 } };
  Object.defineProperty(s, 'mode', { value: mode, enumerable: true, writable: false, configurable: false });
  return s;
}
export function resizeGame(s, width, height) {
  dimensions(width, height);
  const nextGround = Math.round(height * .80), delta = nextGround - s.ground;
  s.width = width; s.height = height; s.ground = nextGround;
  s.player.y += delta;
  for (const entity of [...s.obstacles, ...s.items]) entity.y += delta;
  if (s.player.grounded) s.player.y = s.ground - s.player.h;
  return s;
}
function collision(a, b) {
  const m = 5;
  return a.x + m < b.x + b.w - m && a.x + a.w - m > b.x + m && a.y + m < b.y + b.h - m && a.y + a.h - m > b.y + m;
}
function addObstacle(s) {
  const c = s.config, r = random(s), level = Math.min(3, Math.floor(Math.max(0, s.score) / 900));
  let key = level === 0 ? (r < .46 ? 'rock' : 'log') : level === 1 ? (r < .25 ? 'rock' : r < .62 ? 'log' : 'stump') : level === 2 ? (r < .20 ? 'rock' : r < .48 ? 'log' : r < .80 ? 'stump' : 'high') : (r < .17 ? 'rock' : r < .40 ? 'log' : r < .66 ? 'stump' : r < .84 ? 'high' : 'branch');
  if (key === 'high' && s.width < 320) key = 'stump';
  const shape = SHAPES[key];
  let x = s.width + c.spawnPadding;
  // A narrower resize must not place a new hazard on top of one already in flight.
  // With an unchanged viewport this does not change the original V3 sequence.
  const previous = s.obstacles[s.obstacles.length - 1];
  if (previous) x = Math.max(x, previous.x + c.maxSpeed * c.minEncounterGap);
  const obstacle = { ...shape, x, y: s.ground - (key === 'branch' ? 125 : shape.h) };
  s.obstacles.push(obstacle);
  if (key === 'branch' || key === 'high') s.items = s.items.filter(it => it.x + it.w < x - 100 || it.x > x + obstacle.w + 100);
  s.spawn = (c.maxSpeed / Math.max(c.initialSpeed, Math.min(c.maxSpeed, s.speed))) * c.minEncounterGap + .12 + random(s) * .22;
}
function addItem(s) {
  const berry = random(s) < .4, type = berry ? 'berry' : 'board', x = s.width + 25;
  const blocked = s.obstacles.some(o => (o.type === 'branch' || o.variant === 'high') && x + 32 > o.x - 100 && x < o.x + o.w + 100);
  // Match the original PRNG order, including the no-item path near tall hazards.
  let y = null;
  if (!blocked) {
    const fraction = random(s);
    const lift = s.config.collectibleLift ? 10 + fraction * 8 : 0;
    y = s.ground - (berry ? 86 + fraction * 24 : 138 + fraction * 34) - lift;
  }
  s.collectSpawn = 1.4 + random(s) * 1.7;
  if (y !== null) s.items.push({ x, y, w: berry ? 18 : 29, h: berry ? 18 : 16, type, taken: false });
}
export function stepGame(s, jump = false) {
  if (typeof jump !== 'boolean') throw new TypeError('Invalid jump');
  if (s.ended) return s;
  const c = s.config, dt = FIXED_STEP, p = s.player;
  if (jump && p.jumps < c.maxJumps) {
    p.vy = p.jumps === 0 ? c.firstJump : c.secondJump;
    p.grounded = false; p.jumps++;
  }
  s.ticks++; s.elapsed += dt;
  s.speed = Math.min(c.maxSpeed, c.initialSpeed + Math.sqrt(s.score) * c.acceleration);
  s.world += s.speed * dt; s.score += dt * c.progressPointsPerSecond;
  s.spawn -= dt; s.collectSpawn -= dt; s.comboTimer -= dt;
  if (s.comboTimer <= 0) s.combo = 0;
  if (s.spawn <= 0) addObstacle(s);
  if (s.collectSpawn <= 0) addItem(s);
  s.landingTimer = Math.max(0, s.landingTimer - dt);
  p.run += dt * 12; p.vy += c.gravity * dt; p.y += p.vy * dt;
  if (p.y >= s.ground - p.h) {
    if (!p.grounded) s.landingTimer = .12;
    p.y = s.ground - p.h; p.vy = 0; p.grounded = true; p.jumps = 0;
  }
  for (const entity of [...s.obstacles, ...s.items]) entity.x -= s.speed * dt;
  s.obstacles = s.obstacles.filter(o => o.x + o.w > -30);
  s.items = s.items.filter(it => it.x + it.w > -30 && !it.taken);
  for (const o of s.obstacles) if (collision(p, o)) { s.ended = true; s.endReason = 'collision'; return s; }
  for (const it of s.items) if (collision(p, it)) {
    it.taken = true; s.combo = s.comboTimer > 0 ? s.combo + 1 : 1; s.comboTimer = c.comboSeconds;
    s.score += (it.type === 'berry' ? 50 : 125) + Math.min(s.combo, c.comboCap) * c.comboBonus;
    s.flash = .18;
  }
  s.flash = Math.max(0, s.flash - dt);
  if (s.ticks === MAX_TICKS) { s.ended = true; s.endReason = 'time_limit'; }
  return s;
}
export function replayGame({ seed, width, height, mode = 'rewards', ticks, jumps = [], resizes = [] } = {}) {
  integer(ticks, 0, MAX_TICKS, 'ticks');
  if (!Array.isArray(jumps) || jumps.length > MAX_JUMPS) throw new TypeError('Invalid jumps');
  if (!Array.isArray(resizes) || resizes.length > MAX_RESIZES) throw new TypeError('Invalid resizes');
  let previous = -1;
  for (const tick of jumps) {
    integer(tick, 0, ticks - 1, 'jump tick');
    if (tick <= previous) throw new TypeError('Unsorted jumps');
    previous = tick;
  }
  previous = -1;
  for (const event of resizes) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Invalid resize');
    integer(event.tick, 0, ticks - 1, 'resize tick'); dimensions(event.width, event.height);
    if (event.tick <= previous) throw new TypeError('Unsorted resizes');
    previous = event.tick;
  }
  const state = createGame({ seed, width, height, mode });
  let jumpIndex = 0, resizeIndex = 0;
  for (let tick = 0; tick < ticks; tick++) {
    if (state.ended) throw new TypeError('Log continues after game ended');
    if (resizes[resizeIndex]?.tick === tick) {
      resizeGame(state, resizes[resizeIndex].width, resizes[resizeIndex].height); resizeIndex++;
    }
    const jump = jumps[jumpIndex] === tick;
    if (jump) jumpIndex++;
    stepGame(state, jump);
  }
  return { score: Math.floor(state.score), ticks: state.ticks, ended: state.ended, mode: state.mode, state };
}
