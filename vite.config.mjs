import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedAdapters from './backend/scripts/sharedBrowserModules.cjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, 'frontend'),
  cacheDir: path.join(root, '.tmp/vite-cache'),
  publicDir: false,
  plugins: [sharedAdapters.sharedBrowserPlugin(root)],
  base: '/',
  server: { host: '127.0.0.1', middlewareMode: true, fs: { allow: [path.join(root, 'frontend'), path.join(root, 'shared')] } },
  optimizeDeps: { noDiscovery: true },
  build: {
    outDir: path.join(root, '.tmp/frontend-dist'),
    emptyOutDir: true,
    manifest: true,
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: { onwarn(warning, warn) { if (warning.code === 'CIRCULAR_DEPENDENCY') throw new Error('Circular frontend dependency.'); warn(warning); } },
  },
});
