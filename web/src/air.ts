import type { Pollutant } from "@todayweather/core";
// Mobile WeatherUtil.aqiStandard grade scales (client-data-contracts AQI standard tables).
const FOUR = ["좋음", "보통", "나쁨", "매우나쁨"];
const SIX = ["좋음", "보통", "민감군주의", "나쁨", "매우나쁨", "위험"];
const scale = (standard: string) =>
  standard === "airnow" || standard === "aqicn" ? SIX : FOUR;
const level = (standard: string, grade: number | null) => {
  if (grade === null || !Number.isFinite(grade) || grade < 1) return 0;
  return Math.min(Math.floor(grade), scale(standard).length);
};
export function gradeLabel(standard: string, grade: number | null) {
  const n = level(standard, grade);
  return n ? scale(standard)[n - 1] : "정보 없음";
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
const names: Record<string, string> = {
  airkorea: "한국 대기환경 기준",
  airkorea_who: "WHO 권고 기준",
  airnow: "미국 EPA 기준",
  aqicn: "중국 기준",
};
export function standardName(standard: string) {
  return names[standard] ?? standard;
}
export const AIR_SOURCE = "대기오염정보: 환경부/한국환경공단";
export const AIR_DISCLAIMER =
  "인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.";
const forecastDescriptions: Record<string, string> = {
  kaq: "대기질 예보자료는 '안양대학교 기후에너지환경융합연구소(약칭: 안양대학교 기후융합연구소, 소장: 환경에너지공학과 구윤서 교수)'에서 제공하는 자료입니다.",
  airkorea:
    "환경부는 대기오염으로 인한 국민 건강 피해를 최소화 하기 위해 대기오염 농도를 예보하고 있습니다.",
};
export function forecastDescription(source: string) {
  return forecastDescriptions[source] ?? "";
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
