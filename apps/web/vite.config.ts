import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // Same-origin in development too: the API (and its auth cookies) is proxied (ADR 0011).
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/mcp": { target: api, changeOrigin: false },
      "/.well-known": { target: api, changeOrigin: false },
    },
  },
  build: { sourcemap: true },
});
