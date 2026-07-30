import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Points at src, matching the tsconfig path mapping. The previous alias
    // resolved "@" to the project root while tsconfig mapped it to "./*", so the
    // two disagreed and any "@/..." import would have resolved differently in the
    // editor than in the bundle.
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    sourcemap: true,
  },
  server: {
    hmr: process.env.DISABLE_HMR !== "true",
    watch: process.env.DISABLE_HMR === "true" ? null : {},
  },
});
