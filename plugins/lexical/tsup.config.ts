import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.tsx'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', '@baasix/sdk'],
    noExternal: ['react-day-picker'],
    esbuildOptions(options) {
      options.loader = {
        ...options.loader,
        '.svg': 'dataurl',
        '.png': 'dataurl',
      };
    },
  },
  {
    entry: { 'content': 'src/content-entry.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['react', 'react-dom'],
  },
]);
