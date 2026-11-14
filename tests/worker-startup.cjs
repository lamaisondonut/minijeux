'use strict';
// Load the exact committed module in workerd: no Wrangler/esbuild rebundle,
// injected globals or automatic Node polyfills may repair this artifact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'v3/_worker.js'), 'utf8');
assert.ok(!/\bnode:|__unenv__|getBuiltinModule/.test(script), 'generated Worker has no Node imports or injected Node globals');
const matrix = [
  ['2022-11-30', []],
  ['2024-01-01', ['nodejs_compat']],
  ['2024-09-23', []],
  ['2026-08-03', []],
  ['2026-11-14', ['no_nodejs_compat', 'no_nodejs_compat_v2']],
  ['2026-11-14', []],
  ['2024-09-23', ['nodejs_compat']],
];
(async () => {
  for (const [compatibilityDate, compatibilityFlags] of matrix) {
    const mf = new Miniflare(convertV4MiniflareOptions({
      modules: [{ type: 'ESModule', path: '_worker.js', contents: script }],
      compatibilityDate, compatibilityFlags, cf: false,
      serviceBindings: { ASSETS: async () => new Response('static-asset-ok') },
    }));
    try {
      const status = await mf.dispatchFetch('https://preview.example/api/rewards/status');
      assert.equal(status.status, 200);
      assert.match(status.headers.get('cache-control'), /no-store/);
      const body = await status.json();
      assert.equal(body.mode, 'pending'); assert.equal(body.rewardsEnabled, false);
      assert.ok(!/budget|remainingCents|usedCents|phone|employee/i.test(JSON.stringify(body)));
      const asset = await mf.dispatchFetch('https://preview.example/');
      assert.equal(await asset.text(), 'static-asset-ok');
      for (const pathname of ['/admin/', '/admin%2Findex.html', '/api/admin/me']) {
        const response = await mf.dispatchFetch('https://preview.example' + pathname, {
          headers: { 'Cf-Access-Authenticated-User-Email': 'forged@example.test' },
        });
        assert.ok([401,403,503].includes(response.status));
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
      console.log(`PASS: raw Worker startup and routing, date=${compatibilityDate}, flags=${compatibilityFlags.join(',') || 'none'}`);
    } finally {
      await mf.dispose();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
