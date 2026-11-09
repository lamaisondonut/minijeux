/* Noël boréal — additive, cached pixel-art scenery for the unchanged V3 engine.
 * The original panorama and all nine live parallax planes are drawn first.
 * These new winter decorations never participate in collisions or world state.
 */
(() => {
  'use strict';
  const base = window.BorealScenery;
  const sleigh = window.BorealNoelSleigh;
  if (!base) throw new Error('Le décor V3 doit être chargé avant son édition de Noël.');
  const mod = (n, d) => ((n % d) + d) % d;
  const surface = (w, h) => { const s = document.createElement('canvas'); s.width = w; s.height = h; return s; };
  // Replace only the two decorative flying-bird frames in this seasonal runtime.
  // Original V3 artwork and its renderer on disk remain unchanged.
  const emptyBird = surface(1, 1);
  base.sprites.birds.splice(0, base.sprites.birds.length, emptyBird, emptyBird);
  const pixel = (c, x, y, w, h, color) => {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  function rng(seed) {
    let n = seed >>> 0;
    return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  }
  function line(c, x0, y0, x1, y1, color, size = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      pixel(c, x0, y0, size, size, color);
      if (x0 === x1 && y0 === y1) return;
      const e = error * 2;
      if (e >= dy) { error += dy; x0 += sx; }
      if (e <= dx) { error += dx; y0 += sy; }
    }
  }
  function fir(seed, decorated) {
    const s = surface(116, 248), c = s.getContext('2d'), random = rng(seed), cx = 56;
    // Individually broken, hanging boughs leave a conifer silhouette and exposed bark.
    pixel(c, cx - 3, 22, 7, 222, '#3c3840');
    pixel(c, cx + 1, 48, 2, 193, '#826951');
    line(c, cx - 2, 237, cx - 12, 246, '#3b3c43', 3);
    line(c, cx + 3, 236, cx + 14, 246, '#3b3c43', 2);
    for (let tier = 12; tier >= 0; tier--) {
      const y = 13 + tier * 16, breadth = 5 + tier * 3.45;
      for (const side of [-1, 1]) {
        const tipY = y + 9 + random() * 5;
        const tipX = cx + side * breadth;
        line(c, cx, y - 2, tipX, tipY, '#1a3a42', 5);
        for (let q = 0; q <= 1; q += .10) {
          const x = cx + (tipX - cx) * q, yy = y + (tipY - y) * q;
          const drop = 5 + q * 9 + random() * 4;
          line(c, x, yy, x + side * 5, yy + drop, '#173640', 3);
          line(c, x - side, yy, x + side * 3, yy + drop * .7, '#315861', 2);
          if (q > .2) pixel(c, x + side * 3, yy + drop - 1, 2, 3, '#62838a');
          // Fresh powder follows the bough instead of filling a solid triangle.
          const cap = 4 + (1 - q) * 3 + random() * 2;
          pixel(c, x - 3, yy - 4, 7, cap, '#b1c9da');
          pixel(c, x - 3, yy - 5, 6, 4, side < 0 ? '#f1f6ef' : '#d9e8ed');
          if (q < .85 && random() > .30) pixel(c, x - 2, yy - 6, 5, 2, '#fffaf0');
          if (q > .42 && random() > .4) pixel(c, x + side * 3, yy + 3, 2, 5, '#d0e4ec');
        }
      }
      pixel(c, cx - 3, y - 8, 7, 7, '#e6f1ef');
    }
    // Snow-weighted leader and a pale irregular drift around the roots.
    line(c, cx, 3, cx - 1, 20, '#e7f3f1', 2);
    pixel(c, 25, 241, 62, 5, '#bdcedc'); pixel(c, 33, 238, 45, 5, '#e7eef0');
    pixel(c, 39, 236, 29, 4, '#fff9ec');
    if (decorated) {
      // Warm red-and-gold strings deliberately leave the snowy branches visible.
      for (let row = 0; row < 3; row++) {
        const y = 68 + row * 43, half = 14 + row * 11;
        for (let x = -half; x <= half; x++) {
          const drop = Math.round((1 - (x / half) ** 2) * 10);
          pixel(c, cx + x, y + drop, 1, 2, '#914149');
          if (mod(x + half, 9) === 0) {
            const gold = mod(x + half, 18) === 0;
            pixel(c, cx + x - 2, y + drop + 2, 5, 6, gold ? '#d7a448' : '#b8494f');
            pixel(c, cx + x - 1, y + drop + 2, 2, 3, gold ? '#fff0a7' : '#f3a38a');
            pixel(c, cx + x, y + drop + 8, 1, 1, '#f5d5a1');
          }
        }
      }
    }
    return s;
  }
  function snowShrub(seed) {
    const s = surface(82, 38), c = s.getContext('2d'), random = rng(seed);
    for (let i = 0; i < 18; i++) {
      const x = 9 + random() * 60, y = 7 + random() * 17;
      line(c, 41, 36, x, y + 5, '#3c5f67', 2);
      pixel(c, x - 5, y + 3, 15, 7, '#6f919e');
      pixel(c, x - 6, y + 1, 15, 5, '#b8d0de');
      pixel(c, x - 4, y - 1, 12, 4, '#eff5ef');
      if (i % 4 === 0) { pixel(c, x, y + 7, 3, 3, '#b54e59'); pixel(c, x, y + 7, 1, 1, '#f3a28c'); }
    }
    return s;
  }
  function snowFern(seed) {
    const s = surface(64, 42), c = s.getContext('2d'), random = rng(seed);
    for (let i = 0; i < 9; i++) {
      const endX = 5 + i * 6, endY = 8 + random() * 13;
      line(c, 31, 39, endX, endY, '#4c727e', 2);
      for (let q = .3; q <= 1; q += .16) {
        const x = 31 + (endX - 31) * q, y = 39 + (endY - 39) * q;
        line(c, x - 5, y - 2, x + 5, y - 1, '#88a9b9', 2);
        pixel(c, x - 5, y - 4, 9, 2, '#e0edf0');
        pixel(c, x - 3, y - 5, 5, 1, '#fff9ef');
      }
    }
    return s;
  }
  function snowTrail() {
    const s = surface(768, 114), c = s.getContext('2d'), random = rng(12025);
    // The top row is exactly the V3 collision ground; no decorative raised ledge.
    pixel(c, 0, 0, 768, 3, '#fbfaf0'); pixel(c, 0, 3, 768, 12, '#e5edf0');
    pixel(c, 0, 15, 768, 38, '#cfdee7'); pixel(c, 0, 53, 768, 20, '#c0d1df');
    for (let x = 0; x < 768; x += 4) {
      const depth = Math.round(91 + Math.sin(x * Math.PI * 2 / 768) * 7 + Math.sin(x * Math.PI * 10 / 768) * 4);
      pixel(c, x, 71, 4, depth - 70, '#b3c8d9');
      pixel(c, x, depth - 3, 4, 4, '#97b0c4');
    }
    for (let i = 0; i < 350; i++) {
      const x = random() * 768, y = 6 + random() * 68;
      pixel(c, x, y, 2 + random() * 6, i % 5 ? 1 : 2, i % 4 ? '#e4edf0' : '#9fbaca');
    }
    // Small shallow blue prints give the white running lane some scale.
    for (let x = 17; x < 768; x += 81) {
      pixel(c, x, 30, 8, 3, '#adbfce'); pixel(c, x + 12, 34, 7, 3, '#b7c9d6');
      pixel(c, x + 2, 29, 5, 1, '#f4f5ed');
    }
    return s;
  }
  function drift(seed) {
    const s = surface(164, 44), c = s.getContext('2d'), random = rng(seed);
    for (let x = 0; x < s.width; x += 3) {
      const edge = Math.sin(Math.PI * x / s.width);
      const top = Math.round(30 - edge * (17 + Math.sin(x * .045) * 7));
      pixel(c, x, top, 4, 44 - top, '#8faac1');
      pixel(c, x, top, 4, 7, '#d6e5ec');
      pixel(c, x, top, 4, 3, '#f3f5ed');
      if (random() > .7) pixel(c, x, top + 11, 4, 1, '#b5cbdc');
    }
    return s;
  }
  function festoon() {
    const s = surface(320, 59), c = s.getContext('2d');
    for (let x = 0; x < 320; x++) {
      const y = 4 + Math.round(Math.sin(Math.PI * x / 320) * 24);
      pixel(c, x, y, 1, 2, '#81734e');
      if (x % 20 === 10) {
        line(c, x, y + 1, x, y + 6, '#58614d');
        const gold = x % 40 === 10;
        pixel(c, x - 4, y + 6, 9, 11, gold ? '#d2a14c' : '#b1444a');
        pixel(c, x - 2, y + 6, 5, 7, gold ? '#ffe4a0' : '#ef9f82');
        pixel(c, x - 1, y + 6, 2, 4, '#fff4ca');
      }
    }
    return s;
  }
  const sprites = Object.freeze({
    firs: Object.freeze([fir(1225, false), fir(77125, true), fir(2425, false)]),
    shrubs: Object.freeze([snowShrub(3912), snowShrub(1825)]),
    ferns: Object.freeze([snowFern(2310), snowFern(5325)]),
    drifts: Object.freeze([drift(101), drift(202)]),
    trail: snowTrail(), festoon: festoon()
  });
  const snowPlanes = Object.freeze([
    Object.freeze({ name: 'Neige lointaine', count: 22, speed: 7, drift: .028, size: 1, alpha: .42 }),
    Object.freeze({ name: 'Neige du sous-bois', count: 28, speed: 13, drift: .065, size: 2, alpha: .64 }),
    Object.freeze({ name: 'Flocons proches', count: 34, speed: 23, drift: .11, size: 2, alpha: .82 })
  ]);
  const snowRandom = rng(24122025);
  const flakes = snowPlanes.map(plane => Array.from({ length: plane.count }, () => Object.freeze({
    x: snowRandom(), y: snowRandom(), sway: snowRandom() * Math.PI * 2, variant: snowRandom()
  })));
  const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function sprite(c, image, x, y, scale = 1, alpha = 1) {
    c.globalAlpha = alpha;
    c.drawImage(image, Math.round(x), Math.round(y), Math.round(image.width * scale), Math.round(image.height * scale));
    c.globalAlpha = 1;
  }
  function movingX(index, gap, world, rate, width, margin, seed) {
    const span = Math.max(gap * 3, Math.ceil((width + margin * 2) / gap) * gap);
    return mod(index * gap + seed - world * rate, span) - margin;
  }
  function snow(c, planeIndex, W, H, world, time, reduced) {
    const plane = snowPlanes[planeIndex], list = flakes[planeIndex];
    const count = reduced ? Math.min(8, list.length) : list.length;
    c.globalAlpha = plane.alpha;
    for (let i = 0; i < count; i++) {
      const flake = list[i];
      const t = reduced ? 0 : time;
      const x = mod(flake.x * (W + 26) - world * plane.drift + Math.sin(t * .25 + flake.sway) * (4 + planeIndex * 3), W + 26) - 13;
      const y = mod(flake.y * (H + 18) + t * plane.speed, H + 18) - 9;
      pixel(c, x, y, plane.size, plane.size, '#f1f6ee');
      if (planeIndex === 2 && flake.variant > .76) {
        pixel(c, x - 1, y + 1, 4, 1, '#d6e9ef');
        pixel(c, x + 1, y - 1, 1, 4, '#e8f3f0');
      }
    }
    c.globalAlpha = 1;
  }
  function draw(c, options) {
    // Pass the very same dimensions and clock to the existing renderer first.
    base.draw(c, options);
    const { width: W, height: H, ground: g, world = 0, time = 0 } = options;
    const reduced = !!motionQuery?.matches;
    c.save(); c.imageSmoothingEnabled = false;
    // Cold blue air still lets the original aurora, lake, cabins and forest read.
    c.fillStyle = 'rgba(126,176,218,.11)'; c.fillRect(0, 0, W, H);
    snow(c, 0, W, H, world, time, reduced);
    const farCount = Math.ceil((W + 180) / 94);
    for (let i = 0; i < farCount; i++) {
      const x = movingX(i, 94, world, .075, W, 90, 58);
      sprite(c, sprites.firs[i % 3], x, g - 144 - i % 3 * 6, .32, .58);
    }
    // Low snowy shoreline, retaining broad open views through the forest.
    for (let i = 0; i < Math.ceil((W + 180) / 146); i++) {
      const x = movingX(i, 146, world, .18, W, 90, 101);
      sprite(c, sprites.shrubs[i % 2], x, g - 31 - i % 2 * 5, .94, .94);
    }
    const nearCount = Math.ceil((W + 380) / 315);
    for (let i = 0; i < nearCount; i++) {
      const x = movingX(i, 315, world, .28, W, 180, 116);
      const size = .86 + i % 3 * .12;
      sprite(c, sprites.firs[i % 3], x, g - 248 * size - 23, size, .97);
    }
    // One sparse festive strand high overhead, far from the running lane.
    const festoonY = Math.max(8, Math.round(g * .035));
    const festoonOffset = mod(world * .018, sprites.festoon.width);
    for (let x = -festoonOffset; x < W; x += sprites.festoon.width) sprite(c, sprites.festoon, x, festoonY, 1, .91);
    sleigh?.draw(c, options);
    snow(c, 1, W, H, world, time, reduced);
    // Fresh powder follows the exact logical ground; hazards are drawn later.
    c.fillStyle = 'rgba(125,166,193,.35)'; c.fillRect(0, g, W, H - g);
    const offset = mod(world * .72, sprites.trail.width);
    for (let x = -offset; x < W; x += sprites.trail.width) sprite(c, sprites.trail, x, g);
    // Foreground drifts and frost ferns also scroll independently, below hazards.
    for (let i = 0; i < Math.ceil((W + 220) / 156); i++) {
      const x = movingX(i, 156, world, .84, W, 110, 83);
      sprite(c, sprites.drifts[i % 2], x, g + 69 + i % 3 * 17, 1.03, .97);
    }
    for (let i = 0; i < Math.ceil((W + 140) / 89); i++) {
      const x = movingX(i, 89, world, .91, W, 70, 47);
      sprite(c, sprites.ferns[i % 2], x, g + 76 + i % 3 * 24, .82 + i % 3 * .13, .95);
    }
    snow(c, 2, W, H, world, time, reduced);
    c.restore();
  }
  // Exposed metadata is useful for verifying budgets without touching gameplay.
  const ready = Promise.all([base.ready, sleigh?.ready]).then(() => Object.freeze({ loaded: true, season: 'noel' }));
  window.BorealNoelScenery = Object.freeze({
    draw, ready, base, sprites, snowPlanes,
    layers: Object.freeze([...base.layers, ...snowPlanes]),
    particleBudget: snowPlanes.reduce((n, plane) => n + plane.count, 0),
    get loaded() { return base.loaded; },
    get error() { return base.error; }
  });
})();
