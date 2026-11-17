import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5261",
        changeOrigin: true,
      },
      "/hubs/chat": {
        target: "http://localhost:5261",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});