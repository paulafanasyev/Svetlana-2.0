import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildCsp } from "./csp.mjs";

// В веб-сборку вшиваем CSP мета-тегом; в сборке для Windows (SVETLANA_DESKTOP=1) политику задаёт Tauri.
// В режиме разработки CSP не ставим: Vite использует встроенные скрипты для горячей перезагрузки.
function securityHeadersPlugin() {
  return {
    name: "svetlana-security-headers",
    apply: "build",
    transformIndexHtml(html) {
      const tags = ['<meta name="referrer" content="no-referrer" />'];
      if (!process.env.SVETLANA_DESKTOP) tags.unshift(`<meta http-equiv="Content-Security-Policy" content="${buildCsp()}" />`);
      return html.replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    ${tags.join("\n    ")}`);
    },
  };
}

// VITE_BASE lets the same app be served from a sub-path (GitHub Pages: "./")
// while dev and the Tauri desktop build keep the default "/".
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss(), securityHeadersPlugin()],
  server: {
    // Только этот компьютер. Для показа в локальной сети: SVETLANA_DEV_LAN=1 npm run dev
    host: process.env.SVETLANA_DEV_LAN ? "0.0.0.0" : "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
