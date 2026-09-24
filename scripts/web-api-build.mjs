import { build } from "esbuild";
await build({
  entryPoints: ["web-api/src/server.ts"],
  outfile: "web-api/dist/server.js",
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  plugins: [
    {
      name: "bundle-domain",
      setup(b) {
        b.onResolve({ filter: /^@todayweather\/core$/ }, () => ({
          path: new URL(
            "../packages/weather-core/src/index.ts",
            import.meta.url,
          ).pathname,
        }));
      },
    },
  ],
});
