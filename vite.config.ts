import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import chromeManifest from "./public/manifest.json";
import { crx, ManifestV3Export } from "@crxjs/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@emotion/react",
      "@emotion/styled",
      "@mui/material",
      "@mui/x-date-pickers",
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        button_injection: "button_injection.html",
      },
      output: { entryFileNames: "[name].js" },
    },
  },
  plugins: [
    react(),
    crx({
      manifest: chromeManifest as ManifestV3Export,
    }),
  ],
});
