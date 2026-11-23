import {
  coordinates,
  PLACES,
  POLLUTANTS,
  type Place,
  type Pollutant,
} from "@todayweather/core";

export const LINK_ORIGIN = "https://link.todayweather.ai";
export const APP_STORE_URL = "https://apps.apple.com/app/id1041700694";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather";
export const FIXED_APP_QR_URL = `${LINK_ORIGIN}/open?fallback=store`;
const ANDROID_PACKAGE = "net.wizardfactory.todayweather";

type LinkView = "hourly" | "daily" | "air";
export type MobilePlatform =
  | "android"
  | "ios"
  | "ipados"
  | "mobile"
  | "desktop";
const decimal = /^-?(?:\d+\.?\d*|\.\d+)$/;

function nameHint(raw?: string | null) {
  const clean = raw
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\uD800-\uDFFF]/gu, "\uFFFD")
    .trim();
  return clean ? Array.from(clean).slice(0, 80).join("") : null;
}

export function linkView(raw?: string | null): LinkView {
  return raw === "daily" || raw === "air" ? raw : "hourly";
}

export function linkPollutant(raw?: string | null): Pollutant {
  return POLLUTANTS.find((code) => code === raw) ?? "aqi";
}

export function parseCoordinateLink(search: URLSearchParams) {
  const lat = search.get("lat")?.trim(),
    lon = search.get("lon")?.trim();
  if (!lat || !lon || !decimal.test(lat) || !decimal.test(lon)) return null;
  try {
    const point = coordinates(lat, lon);
    const view = linkView(search.get("view"));
    return {
      lat: point.lat || 0,
      lon: point.lon || 0,
      name: nameHint(search.get("name")),
      view,
      pollutant: view === "air" ? linkPollutant(search.get("pollutant")) : null,
    };
  } catch {
    return null;
  }
}

export function nearbySaved(places: Place[], lat: number, lon: number) {
  // All stored and linked coordinates are normalized to millidegrees.
  const distance = (a: number, b: number) =>
    Math.abs(Math.round(a * 1000) - Math.round(b * 1000));
  return places.find(
    (p) => distance(p.lat, lat) <= 10 && distance(p.lon, lon) <= 10,
  );
}

export function nearbyCatalog(lat: number, lon: number) {
  return PLACES.find(
    (p) => Math.abs(p.lat - lat) < 0.04 && Math.abs(p.lon - lon) < 0.04,
  );
}

function parameters(view: LinkView, pollutant: Pollutant | null) {
  if (view === "air")
    return pollutant && pollutant !== "aqi" ? `pollutant=${pollutant}` : "";
  return view === "daily" ? "view=daily" : "";
}

export function shareLink(
  place: Partial<Pick<Place, "id" | "name" | "lat" | "lon">>,
  rawView?: string,
  rawPollutant?: string,
) {
  const view = linkView(rawView);
  const pollutant = linkPollutant(rawPollutant);
  let center: { lat: number; lon: number } | undefined;
  if (typeof place.lat === "number" && typeof place.lon === "number") {
    try {
      center = coordinates(place.lat, place.lon);
    } catch {
      /* Invalid coordinates fall back to the app link. */
    }
  }
  const city =
    PLACES.find((p) => p.id === place.id) ??
    (center ? nearbyCatalog(place.lat!, place.lon!) : undefined);
  const details = parameters(view, pollutant);
  if (city) {
    return `${LINK_ORIGIN}/${view === "air" ? "air" : "place"}/${city.id}${details ? "?" + details : ""}`;
  }
  if (!center) return LINK_ORIGIN + "/open";
  const name = nameHint(place.name);
  const query = [`lat=${center.lat}`, `lon=${center.lon}`];
  if (name) query.push(`name=${encodeURIComponent(name)}`);
  if (view !== "hourly") query.push(`view=${view}`);
  if (view === "air" && details) query.push(details);
  return LINK_ORIGIN + "/loc?" + query.join("&");
}

export function linkedWeatherPath(
  id: string,
  view: LinkView,
  pollutant: Pollutant | null,
  fromLink: boolean,
) {
  const query = new URLSearchParams();
  if (view === "air" && pollutant && pollutant !== "aqi")
    query.set("pollutant", pollutant);
  if (fromLink) query.set("from", "link");
  const segment = encodeURIComponent(id);
  const path =
    view === "air" ? `/air/${segment}` : `/weather/${segment}/${view}`;
  return query.size ? path + "?" + query : path;
}

export function detectMobilePlatform(
  userAgent: string,
  maxTouchPoints = 0,
): MobilePlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ipados";
  if (/Mobile/i.test(userAgent)) return "mobile";
  return "desktop";
}

export type AppPrompt = "bar" | "qr" | "none";

/**
 * Mobile browsers get the "Open in app" bar, wide desktop windows get the
 * fixed store QR. A narrow desktop window gets neither: its store link would
 * resolve back to the web app. The installed PWA gets neither, so it does not
 * prompt on every launch.
 */
export function appPromptFor(
  platform: MobilePlatform,
  { compact, standalone }: { compact: boolean; standalone: boolean },
): AppPrompt {
  if (standalone) return "none";
  if (platform !== "desktop") return "bar";
  return compact ? "none" : "qr";
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function canonicalLinkForRoute(
  pathname: string,
  search: string,
  places: Place[],
): string {
  const clean =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const params = new URLSearchParams(search);

  if (clean === "/nation/weather") return `${LINK_ORIGIN}/nation/weather`;
  if (clean === "/nation/air") return `${LINK_ORIGIN}/nation/air`;
  if (clean === "/warnings") return `${LINK_ORIGIN}/warnings`;

  if (clean === "/loc") {
    const parsed = parseCoordinateLink(params);
    if (!parsed) return `${LINK_ORIGIN}/open`;
    return shareLink(
      { lat: parsed.lat, lon: parsed.lon, name: parsed.name ?? undefined },
      parsed.view,
      parsed.pollutant ?? undefined,
    );
  }

  const weatherMatch = /^\/weather\/([^/]+)\/(hourly|daily|overview)$/.exec(
    clean,
  );
  if (weatherMatch) {
    const id = decodeSegment(weatherMatch[1]);
    const view = weatherMatch[2] === "daily" ? "daily" : "hourly";
    const place =
      places.find((p) => p.id === id) ?? PLACES.find((p) => p.id === id);
    return place ? shareLink(place, view) : `${LINK_ORIGIN}/open`;
  }

  const airMatch = /^\/air\/([^/]+)$/.exec(clean);
  if (airMatch) {
    const id = decodeSegment(airMatch[1]);
    const place =
      places.find((p) => p.id === id) ?? PLACES.find((p) => p.id === id);
    return place
      ? shareLink(place, "air", params.get("pollutant") ?? undefined)
      : `${LINK_ORIGIN}/open`;
  }

  const placeMatch = /^\/place\/([^/]+)$/.exec(clean);
  if (placeMatch) {
    const id = decodeSegment(placeMatch[1]);
    const city = PLACES.find((p) => p.id === id);
    return city
      ? shareLink(
          city,
          params.get("view") ?? undefined,
          params.get("pollutant") ?? undefined,
        )
      : `${LINK_ORIGIN}/open`;
  }

  return `${LINK_ORIGIN}/open`;
}

export function appOpenHref(
  canonicalUrl: string,
  userAgent: string,
  maxTouchPoints = 0,
): string {
  const safeUrl = canonicalUrl.startsWith(LINK_ORIGIN + "/")
    ? canonicalUrl
    : `${LINK_ORIGIN}/open`;
  const platform = detectMobilePlatform(userAgent, maxTouchPoints);

  if (platform === "android") {
    const target = safeUrl.slice("https://".length);
    return `intent://${target}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
  }

  const sep = safeUrl.includes("?") ? "&" : "?";
  if (platform === "ipados") {
    return `${safeUrl}${sep}fallback=store&store=ios`;
  }
  return `${safeUrl}${sep}fallback=store`;
}
