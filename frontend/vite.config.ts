import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pure client-side SPA. There is no co-located backend in the loop: the app
// talks directly to a presign / multipart Lambda for uploads and reads results
// straight out of the public-read results bucket. See AWS_SETUP.md.
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
  build: { outDir: "dist", sourcemap: false },
});
