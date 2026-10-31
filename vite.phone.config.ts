import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The phone page (job 012): the second Vite entry, built on its own into dist/phone/ so its bundle holds
// only the phone page (no desktop code, no Tauri IPC). The core embeds exactly these files and serves them
// over the local network (src-tauri/src/phone_view/). Relative asset URLs work both at the server's `/`
// and under /phone/ in the e2e build.
export default defineConfig({
  plugins: [react()],
  base: "./",
  // The desktop's public files (theme-boot.js) are not part of the phone page.
  publicDir: false,
  clearScreen: false,
  build: {
    target: "es2022",
    outDir: "dist/phone",
    emptyOutDir: true,
    // Every asset is a file of its own: the page's CSP allows no data: URLs.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: { input: "phone.html" },
  },
});
