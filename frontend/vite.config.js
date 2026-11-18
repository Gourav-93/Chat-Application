import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://192.168.29.66:5261",
        changeOrigin: true,
      },
      "/hubs/chat": {
        target: "http://192.168.29.66:5261",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});