import { spawn } from "node:child_process";
const mode = process.env.WEB_API_MODE ?? "live";
const origin = new URL(process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173");
if (
  origin.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("WEB_ORIGIN must be a loopback HTTP origin for development");
const transport = process.env.VITE_WEB_TRANSPORT ?? "direct";
const children = [
  ...(transport === "proxy"
    ? [
        spawn("npm", ["run", "dev", "-w", "@todayweather/api"], {
          stdio: "inherit",
          env: {
            ...process.env,
            WEB_API_MODE: mode,
            WEB_ORIGIN: origin.origin,
          },
        }),
      ]
    : []),
  spawn(
    "npm",
    [
      "run",
      "dev",
      "-w",
      "@todayweather/web",
      "--",
      "--host",
      origin.hostname.replace(/^\[|\]$/g, ""),
      "--port",
      origin.port || "80",
      "--strictPort",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_WEB_TRANSPORT: transport,
        VITE_WEB_MODE: process.env.VITE_WEB_MODE ?? mode,
      },
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
