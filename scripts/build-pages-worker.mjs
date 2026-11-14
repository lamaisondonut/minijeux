// Commit the generated Pages worker so the existing static Pages build can
// preview this branch without changing the production dashboard settings.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
  'pages', 'functions', 'build', 'functions',
  '--outdir', 'work/pages-worker', '--minify',
  '--compatibility-date', '2026-11-14',
], { cwd: root, stdio: 'inherit', env: {
  ...process.env, WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: path.join(root, 'work/wrangler-build.log'),
} });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
fs.copyFileSync(path.join(root,'work/pages-worker/index.js'),path.join(root,'v3/_worker.js'));
