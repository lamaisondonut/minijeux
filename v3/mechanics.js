/* V3 obstacle balancing. No network, scores, rewards or persistent state. */
(function (global) {
  'use strict';

  // Keep V2 jump physics; the body now follows the larger V3 character.
  const config = Object.freeze({
    initialSpeed: 315,
    maxSpeed: 530,
    acceleration: 2.8,
    gravity: 1520,
    firstJump: -565,
    secondJump: -510,
    maxJumps: 2,
    playerWidth: 32,
    playerHeight: 72,
    fixedStep: 1 / 120,
    minEncounterGap: 1.5,
    spawnPadding: 48
  });
  const dimensions = Object.freeze({
    rock: Object.freeze({ type: 'rock', w: 36, h: 30 }),
    log: Object.freeze({ type: 'log', w: 58, h: 38 }),
    stump: Object.freeze({ type: 'stump', w: 36, h: 58 }),
    high: Object.freeze({ type: 'stump', variant: 'high', w: 46, h: 126 }),
    branch: Object.freeze({ type: 'branch', w: 72, h: 19 })
  });

  // Mulberry32; tests can replay a sequence without changing Math.random().
  function rng(seed) {
    let state = Number(seed) >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let n = Math.imul(state ^ (state >>> 15), 1 | state);
      n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sample(random) {
    const n = Number(random());
    return Number.isFinite(n) ? Math.max(0, Math.min(0.999999999, n)) : 0.5;
  }

  function nextObstacle({ width, ground, score = 0, speed = config.initialSpeed, rng: random = Math.random }) {
    const r = sample(random);
    const level = Math.min(3, Math.floor(Math.max(0, score) / 900));
    let key;
    if (level === 0) key = r < 0.46 ? 'rock' : 'log';
    else if (level === 1) key = r < 0.25 ? 'rock' : r < 0.62 ? 'log' : 'stump';
    else if (level === 2) key = r < 0.20 ? 'rock' : r < 0.48 ? 'log' : r < 0.80 ? 'stump' : 'high';
    else key = r < 0.17 ? 'rock' : r < 0.40 ? 'log' : r < 0.66 ? 'stump' : r < 0.84 ? 'high' : 'branch';
    // On very narrow layouts the double-jump obstacle would become visible late.
    if (key === 'high' && width < 320) key = 'stump';
    const shape = dimensions[key];
    const obstacle = { ...shape, x: width + config.spawnPadding, y: ground - (key === 'branch' ? 125 : shape.h) };

    // Speed never decreases in this game. During this wait the preceding object
    // therefore travels at least currentSpeed * nextSpawn. Even an immediate
    // rise to maxSpeed afterwards cannot compress the encounter gap below 1.5s.
    // This reserves recovery time after a double jump; no stacked hazards.
    const currentSpeed = Math.max(config.initialSpeed, Math.min(config.maxSpeed, Number(speed) || config.initialSpeed));
    const nextSpawn = (config.maxSpeed / currentSpeed) * config.minEncounterGap + 0.12 + sample(random) * 0.22;
    return { obstacle, nextSpawn };
  }

  function recommendCollectibleY({ x, ground, type, obstacles = [], rng: random = Math.random }) {
    // Items share obstacle velocity. Horizontal proximity therefore stays fixed
    // until collection. Never bait the player into a branch or a high stump.
    if (obstacles.some(o => (o.type === 'branch' || o.variant === 'high') && x + 32 > o.x - 100 && x < o.x + o.w + 100)) return null;
    return ground - (type === 'berry' ? 86 + sample(random) * 24 : 138 + sample(random) * 34);
  }

  global.BorealMechanics = Object.freeze({ config, dimensions, rng, nextObstacle, recommendCollectibleY });
})(typeof window === 'object' ? window : globalThis);
