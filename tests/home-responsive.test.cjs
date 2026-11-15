'use strict';
// Exercise the delivered page in Chromium. Only the public, read-only status
// endpoint is substituted; no gameplay, claim, administrative, or asset code is.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const artifactDir = path.resolve(process.env.BOREAL_HOME_ARTIFACTS || '/tmp/boreal-home-responsive');
const viewports = [
  { width:1440, height:900 },
  { width:1920, height:1080 },
  { width:1024, height:768 },
  { width:820, height:1180 },
  { width:390, height:844 },
  { width:375, height:667 },
  { width:360, height:640 },
  { width:320, height:568 },
  { width:320, height:480 },
  { width:390, height:500 },
  { width:844, height:390 }
];
const states = {
  pending: { mode:'pending', rewardsEnabled:false, capCents:0, tiers:[] },
  rewards: { mode:'rewards', rewardsEnabled:true, capCents:1000,
    turnstileSiteKey:'browser-test-sitekey', policyVersion:'browser-test-policy',
    phoneVerificationMode:'unverified', notificationSmsEnabled:false,
    tiers:[{score:5000,valueCents:500,available:true},
      {score:7500,valueCents:1000,available:true},
      {score:10000,valueCents:2000,available:false}] },
  extreme: { mode:'extreme', rewardsEnabled:true, capCents:0, tiers:[] }
};
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml',
  '.css':'text/css; charset=utf-8', '.woff2':'font/woff2' };
let checks = 0;
const measurements = [];
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('PASS', message);
}
function serve(request, response) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/v3/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'});
    response.end(bytes);
  });
}
async function resetScroll(page) {
  await page.evaluate(() => {
    for (const element of [document.scrollingElement, document.querySelector('#home'),
      document.querySelector('#home .boreal-home-shell')]) if (element) element.scrollTop = 0;
  });
}
async function whollyVisible(page, selector, label, minimumHeight = 0) {
  const geometry = await page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { x:box.x, y:box.y, width:box.width, height:box.height,
      viewportWidth:innerWidth, viewportHeight:innerHeight,
      rendered:style.display !== 'none' && style.visibility !== 'hidden',
      reachable:element === center || element.contains(center) };
  });
  const visible = geometry.rendered && geometry.x >= -1 && geometry.y >= -1 && geometry.width > 0 &&
    geometry.height >= minimumHeight && geometry.x + geometry.width <= geometry.viewportWidth + 1 &&
    geometry.y + geometry.height <= geometry.viewportHeight + 1 && geometry.reachable;
  check(visible, `${label}: ${selector} entièrement visible et accessible` +
    (visible ? '' : ` (minimumHeight=${minimumHeight}, ${JSON.stringify(geometry)})`));
  return geometry;
}
async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const nodes = [document.documentElement, document.body, document.querySelector('#app'),
      document.querySelector('#home'), document.querySelector('#home .boreal-home-shell')];
    return nodes.filter(node => node && node.scrollWidth > node.clientWidth + 2)
      .map(node => ({node:node.id || node.tagName, width:node.clientWidth, scrollWidth:node.scrollWidth}));
  });
  check(overflow.length === 0, `${label}: aucun débordement horizontal ${JSON.stringify(overflow)}`);
}
async function checkModal(page, label, mode, screenshot) {
  const opener = page.locator('#boreal-open-rules');
  check(/^règlement et récompenses$/i.test((await opener.innerText()).trim()),
    `${label}: accès explicite au règlement et aux récompenses`);
  check(await opener.getAttribute('aria-controls') === 'boreal-rules', `${label}: bouton relié à la modale`);
  await opener.focus();
  await page.keyboard.press('Enter');
  const modal = page.locator('#boreal-rules');
  await modal.waitFor({state:'visible'});
  check(await modal.getAttribute('role') === 'dialog' && await modal.getAttribute('aria-modal') === 'true',
    `${label}: règlement ouvert comme dialogue modal`);
  check(await modal.evaluate(element => element.contains(document.activeElement)),
    `${label}: focus placé dans le règlement à l’ouverture`);
  const text = await modal.innerText();
  check(/exclusivement aux aliments/i.test(text) && /boissons alcooliques/i.test(text) &&
    /portion inutilisée/i.test(text), `${label}: conditions alimentaires complètes accessibles avant de jouer`);
  check(/une seule récompense par (?:personne|numéro de téléphone).*30 jours/is.test(text),
    `${label}: limite individuelle de 30 jours dans le règlement`);
  check(/15 minutes/.test(text) && /30 minutes/.test(text) && /10 minutes/.test(text),
    `${label}: délais de partie et de réclamation conservés`);
  check(await modal.locator('a[href="reglement.html"]').count() === 1,
    `${label}: règlement officiel complet toujours accessible`);
  if (mode === 'rewards') {
    const tiers = await modal.locator('.boreal-reward-tiers > span').allInnerTexts();
    check(tiers.length === 3 && /5\s*\$/.test(tiers[0]) && /5[\s\u00a0\u202f]?000/.test(tiers[0]) &&
      /10\s*\$/.test(tiers[1]) && /7[\s\u00a0\u202f]?500/.test(tiers[1]) &&
      /20\s*\$/.test(tiers[2]) && /10[\s\u00a0\u202f]?000/.test(tiers[2]),
    `${label}: trois paliers 5/10/20 $ et leurs scores conservés`);
    check(await modal.locator('.boreal-reward-tiers .unavailable').count() === 1 &&
      /Maximum annoncé\s*:\s*10\s*\$/i.test(text), `${label}: plafond offert de 10 $ et palier indisponible conservés`);
  }
  const focusableCount = await modal.locator('a, button, input, select, textarea, [tabindex="0"]').count();
  for (let index = 0; index < focusableCount + 2; index++) {
    await page.keyboard.press('Tab');
    check(await modal.evaluate(element => element.contains(document.activeElement)),
      `${label}: Tab reste dans le règlement (${index + 1})`);
  }
  await page.keyboard.press('Shift+Tab');
  check(await modal.evaluate(element => element.contains(document.activeElement)),
    `${label}: Maj+Tab reste dans le règlement`);
  if (screenshot) {
    await modal.locator('.boreal-rules-content').evaluate(element => {element.scrollTop = 0;});
    await page.screenshot({path:path.join(artifactDir, `rules-${screenshot}.png`)});
  }
  await page.keyboard.press('Escape');
  await modal.waitFor({state:'hidden'});
  check(await opener.evaluate(element => document.activeElement === element),
    `${label}: Échap ferme le règlement et rend le focus au bouton`);
  await opener.click();
  await modal.waitFor({state:'visible'});
  await page.locator('#boreal-close-rules').click();
  await modal.waitFor({state:'hidden'});
  check(await opener.evaluate(element => document.activeElement === element),
    `${label}: le bouton Fermer rend également le focus`);
}

(async () => {
  fs.mkdirSync(artifactDir, {recursive:true});
  const server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless:true, args:['--no-sandbox']});
    for (const viewport of viewports) {
      const device = `${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({viewport, isMobile:Math.min(viewport.width, viewport.height) <= 430,
        hasTouch:viewport.width <= 1024});
      const errors = [], requests = [], external = [];
      let responseStatus = states.pending;
      await context.route('**/api/rewards/status', route => {
        assert.equal(route.request().method(), 'GET', 'Le menu ne doit que lire le statut');
        return route.fulfill({json:responseStatus});
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) requests.push({method:request.method(),path:url.pathname});
        if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) external.push(request.url());
      });
      await page.goto(origin + '/v3/index.html');
      await page.waitForFunction(() => document.querySelector('#game').dataset.ready === 'true' &&
        window.BorealRewards && window.BorealRewardMenu, undefined, {polling:20});
      await page.evaluate(() => BorealRewardMenu.ready);
      check(await page.evaluate(() => ['refresh', 'getStatus', 'renderStatus'].every(name =>
        typeof BorealRewardMenu[name] === 'function') && typeof BorealRewardMenu.ready?.then === 'function'),
      `${device}: API publique de présentation conservée`);
      check(await page.locator('#home .boreal-home-shell').count() === 1 &&
        await page.locator('#home .boreal-home-copy').count() === 1 &&
        await page.locator('#home .boreal-home-actions').count() === 1,
      `${device}: composition d’accueil responsive présente`);
      check(await page.locator('#home .boreal-home-actions #start').count() === 1,
        `${device}: action principale dans son groupe dédié`);
      const controlsGrouped = await page.evaluate(() => {
        const how = document.querySelector('#how'), recover = document.querySelector('#rewardRecover');
        return how && recover && how.parentElement === recover.parentElement;
      });
      check(controlsGrouped, `${device}: Comment jouer et Retrouver mon code regroupés`);
      for (const [mode, status] of Object.entries(states)) {
        const label = `${device} / ${mode}`;
        responseStatus = status;
        await page.evaluate(() => BorealRewardMenu.refresh());
        await resetScroll(page);
        await page.waitForTimeout(70);
        const current = await page.evaluate(() => BorealRewardMenu.getStatus());
        check(current.mode === mode && current.rewardsEnabled === (mode === 'rewards') &&
          current.capCents === (mode === 'rewards' ? 1000 : 0), `${label}: statut et plafond serveur inchangés`);
        check(JSON.stringify(current.tiers) === JSON.stringify([
          {score:5000,valueCents:500,available:mode === 'rewards'},
          {score:7500,valueCents:1000,available:mode === 'rewards'},
          {score:10000,valueCents:2000,available:false}
        ]), `${label}: admissibilité normalisée des trois paliers inchangée`);
        check((await page.locator('#start').innerText()).trim() === 'JOUER' &&
          !await page.locator('#start').isDisabled(), `${label}: action JOUER prête`);
        const start = await whollyVisible(page, '#start', label, 44);
        await noHorizontalOverflow(page, label);
        const copy = await page.locator('#home .boreal-home-copy').boundingBox();
        const shell = await page.locator('#home .boreal-home-shell').boundingBox();
        const scene = await page.locator('#home .boreal-home-scene').boundingBox();
        const tips = await page.locator('#home .tips').boundingBox();
        const sceneOverlapsTips = scene && tips && scene.x < tips.x + tips.width &&
          scene.x + scene.width > tips.x && scene.y < tips.y + tips.height &&
          scene.y + scene.height > tips.y;
        check(!sceneOverlapsTips, `${label}: scène de Jacques séparée des conseils de jeu`);
        if (viewport.width >= 1280) {
          check(shell.width >= viewport.width * .75, `${label}: composition large utilisant l’écran`);
          check(scene && copy && copy.x + copy.width <= scene.x + 3 && scene.width >= viewport.width * .2,
            `${label}: introduction à gauche et scène de Jacques à droite`);
        }
        const homeText = await page.locator('#home').innerText();
        check(/une seule récompense par personne tous les 30 jours/i.test(homeText),
          `${label}: règle d’une récompense par personne visible avant participation`);
        check(await page.locator('#home input, #home textarea, #home select').count() === 0,
          `${label}: aucun renseignement personnel demandé avant la partie`);
        check(await page.locator('#homebest').isVisible(), `${label}: record personnel conservé`);
        const expectedHeading = mode === 'rewards' ? /mode récompenses/i :
          mode === 'extreme' ? /défi extrême.*sans récompense/i : /mode libre.*sans récompense/i;
        check(expectedHeading.test(homeText), `${label}: mode réel annoncé avant le départ`);
        await page.screenshot({path:path.join(artifactDir, `home-${device}-${mode}.png`)});
        measurements.push({viewport,mode,shell,copy,scene,tips,start});
        await checkModal(page, label, mode, mode === 'rewards' ? device : null);
      }
      await resetScroll(page);
      for (const selector of ['#how', '#rewardRecover']) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        await whollyVisible(page, selector, device, 44);
        await page.locator(selector).focus();
        check(await page.locator(selector).evaluate(element => document.activeElement === element),
          `${device}: ${selector} accessible au clavier`);
      }
      await page.locator('#how').click();
      await page.locator('#instructions').waitFor({state:'visible'});
      check((await page.locator('#instructions').innerText()).includes('Deux sauts par atterrissage'),
        `${device}: guide de jeu existant accessible`);
      await page.locator('#back').click();
      await page.locator('#home').waitFor({state:'visible'});
      check(await page.locator('#rewardRecover').isVisible(), `${device}: récupération de code toujours accessible au retour`);
      check(errors.length === 0, `${device}: aucune erreur JavaScript ${JSON.stringify(errors)}`);
      check(external.length === 0, `${device}: aucun appel externe ou SMS ${JSON.stringify(external)}`);
      check(requests.length >= 4 && requests.every(request => request.method === 'GET' &&
        request.path === '/api/rewards/status'), `${device}: lecture du statut uniquement, aucun gain ni partie créé`);
      await context.close();
    }
    fs.writeFileSync(path.join(artifactDir, 'geometry.json'), JSON.stringify(measurements, null, 2) + '\n');
    console.log(`PASS ${checks} contrôles Chromium; captures : ${artifactDir}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
