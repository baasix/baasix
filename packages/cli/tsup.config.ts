import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outExtension() {
    return {
      js: ".mjs",
    };
  },
  dts: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
