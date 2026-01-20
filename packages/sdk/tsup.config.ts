import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "modules/auth": "src/modules/auth.ts",
    "modules/items": "src/modules/items.ts",
    "modules/files": "src/modules/files.ts",
    "modules/schemas": "src/modules/schemas.ts",
    "storage/index": "src/storage/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  external: ["@react-native-async-storage/async-storage"],
});
