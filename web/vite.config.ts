import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/learning-platform/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5178,
    proxy: {
      "/api/learning-platform": {
        target: "http://localhost:8002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/learning-platform/, "/api"),
      },
      "/api": {
        target: "http://localhost:8002",
        changeOrigin: true,
      },
      "/sso": {
        target: "http://localhost:8002",
        changeOrigin: true,
      },
    },
  },
});