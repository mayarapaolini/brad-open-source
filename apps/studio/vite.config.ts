import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.BRAD_API_PORT ?? "4317";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
