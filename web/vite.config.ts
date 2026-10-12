/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: forward API calls to the FastAPI server (uvicorn on :8000).
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: "node" },
});
