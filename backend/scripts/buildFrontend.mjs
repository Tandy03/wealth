import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedAdapters from './sharedBrowserModules.cjs';
import buildInfo from './frontendBuildInfo.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function buildFrontend({ tests = false } = {}) {
  if (tests) {
    await build({
      configFile: false, root,
      plugins: [sharedAdapters.sharedBrowserPlugin(root)],
      build: {
        outDir: path.join(root, '.tmp/frontend-test'), emptyOutDir: true, minify: false, target: 'es2022',
        lib: { entry: path.join(root, 'backend/tests/helpers/moduleEntry.mjs'), formats: ['iife'], name: 'FinoTestModules', fileName: () => 'modules.js' },
        rolldownOptions: { output: { exports: 'named' } },
      },
    });
    console.log('Built isolated UI test modules from their real import graph.');
    return;
  }
  const result = await build({ configFile: path.join(root, 'vite.config.mjs'), configLoader: 'native' });
  buildInfo.writeBuildInfo(root, path.join(root, '.tmp/frontend-dist'));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildFrontend({ tests: process.argv.includes('--tests') });
}
