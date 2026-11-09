/* Édition Noël — cached festive artwork over the unchanged V3 item rectangles.
 * These canvases are visual assets only: points, spawning and hitboxes stay in V3.
 */
(() => {
  'use strict';

  const scale = 1.3;
  const kinds = Object.freeze(['cadeau', 'etoile', 'clochette', 'sucreOrge']);
  const colors = Object.freeze({
    outline: '#42303e', red: '#b92640', redLight: '#ed5060', redDark: '#831b38',
    cream: '#fff8df', snow: '#fffefa', gold: '#efbc57', goldLight: '#ffe8a0',
    goldDark: '#ae652d', green: '#386e59'
  });

  function canvas(width, height, kind) {
    const sprite = document.createElement('canvas');
    sprite.width = width;
    sprite.height = height;
    sprite.dataset.festiveKind = kind;
    return sprite;
  }

  function rect(context, x, y, width, height, color) {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  }

  function pattern(kind, rows, palette) {
    // Trim the authored pixel grid once so the visible silhouette fills its
    // 1.3× display rectangle, including the narrower bell and ribbon artwork.
    let left = Infinity, top = Infinity, right = -1, bottom = -1;
    rows.forEach((row, y) => [...row].forEach((key, x) => {
      if (!palette[key]) return;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }));
    const sprite = canvas(right - left + 1, bottom - top + 1, kind);
    const context = sprite.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((key, x) => {
      if (palette[key]) rect(context, x - left, y - top, 1, 1, palette[key]);
    }));
    return sprite;
  }

  const cadeau = pattern('cadeau', [
    '..................',
    '.....OO..OO.......',
    '....OGGOOGGO......',
    '....OGGOGGGO......',
    '.....OGGGGO.......',
    '..OOOOOGGOOOOOO...',
    '..ORRRRGGRRRRRO...',
    '..OLLLLGGLLLLLO...',
    '..OOOOOGGOOOOOO...',
    '...ORRRGGRRRRO....',
    '...ORRRGGRRRRO....',
    '...OLRRGGRRRRO....',
    '...OLRRGGRRRRO....',
    '...OLRRGGRRRDO....',
    '...ORRRGGRRDDO....',
    '...ORRRGGRDDDO....',
    '...OOOOOOOOOOO....',
    '..................'
  ], {O: colors.outline, R: colors.red, L: colors.redLight, D: colors.redDark, G: colors.goldLight});

  const etoile = pattern('etoile', [
    '..................',
    '........OO........',
    '.......OHHO.......',
    '.......OHGO.......',
    '......OHGGGO......',
    '......OHGGGO......',
    '..OOOOOHGGGOOOOO..',
    '.OHHHHHHGGGGGGGDO.',
    '..OHGGGGGGGGGGDO..',
    '...OHGGGGGGGGDO...',
    '....OGGGGGGGDO....',
    '....OGGGGGGGDO....',
    '....OGGGDDGGDO....',
    '...OGGDO..ODGDO...',
    '...OGDO....ODDO...',
    '...OO........OO...',
    '..................',
    '..................'
  ], {O: colors.outline, H: colors.cream, G: colors.gold, D: colors.goldDark});

  const clochette = pattern('clochette', [
    '.............................',
    '.............OO..............',
    '............OGGO.............',
    '.........RRROOORRR...........',
    '.........RLRRGGRLR...........',
    '..........RROOOOR............',
    '...........OHGGDO............',
    '..........OHHGGGDO...........',
    '.........OHHGGGGGDO..........',
    '.........OHGGGGGGDO..........',
    '.........OHGGGGGGDO..........',
    '........OHGGGGGGGGDO.........',
    '.......OHHHHHHHHHHHDO........',
    '.......OOOOOOOOOOOOOO........',
    '.............ODO.............',
    '..............O..............'
  ], {O: colors.outline, H: colors.goldLight, G: colors.gold, D: colors.goldDark, R: colors.red, L: colors.redLight});

  const sucreOrge = pattern('sucreOrge', [
    '.............................',
    '...............OOOOOO........',
    '.............OOCCRRCCOO......',
    '............OCCRCCRRCCO......',
    '...........OCCRCOOOORRCO.....',
    '..........OCRRCO....OCCO.....',
    '.........OCRRCO.....OCCO.....',
    '........OCCRCO......ORRO.....',
    '.......OCCRCO.......ORRO.....',
    '......OCRRCO.........OO......',
    '.....OCRRCO..................',
    '....OCCRCO...................',
    '...OCCRCO....................',
    '...ORRCO.....................',
    '....OOO......................',
    '.............................'
  ], {O: colors.outline, C: colors.snow, R: colors.red});

  const sprites = Object.freeze({cadeau, etoile, clochette, sucreOrge});

  function kindFor(item) {
    if (Object.prototype.hasOwnProperty.call(sprites, item.festiveKind)) return item.festiveKind;
    // V3 changes x as the runner advances; y stays fixed except during resize.
    // Cache the choice without adding any fields to the logical game item.
    if (choices.has(item)) return choices.get(item);
    const pair = item.type === 'berry' ? ['cadeau', 'etoile'] : ['clochette', 'sucreOrge'];
    const kind = pair[Math.abs(Math.floor(Number(item.y) || 0)) % 2];
    choices.set(item, kind);
    return kind;
  }

  const choices = new WeakMap();

  function visualBounds(item) {
    const baseWidth = Number(item.w) > 0 ? Number(item.w) : item.type === 'berry' ? 18 : 29;
    const baseHeight = Number(item.h) > 0 ? Number(item.h) : item.type === 'berry' ? 18 : 16;
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    return {
      x: Number(item.x) + (baseWidth - width) / 2,
      y: Number(item.y) + (baseHeight - height) / 2,
      w: width,
      h: height
    };
  }

  function draw(context, item) {
    const bounds = visualBounds(item);
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(sprites[kindFor(item)], bounds.x, bounds.y, bounds.w, bounds.h);
    context.restore();
  }

  window.BorealNoelCollectibles = Object.freeze({scale, draw, sprites, kinds, kindFor, visualBounds});
})();
