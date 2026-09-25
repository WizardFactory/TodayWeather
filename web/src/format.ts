import { formatValue } from "@todayweather/core";
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
  if (mm >= 50 - 1e-6) return `${to(50)} ${unit} 이상`;
  if (mm >= 30 - 1e-6) return `${to(30)}~${to(50)} ${unit}`;
  // "1mm 미만" and "1.0mm" both parse to 1: only an upper bound is known.
  if (mm <= 1 + 1e-6) return `${to(1)} ${unit} 이하`;
  return `약 ${amount(value, unit)} ${unit}`;
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
/** Relative day word against the source's current date (wall time, no timezone). */
export function relativeDay(at: string, reference: string) {
  const a = Date.parse(at.slice(0, 10) + "T00:00:00Z"),
    b = Date.parse(reference.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  return WORDS[Math.round((a - b) / 86400000)] ?? "";
}
export const dayLabel = (at: string, reference?: string) => {
  const d = new Date(at.slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(d);
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
