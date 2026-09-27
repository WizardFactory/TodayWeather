import type { Pollutant } from "@todayweather/core";
import { t, type MessageKey } from "./i18n";
// Mobile WeatherUtil.aqiStandard grade scales (client-data-contracts AQI standard tables).
const FOUR: MessageKey[] = [
  "air.grade.good",
  "air.grade.moderate",
  "air.grade.unhealthy",
  "air.grade.veryUnhealthy",
];
const SIX: MessageKey[] = [
  "air.grade.good",
  "air.grade.moderate",
  "air.grade.sensitive",
  "air.grade.unhealthy",
  "air.grade.veryUnhealthy",
  "air.grade.hazardous",
];
const scale = (standard: string) =>
  standard === "airnow" || standard === "aqicn" ? SIX : FOUR;
const level = (standard: string, grade: number | null) => {
  if (grade === null || !Number.isFinite(grade) || grade < 1) return 0;
  return Math.min(Math.floor(grade), scale(standard).length);
};
export function gradeLabel(standard: string, grade: number | null) {
  const n = level(standard, grade);
  return t(n ? scale(standard)[n - 1] : "common.noInfo");
}
/** CSS class `grade-<scale>-<level>`; colors live in style.css. */
export function gradeClass(standard: string, grade: number | null) {
  const n = level(standard, grade);
  return n ? `grade-${scale(standard).length}-${n}` : "grade-none";
}
export function pollutantUnit(code: Pollutant | string) {
  return code === "pm25" || code === "pm10"
    ? "㎍/㎥"
    : code === "aqi"
      ? ""
      : "ppm";
}
const names: Record<string, MessageKey> = {
  airkorea: "air.standard.airkorea",
  airkorea_who: "air.standard.airkorea_who",
  airnow: "air.standard.airnow",
  aqicn: "air.standard.aqicn",
};
export function standardName(standard: string) {
  return standard in names ? t(names[standard]) : standard;
}
export const airSource = () => t("air.source");
export const airDisclaimer = () => t("air.disclaimer");
const forecastDescriptions: Record<string, MessageKey> = {
  kaq: "air.forecast.kaq",
  airkorea: "air.forecast.airkorea",
};
export function forecastDescription(source: string) {
  return source in forecastDescriptions ? t(forecastDescriptions[source]) : "";
}
/**
 * Mobile AirCtrl window: 24 slots from index-12 to index+11 around the first
 * row at or after the latest observation (fallback: last row).
 */
export function airWindow<T extends { at: string }>(
  hourly: T[],
  observedAt: string | null,
): (T | null)[] {
  if (!hourly.length) return [];
  const key = (at: string) => at.replace("T", " ").slice(0, 16);
  let index = observedAt
    ? hourly.findIndex((h) => key(h.at) >= key(observedAt))
    : -1;
  if (index < 0) index = hourly.length - 1;
  return Array.from({ length: 24 }, (_, i) => hourly[index - 12 + i] ?? null);
}
