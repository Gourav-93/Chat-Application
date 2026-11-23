import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "process";
import { resolveEndpoints } from "./config/endpoints.js";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  const { backendOrigin, signalRHubUrl } = resolveEndpoints(env, command === "build");

  return {
    plugins: [react(), tailwindcss()],

    server: {
      port: 5173,
      strictPort: true,

      proxy: backendOrigin ? {
        "/api": {
          target: backendOrigin,
          changeOrigin: true,
        },

        "/hubs/chat": {
          target: signalRHubUrl.startsWith("/") ? backendOrigin : new URL(signalRHubUrl).origin,
          changeOrigin: true,
          ws: true,
        },
      } : undefined,
    },
  };
});
