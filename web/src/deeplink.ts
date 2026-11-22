import {
  coordinates,
  PLACES,
  POLLUTANTS,
  type Place,
  type Pollutant,
} from "@todayweather/core";

export const LINK_ORIGIN = "https://link.todayweather.ai";
type LinkView = "hourly" | "daily" | "air";
const decimal = /^-?(?:\d+\.?\d*|\.\d+)$/;

function nameHint(raw?: string | null) {
  const clean = raw
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\uD800-\uDFFF]/gu, "�")
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
