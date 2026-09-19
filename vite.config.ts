import { defineConfig } from 'vite';

/**
 * GitHub Pages serves a project site from /<repo>/, so the build needs a matching base path.
 * The deploy workflow passes it in as VITE_BASE; local dev and preview stay at the root.
 */
function normalizeBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE),
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
