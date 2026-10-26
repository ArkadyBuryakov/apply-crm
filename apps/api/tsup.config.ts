import { defineConfig } from "tsup";

// Bundles the API and worker entrypoints together with the workspace packages; npm dependencies stay external and
// are installed into the image by `pnpm deploy`.
export default defineConfig({
  entry: { main: "src/main.ts", worker: "src/worker.ts", migrate: "../../packages/db/src/migrate-cli.ts" },
  format: "esm",
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@crm\//],
});
