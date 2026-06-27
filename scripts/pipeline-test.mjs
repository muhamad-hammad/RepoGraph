// Bundles scripts/pipeline-entry.ts (the pure pipeline modules) and runs it
// under node, so the host analysis pipeline can be exercised without launching
// the VSCode extension host.

import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
// Output inside the project so `require('web-tree-sitter')` resolves against
// the project's node_modules.
const outFile = path.join(projectRoot, 'dist', 'pipeline-entry.cjs');
const fixturesDir = process.env.FIXTURES_DIR;

if (!fixturesDir) {
  console.error('Set FIXTURES_DIR to a directory of sample source files.');
  process.exit(2);
}

await esbuild.build({
  entryPoints: [path.join(__dirname, 'pipeline-entry.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['web-tree-sitter'],
});

const res = spawnSync(process.execPath, [outFile], {
  stdio: 'inherit',
  env: { ...process.env, PROJECT_ROOT: projectRoot, FIXTURES_DIR: fixturesDir },
});
process.exit(res.status ?? 1);
