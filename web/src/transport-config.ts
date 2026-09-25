export type TransportSettings = {
  transport: "direct";
  mode: "live" | "demo";
  apiOrigin: string;
};
/** Public build settings only. Never put provider or notification secrets here. */
export function readTransportSettings(
  env: Record<string, string | undefined>,
): TransportSettings {
  const transport = env.VITE_WEB_TRANSPORT ?? "direct";
  const mode = env.VITE_WEB_MODE ?? "live";
  if (transport !== "direct")
    throw new Error(
      "VITE_WEB_TRANSPORT must be direct; the proxy runtime has been removed",
    );
  if (mode !== "live" && mode !== "demo")
    throw new Error("VITE_WEB_MODE must be live or demo");
  const origin = new URL(
    env.VITE_WEATHER_API_ORIGIN ?? "https://todayweather.wizardfactory.net",
  );
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("VITE_WEATHER_API_ORIGIN must be an HTTPS origin");
  return { transport, mode, apiOrigin: origin.origin };
}
