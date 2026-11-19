import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "process";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  const backendUrl =
    env.VITE_API_BASE_URL || "http://localhost:5261";

  return {
    plugins: [react(), tailwindcss()],

    server: {
      port: 5173,
      strictPort: true,

      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },

        "/hubs/chat": {
          target: backendUrl,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});