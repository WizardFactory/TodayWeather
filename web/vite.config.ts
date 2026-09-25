import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readTransportSettings } from "./src/transport-config";
export default defineConfig(({ mode }) => {
  const settings = readTransportSettings({
    ...loadEnv(mode, process.cwd(), "VITE_"),
    ...process.env,
  });
  return {
    plugins: [
      react(),
      {
        name: "static-release",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "release.json",
            source: JSON.stringify(
              {
                schemaVersion: 1,
                siteOrigin: "https://app.tdywx.xyz",
                ...settings,
              },
              null,
              2,
            ),
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    build: { target: "es2022", sourcemap: false },
  };
});
