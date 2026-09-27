import { COMPASS_POINTS, formatValue } from "@todayweather/core";
import { language, t, type MessageKey } from "./i18n";
import { placeName } from "./places";
import { dateText } from "./locale";
/** Positive amounts never round to zero: mm one decimal, inches two. */
export function amount(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = unit === "in" ? 2 : 1,
    floor = 1 / 10 ** digits;
  return value > 0 && value < floor
    ? "<" + formatValue(floor, digits)
    : formatValue(value, digits);
}
/**
 * KMA shortest rn1 is the lower bound of a 1-hour category (D45): show it as
 * approximate, and as ranges for the 30~50 / 50+ categories.
 */
export function approxAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  if (value === 0) return `0 ${unit}`;
  const mm = unit === "in" ? value * 25.4 : value,
    to = (v: number) => amount(unit === "in" ? v / 25.4 : v, unit);
  if (mm >= 50 - 1e-6) return t("amount.atLeast", { value: to(50), unit });
  if (mm >= 30 - 1e-6) return `${to(30)}~${to(50)} ${unit}`;
  // "1mm 미만" and "1.0mm" both parse to 1: only an upper bound is known.
  if (mm <= 1 + 1e-6) return t("amount.atMost", { value: to(1), unit });
  return t("amount.about", { value: amount(value, unit), unit });
}
const WORDS: Record<number, string> = {
  [-3]: "엊그제",
  [-2]: "그제",
  [-1]: "어제",
  0: "오늘",
  1: "내일",
  2: "모레",
  3: "글피",
};
/**
 * Relative day word against the source's current date (wall time, no
 * timezone). Korean keeps the app's seven words; other languages use their
 * own words for up to two days either side.
 */
export function relativeDay(at: string, reference: string) {
  const a = Date.parse(at.slice(0, 10) + "T00:00:00Z"),
    b = Date.parse(reference.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const days = Math.round((a - b) / 86400000);
  const lang = language();
  if (lang === "ko") return WORDS[days] ?? "";
  if (Math.abs(days) > 2) return "";
  const word = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(
    days,
    "day",
  );
  return word.charAt(0).toLocaleUpperCase(lang) + word.slice(1);
}
export const dayLabel = (at: string, reference?: string) => {
  const d = new Date(at.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "—";
  const date = dateText(at, true);
  const word = reference ? relativeDay(at, reference) : "";
  return word ? `${word} ${date}` : date;
};
export type IconKind =
  | "lightning"
  | "rainsnow"
  | "rain"
  | "snow"
  | "cloud-moon"
  | "cloud-sun"
  | "moon"
  | "sun"
  | "wind"
  | "cloud";
/** Icon grammar `<base>[_<cloud>][_<precip>][_lightning]` (domain glossary §3). */
export function iconKind(icon = ""): IconKind {
  return /lightning|thunder/.test(icon)
    ? "lightning"
    : /rainsnow|sleet/.test(icon)
      ? "rainsnow"
      : /rain|shower/.test(icon)
        ? "rain"
        : /snow/.test(icon)
          ? "snow"
          : /moon.*cloud/.test(icon)
            ? "cloud-moon"
            : /sun.*cloud|cloud.*sun/.test(icon)
              ? "cloud-sun"
              : /moon/.test(icon)
                ? "moon"
                : /sun|clear/.test(icon)
                  ? "sun"
                  : /wind/.test(icon)
                    ? "wind"
                    : "cloud";
}

export type TimeZoneHint = "KST" | "local";
/**
 * True when a source time is older than `limitHours`. Naive KMA/AirKorea wall
 * times are Korean local time (+09:00) and are compared exactly; explicit
 * offsets are respected. Overseas ("local") wall times carry no offset, so
 * they use a conservative date-only rule that never flags a fresh reading.
 */
export function isOld(
  at: string | null,
  limitHours = 3,
  now = Date.now(),
  zone: TimeZoneHint = "KST",
) {
  if (!at) return false;
  const s = at.trim().replace(" ", "T");
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!m) return false;
  if (!m[3] && zone === "local")
    // The latest zone (UTC-12) ends the local date last, so a fresh reading
    // anywhere on Earth is never flagged early.
    return (
      now - Date.parse(m[1].slice(0, 10) + "T23:59:59-12:00") >
      limitHours * 3600000
    );
  const time = Date.parse(m[1] + (m[2] ?? ":00") + (m[3] ?? "+09:00"));
  return Number.isFinite(time) && now - time > limitHours * 3600000;
}
/**
 * Place chosen when the search form is submitted (Enter): an exact name or id,
 * otherwise a unique name prefix. Address substrings are never used, so
 * "중구" does not silently pick an unrelated city.
 */
export function matchPlace<
  T extends { id: string; name: string; address: string },
>(term: string, places: T[]): T | undefined {
  const q = term.trim().toLocaleLowerCase();
  if (!q) return;
  // Stored (Korean) and UI-language names both match.
  const names = (p: T) =>
    [p.name, placeName(p)].map((n) => n.toLocaleLowerCase());
  const exact = places.find(
    (p) => names(p).includes(q) || p.id.toLocaleLowerCase() === q,
  );
  if (exact) return exact;
  const prefix = places.filter((p) => names(p).some((n) => n.startsWith(q)));
  return prefix.length === 1 ? prefix[0] : undefined;
}
/**
 * React Query staleness for a weather result. React Query adds it to
 * `updatedAt` (the query's dataUpdatedAt), so a rate-limit wait is measured
 * from then.
 */
export function weatherStaleTime(
  data?: { snapshot: boolean; retryAt?: number },
  updatedAt = Date.now(),
) {
  // A stored snapshot shown after a failure must refresh on reconnect/focus,
  // except while a rate limit asks us to wait (Retry-After).
  if (!data?.snapshot) return 600000;
  return data.retryAt ? Math.max(0, data.retryAt - updatedAt) : 0;
}

/**
 * Wind direction for display: compass codes (from overseas degrees, or a
 * server that sends codes) in the UI language; other text as received.
 */
export function windText(direction: string) {
  return (COMPASS_POINTS as readonly string[]).includes(direction)
    ? t(`wind.${direction}` as MessageKey)
    : direction;
}
