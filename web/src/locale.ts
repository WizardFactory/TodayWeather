import { setNumberLocale, type Units } from "@todayweather/core";
import { isLanguage, language } from "./i18n";

/**
 * Countries with their own display defaults (#2613, owner 2026-09-27):
 * Tier 1 and Tier 2. Any other or unknown country uses the international
 * standard.
 */
export const MANAGED_REGIONS = [
  "KR",
  "JP",
  "US",
  "DE",
  "GB",
  "CA",
  "AU",
  "FR",
  "BR",
  "ES",
  "MX",
  "CH",
  "AT",
  "BE",
  "IE",
  "NZ",
  "PT",
  "AR",
  "CL",
  "CO",
  "UY",
] as const;
const managed = new Set<string>(MANAGED_REGIONS);

const regionOf = (tag: string) =>
  tag
    .split(/[-_]/)
    .slice(1)
    .find((part) => /^[a-z]{2}$/i.test(part))
    ?.toUpperCase() ?? null;
/**
 * Country of the device language: the region of the first browser language,
 * else of a later tag in the same language (["ko", "ko-KR"]). A region from
 * another language (the "en-US" in ["de", "en-US"]) is not the user's
 * country; without one the international standard applies.
 */
export function detectRegion(tags: readonly string[]): string | null {
  const first = tags[0];
  if (!first) return null;
  const primary = first.toLowerCase().split(/[-_]/)[0];
  for (const tag of tags)
    if (tag.toLowerCase().split(/[-_]/)[0] === primary && regionOf(tag))
      return regionOf(tag);
  return null;
}

const INTERNATIONAL: Units = {
  temperatureUnit: "C",
  windSpeedUnit: "m/s",
  pressureUnit: "hPa",
  distanceUnit: "km",
  precipitationUnit: "mm",
  airUnit: "airnow",
};
const KMH: Units = { ...INTERNATIONAL, windSpeedUnit: "km/h" };
const TABLE: Record<string, Units> = {
  KR: { ...INTERNATIONAL, airUnit: "airkorea" },
  JP: INTERNATIONAL,
  US: {
    temperatureUnit: "F",
    windSpeedUnit: "mph",
    pressureUnit: "inHg",
    distanceUnit: "mi",
    precipitationUnit: "in",
    airUnit: "airnow",
  },
  GB: { ...INTERNATIONAL, windSpeedUnit: "mph", distanceUnit: "mi" },
};
for (const region of MANAGED_REGIONS)
  if (!(region in TABLE)) TABLE[region] = KMH;

/**
 * Automatic units for the browser's country (see configureFormats). Demo data
 * exists only in the Korean air standard.
 */
export const autoUnits = (): Units =>
  import.meta.env.VITE_WEB_MODE === "demo"
    ? { ...defaultUnits(unitRegion), airUnit: "airkorea" }
    : defaultUnits(unitRegion);
/** Unit defaults for a country; unknown or unmanaged → international standard. */
export function defaultUnits(region: string | null): Units {
  return { ...(region && TABLE[region] ? TABLE[region] : INTERNATIONAL) };
}

/**
 * Date/time/number conventions (#2613). A managed country whose browser
 * language is a supported UI language keeps its device locale (CLDR via
 * Intl): date order, clock and decimal mark do not change with the UI
 * language; only words (weekday, AM/PM) follow it. Anything else uses the
 * international standard: 24-hour clock, month-day (MM-DD) and a
 * decimal point.
 */
let formatTag: string | null = null,
  unitRegion: string | null = null;
export function configureFormats(browserTags: readonly string[]) {
  const region = detectRegion(browserTags),
    primary = (browserTags[0] ?? "").toLowerCase().split(/[-_]/)[0];
  unitRegion = region;
  formatTag =
    region && managed.has(region) && isLanguage(primary)
      ? `${primary}-${region}`
      : null;
  setNumberLocale(formatTag ?? "en");
}
/** Intl locale for the regional conventions, or null for the international standard. */
export const formatLocale = () => formatTag;
/** Device-locale text with its weekday and day period in the UI language. */
function deviceText(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  date: Date,
) {
  const device = new Intl.DateTimeFormat(locale, options),
    { hourCycle } = device.resolvedOptions();
  const words = new Map(
    new Intl.DateTimeFormat(language(), { ...options, hourCycle })
      .formatToParts(date)
      .filter((p) => p.type === "weekday" || p.type === "dayPeriod")
      .map((p) => [p.type, p.value]),
  );
  return device
    .formatToParts(date)
    .map((p) => words.get(p.type) ?? p.value)
    .join("");
}

const pad = (n: string) => n.padStart(2, "0");
/** Hour of a "YYYY-MM-DD HH:mm" wall time (no time zone conversion). */
export function hourText(at: string) {
  const hh = at.slice(11, 13),
    mm = at.slice(14, 16) || "00";
  const locale = formatLocale();
  if (!locale || !/^\d{2}$/.test(hh)) return `${hh}:${mm}`;
  return deviceText(
    locale,
    { hour: "numeric", minute: "2-digit", timeZone: "UTC" },
    new Date(`2000-01-01T${pad(hh)}:${pad(mm)}:00Z`),
  );
}
/** Month and day (with optional weekday) of a "YYYY-MM-DD…" wall date. */
export function dateText(at: string, weekday = false) {
  const d = new Date(at.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "—";
  const locale = formatLocale();
  if (locale)
    return deviceText(
      locale,
      {
        month: "numeric",
        day: "numeric",
        ...(weekday ? { weekday: "short" as const } : {}),
        timeZone: "UTC",
      },
      d,
    );
  const day = at.slice(5, 10);
  return weekday
    ? `${day} ${new Intl.DateTimeFormat(language(), { weekday: "short", timeZone: "UTC" }).format(d)}`
    : day;
}
/** An instant shown in Korea time (fetch/save times). */
export function instantText(date: Date, timeZone = "Asia/Seoul") {
  const locale = formatLocale();
  if (locale)
    return deviceText(
      locale,
      {
        timeZone,
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      },
      date,
    );
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
