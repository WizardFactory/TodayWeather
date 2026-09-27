import { setNumberLocale, type Units } from "@todayweather/core";
import { isLanguage, language, onLanguageChange } from "./i18n";

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

/** Region subtag of the first browser language that has one (e.g. pt-BR → BR). */
export function detectRegion(tags: readonly string[]): string | null {
  for (const tag of tags) {
    const region = tag
      .split(/[-_]/)
      .slice(1)
      .find((part) => /^[a-z]{2}$/i.test(part));
    if (region) return region.toUpperCase();
  }
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

/** Automatic units for the browser's country (see configureFormats). */
export const autoUnits = () => defaultUnits(unitRegion);
/** Unit defaults for a country; unknown or unmanaged → international standard. */
export function defaultUnits(region: string | null): Units {
  return { ...(region && TABLE[region] ? TABLE[region] : INTERNATIONAL) };
}

/**
 * Date/time/number conventions. A managed country whose browser language is
 * a supported UI language follows its locale data (CLDR via Intl), with names
 * in the UI language; anything else uses the international standard:
 * 24-hour clock, year-month-day order and a decimal point.
 */
let formatRegion: string | null = null,
  unitRegion: string | null = null;
export function configureFormats(browserTags: readonly string[]) {
  const region = detectRegion(browserTags),
    primary = (browserTags[0] ?? "").toLowerCase().split(/[-_]/)[0];
  unitRegion = region;
  formatRegion =
    region && managed.has(region) && isLanguage(primary) ? region : null;
  setNumberLocale(formatLocale() ?? "en");
}
// Number formatting follows the UI language within the regional rule.
onLanguageChange(() => setNumberLocale(formatLocale() ?? "en"));
/** Intl locale for the regional conventions, or null for the international standard. */
export const formatLocale = () =>
  formatRegion ? `${language()}-${formatRegion}` : null;

const pad = (n: string) => n.padStart(2, "0");
/** Hour of a "YYYY-MM-DD HH:mm" wall time (no time zone conversion). */
export function hourText(at: string) {
  const hh = at.slice(11, 13),
    mm = at.slice(14, 16) || "00";
  const locale = formatLocale();
  if (!locale || !/^\d{2}$/.test(hh)) return `${hh}:${mm}`;
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`2000-01-01T${pad(hh)}:${pad(mm)}:00Z`));
}
/** Month and day (with optional weekday) of a "YYYY-MM-DD…" wall date. */
export function dateText(at: string, weekday = false) {
  const d = new Date(at.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "—";
  const locale = formatLocale();
  if (locale)
    return new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      ...(weekday ? { weekday: "short" as const } : {}),
      timeZone: "UTC",
    }).format(d);
  const day = at.slice(5, 10);
  return weekday
    ? `${day} ${new Intl.DateTimeFormat(language(), { weekday: "short", timeZone: "UTC" }).format(d)}`
    : day;
}
/** An instant shown in Korea time (fetch/save times). */
export function instantText(date: Date, timeZone = "Asia/Seoul") {
  const locale = formatLocale();
  if (locale)
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
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
