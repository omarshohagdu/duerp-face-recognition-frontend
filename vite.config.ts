import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Sent to the API in `device_info.app_version` (UI_FLOW §8.4).
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // getUserMedia and navigator.geolocation need a secure context, which
    // means HTTPS *or* localhost (UI_FLOW §8.2). Binding to localhost keeps
    // dev inside that window; a LAN IP origin silently disables both.
    host: "localhost",
    port: 5173,
  },
});
