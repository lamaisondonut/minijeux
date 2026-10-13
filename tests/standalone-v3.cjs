'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const deliveredHTML = path.join(root, 'downloads/defi-boreal-v3-autonome.html');
const artifacts = path.join(root, 'artifacts/v3');
const origin = 'http://127.0.0.1:8891';
const viewport = { width: 390, height: 844 };
const results = [];
const check = (condition, message) => {
  assert.ok(condition, message);
  results.push(message);
  console.log('PASS', message);
};
const ready = page => page.waitForFunction(
  () => document.querySelector('#game')?.dataset.ready === 'true',
  undefined, { timeout: 15000 }
);
const isExternal = url => !/^(?:data:|blob:|about:)/.test(url);

function rendererTracker() {
  window.__atlasDraws = [];
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    const source = args[0];
    if (source instanceof HTMLCanvasElement && source.dataset.frame !== undefined) {
      window.__atlasDraws.push({
        frame: source.dataset.frame,
        width: source.width,
        height: source.height,
        embeddedPNG: /^data:image\/png;base64,/.test(source.dataset.sourceAsset || ''),
      });
      if (window.__atlasDraws.length > 500) window.__atlasDraws.shift();
    }
    return original.apply(this, args);
  };
}

// Hooks only exist in the test response. The distributed HTML stays unchanged.
function instrument(html) {
  let found = false;
  const result = html.replace(/(<script(?:\s[^>]*)?>)([\s\S]*?)(<\/script>)/g,
    (match, opening, body, closing) => {
      if (!body.includes('function advanceFrame(dt)')) return match;
      assert.equal(found, false, 'Un seul moteur est attendu');
      found = true;
      const marker = '\n})();';
      const at = body.lastIndexOf(marker);
      assert.ok(at >= 0, 'La fermeture du moteur doit être identifiable');
      const hook = `
window.standaloneTest = {
  reset, jump, update, draw,
  quiet: () => { spawn=1e9; collectSpawn=1e9; obstacles=[]; items=[]; },
  state: () => ({ mode, score, speed, ground, player:{...player} }),
};
`;
      return opening + body.slice(0, at) + hook + body.slice(at) + closing;
    });
  assert.ok(found, 'Le moteur doit être présent dans le fichier autonome');
  return result;
}

async function canvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game');
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let count = 0, nonBlack = 0, luminance = 0;
    // Sample broad scene regions, below HUD and above the bottom caption.
    for (let y = Math.floor(canvas.height * .18); y < canvas.height * .88; y += 13) {
      for (let x = Math.floor(canvas.width * .07); x < canvas.width * .93; x += 13) {
        const at = (y * canvas.width + x) * 4;
        const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
        count++;
        if (Math.max(r, g, b) > 15) nonBlack++;
        luminance += .2126 * r + .7152 * g + .0722 * b;
        colors.add(`${r},${g},${b}`);
      }
    }
    return { samples: count, colors: colors.size,
      nonBlackRatio: nonBlack / count, meanLuminance: luminance / count,
      canvasWidth: canvas.width, canvasHeight: canvas.height };
  });
}

async function main() {
  assert.ok(fs.existsSync(deliveredHTML), 'Construire le HTML autonome avant le test');
  const html = fs.readFileSync(deliveredHTML, 'utf8');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'], headless: true,
  });
  let server;
  let metrics;
  try {
    const offline = await browser.newContext({ viewport, isMobile: true, hasTouch: true, offline: true });
    const page = await offline.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (isExternal(request.url())) requests.push(request.url()); });
    await page.addScriptTag({ content: `(${rendererTracker.toString()})();` });
    await page.setContent(html);
    await ready(page);
    check(await page.evaluate(() => location.href === 'about:blank' && location.origin === 'null'),
      'HTML chargé avec une origine opaque, sans serveur ni connexion');
    check(await page.locator('#assetError').isHidden() && await page.locator('#start').isEnabled(),
      'Images intégrées prêtes hors ligne et bouton Jouer activé');
    check(await page.evaluate(() => JacquesSprites.frameRects().length === 24 && JacquesSprites.frameRects().every(frame => frame.width > 0 && frame.height > 0)),
      'Les 24 silhouettes PNG de Jacques sont décodées');
    check(await page.evaluate(() => BorealScenery.loaded && BorealScenery.layers.length === 9),
      'La forêt et ses neuf plans se chargent hors ligne');
    await page.click('#how');
    check(await page.locator('#instructions').isVisible(), 'Instructions accessibles');
    await page.click('#back');
    await page.click('#start');
    await page.waitForTimeout(650);
    check(Number((await page.locator('#score').textContent()).replace(/\D/g, '')) > 0,
      'La partie réelle avance et affiche un score hors ligne');
    const draws = await page.evaluate(() => window.__atlasDraws);
    check(draws.length > 3 && draws.every(draw => draw.embeddedPNG),
      'Jacques est effectivement dessiné depuis le PNG intégré');
    check(new Set(draws.map(draw => draw.frame)).size > 2,
      'Les frames de la course changent dans la partie réelle');
    metrics = await canvasMetrics(page);
    check(metrics.colors > 250 && metrics.nonBlackRatio > .95 && metrics.meanLuminance > 20,
      'Le véritable Canvas contient un décor coloré sur toute la scène échantillonnée');
    await page.screenshot({ path: path.join(artifacts, 'autonome-mobile.jpg'), type: 'jpeg', quality: 93 });
    await page.click('#pauseBtn');
    const score = await page.locator('#score').textContent();
    await page.waitForTimeout(200);
    check(await page.locator('#paused').isVisible() && score === await page.locator('#score').textContent(),
      'La pause bloque la progression');
    await page.click('#resume');
    check(await page.locator('#paused').isHidden(), 'La reprise quitte la pause');
    await page.click('#pauseBtn');
    await page.click('#exit');
    check(await page.locator('#home').isVisible(), 'Le menu principal reste accessible');
    check(requests.length === 0, 'Aucune requête HTTP, image externe ou métadonnée externe hors ligne');
    check(errors.length === 0, 'Aucune erreur JavaScript dans la partie autonome réelle');
    await offline.close();

    const deterministic = await browser.newContext({ viewport, isMobile: true, hasTouch: true, offline: true });
    const controlled = await deterministic.newPage();
    const controlErrors = [], controlRequests = [];
    controlled.on('pageerror', error => controlErrors.push(error.message));
    controlled.on('request', request => { if (isExternal(request.url())) controlRequests.push(request.url()); });
    await controlled.addScriptTag({ content: 'window.requestAnimationFrame=()=>0;' });
    await controlled.setContent(instrument(html));
    await ready(controlled);
    const run = fn => controlled.evaluate(fn);
    await controlled.click('#start');
    await run(() => standaloneTest.quiet());
    await controlled.touchscreen.tap(150, 430);
    check(await run(() => standaloneTest.state().player.jumps === 1), 'Le premier saut tactile fonctionne hors ligne');
    await controlled.touchscreen.tap(150, 430);
    check(await run(() => standaloneTest.state().player.jumps === 2), 'Le double saut tactile fonctionne hors ligne');
    const velocity = await run(() => standaloneTest.state().player.vy);
    await controlled.touchscreen.tap(150, 430);
    check(await run(() => standaloneTest.state().player.vy) === velocity, 'Le troisième saut reste refusé');
    await run(() => { for (let i = 0; i < 240; i++) standaloneTest.update(1/120); standaloneTest.draw(); });
    check(await run(() => standaloneTest.state().player.grounded && standaloneTest.state().player.jumps === 0),
      'L’atterrissage recharge les deux sauts');
    await controlled.keyboard.press('Space');
    check(await run(() => standaloneTest.state().player.jumps === 1), 'Le saut au clavier fonctionne');
    await controlled.keyboard.press('ArrowUp');
    check(await run(() => standaloneTest.state().player.jumps === 2), 'Le double saut au clavier fonctionne');
    check(controlRequests.length === 0 && controlErrors.length === 0,
      'Les scénarios tactiles et clavier ne nécessitent aucun réseau et ne lèvent aucune erreur');
    await deterministic.close();

    // Same distribution over ordinary HTTP: no opaque-origin test hooks here.
    server = spawn('python3', ['-m', 'http.server', '8891', '--bind', '127.0.0.1'], {
      cwd: root, stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await fetch(`${origin}/downloads/defi-boreal-v3-autonome.html`)).ok) break; } catch {}
      if (attempt === 39) throw new Error('Le serveur HTTP autonome ne démarre pas');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const web = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const served = await web.newPage();
    const servedRequests = [], webErrors = [];
    served.on('request', request => { if (isExternal(request.url())) servedRequests.push(request.url()); });
    served.on('pageerror', error => webErrors.push(error.message));
    await served.goto(`${origin}/downloads/defi-boreal-v3-autonome.html`);
    await ready(served);
    await served.click('#start');
    await served.waitForTimeout(400);
    check(await served.locator('#hud').isVisible(), 'Le fichier livré fonctionne aussi en HTTP');
    check(servedRequests.length === 1 && servedRequests[0] === `${origin}/downloads/defi-boreal-v3-autonome.html`,
      'En HTTP seul le fichier HTML est demandé : aucun fichier dépendant');
    check(webErrors.length === 0, 'Aucune erreur JavaScript dans le fichier servi en HTTP');
    await web.close();

    fs.writeFileSync(path.join(artifacts, 'standalone-results.json'), JSON.stringify({
      checks: results.length, results, chromiumVersion: browser.version(), viewport, canvasMetrics: metrics,
      modes: ['about:blank opaque origin, offline', 'HTTP served single file'],
      screenshot: 'autonome-mobile.jpg',
      limitations: ['Chromium headless Linux uniquement; aucun téléphone physique testé.',
        'L’origine opaque simule les restrictions locales; l’ouverture depuis les apps Fichiers iOS/Android reste à vérifier.',
        'La persistance du record est indisponible lorsque le navigateur refuse localStorage sur une origine opaque.'],
    }, null, 2) + '\n');
    console.log(`${results.length} contrôles autonomes réussis.`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
