'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'docs/BRANDING-PROVENANCE.json')));
assert.equal(Object.keys(manifest.assets).length, 4);
for (const [file, hash] of Object.entries(manifest.assets)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'), hash, `${file}: exact supplied logo bytes`);
}
const source = fs.readFileSync(path.join(root,'v3/menu-recompenses.js'),'utf8');
for (const color of ['#2D351E','#666C37','#EFCD7A','#FFFFFF']) assert.ok(source.includes(color));
assert.ok(!/new Image\(|assets\/branding\/|boreal-brand-logo/.test(source),'menu does not insert either logo');
assert.ok(source.includes('Un jeu imaginé et développé par GOAT Agence'),'text signature retained');
assert.ok(!/récompenses en préparation/i.test(source),'public menu has no preparation promise');
assert.equal((fs.readFileSync(path.join(root,'v3/index.html'),'utf8').match(/src="menu-recompenses.js"/g)||[]).length,1);
console.log('PASS: 4 official logo assets unchanged and absent from menu; colors and text signature retained; single menu module');
