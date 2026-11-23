import { describe, expect, it } from "vitest";
import { configureFormats } from "../src/locale";
import {
  airCredit,
  airWindow,
  gradeClass,
  gradeLabel,
  pollutantUnit,
  standardName,
} from "../src/air";
import {
  amount,
  approxAmount,
  dayLabel,
  iconKind,
  relativeDay,
  upcomingPrecipitation,
} from "../src/format";
import type { Point } from "@todayweather/core";

describe("air standards", () => {
  it("uses four grades for Korean standards and six for EPA/China", () => {
    expect([1, 2, 3, 4].map((g) => gradeLabel("airkorea", g))).toEqual([
      "좋음",
      "보통",
      "나쁨",
      "매우나쁨",
    ]);
    expect([1, 2, 3, 4, 5, 6].map((g) => gradeLabel("airnow", g))).toEqual([
      "좋음",
      "보통",
      "민감군주의",
      "나쁨",
      "매우나쁨",
      "위험",
    ]);
    expect(gradeLabel("aqicn", 3)).toBe("민감군주의");
    expect(gradeLabel("airkorea_who", 9)).toBe("매우나쁨");
    expect(gradeLabel("airnow", null)).toBe("정보 없음");
    expect(gradeClass("airkorea", 2)).toBe("grade-4-2");
    expect(gradeClass("airnow", 7)).toBe("grade-6-6");
    expect(gradeClass("airkorea", 0)).toBe("grade-none");
  });
  it("labels units and standards", () => {
    expect(pollutantUnit("pm25")).toBe("㎍/㎥");
    expect(pollutantUnit("o3")).toBe("ppm");
    expect(pollutantUnit("aqi")).toBe("");
    expect(standardName("airkorea")).toBe("한국 대기환경 기준");
    expect(standardName("airnow")).toBe("미국 EPA 기준");
  });
  it("anchors the hourly air window on the latest observation", () => {
    const hourly = Array.from({ length: 49 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 22, 9 + i));
      return {
        at: d.toISOString().slice(0, 16).replace("T", " "),
        value: i,
        grade: 1,
        forecast: i > 24,
      };
    });
    const w = airWindow(hourly, "2026-09-23 09:00");
    expect(w).toHaveLength(24);
    expect(w[12]?.at).toBe("2026-09-23 09:00");
    expect(w[0]?.at).toBe("2026-09-22 21:00");
    expect(w.at(-1)?.forecast).toBe(true);
    const short = airWindow(hourly.slice(0, 3), "2026-09-22 10:00");
    expect(short[12]?.at).toBe("2026-09-22 10:00");
    expect(short[0]).toBeNull();
    expect(airWindow(hourly.slice(0, 2), "2030-01-01 00:00")[12]?.at).toBe(
      "2026-09-22 10:00",
    );
  });
});

describe("air credit", () => {
  it("credits AirKorea only for Korean data without another provider", () => {
    const official = [
      "대기오염정보: 환경부/한국환경공단",
      "인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.",
    ];
    expect(airCredit("KMA", { source: "", attribution: "" })).toEqual(official);
    expect(airCredit("KMA", { source: "airkorea", attribution: "" })).toEqual(
      official,
    );
    expect(airCredit("KMA")).toEqual(official);
    expect(
      airCredit("KMA", { source: "google", attribution: "Google Air Quality" }),
    ).toEqual(["대기질 정보: Google Air Quality"]);
    expect(
      airCredit("VC", { source: "google", attribution: "Google Air Quality" }),
    ).toEqual(["대기질 정보: Google Air Quality"]);
    expect(airCredit("VC", { source: "aqicn", attribution: "" })).toEqual([
      "대기질 정보: aqicn",
    ]);
    expect(airCredit("VC", { source: "", attribution: "" })).toEqual([]);
    expect(airCredit("VC")).toEqual([]);
  });
});

describe("display formatting", () => {
  it("never rounds a positive amount to zero", () => {
    expect(amount(0.2 / 25.4, "in")).toBe("<0.01");
    expect(amount(1.2 / 25.4, "in")).toBe("0.05");
    expect(amount(0.04, "mm")).toBe("<0.1");
    expect(amount(0, "in")).toBe("0");
    expect(amount(2.46, "mm")).toBe("2.5");
    expect(amount(null, "mm")).toBe("—");
    expect(approxAmount(0, "mm")).toBe("0 mm");
    expect(approxAmount(3, "mm")).toBe("약 3 mm");
    // QA LOW: a lower bound of 1 covers "1mm 미만" and exactly 1 mm.
    expect(approxAmount(1, "mm")).toBe("1 mm 이하");
    expect(approxAmount(1 / 25.4, "in")).toBe("0.04 in 이하");
    expect(approxAmount(30, "mm")).toBe("30~50 mm");
    expect(approxAmount(50, "mm")).toBe("50 mm 이상");
    expect(approxAmount(50 / 25.4, "in")).toBe("1.97 in 이상");
  });
  it("uses mobile relative day words around the source date", () => {
    configureFormats(["ko-KR"]);
    const ref = "2026-09-23T09:00";
    expect(
      [
        "2026-09-20",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
      ].map((d) => relativeDay(d + "T00:00", ref)),
    ).toEqual(["엊그제", "그제", "어제", "오늘", "내일", "모레", "글피", ""]);
    expect(dayLabel("2026-09-24T00:00", ref)).toBe("내일 9. 24. (목)");
    expect(dayLabel("2026-09-30T00:00", ref)).toBe("9. 30. (수)");
  });
  it("prioritizes lightning, mixed precipitation and night clouds", () => {
    expect(iconKind("cloud_rain_lightning")).toBe("lightning");
    expect(iconKind("sun_smallcloud_rainsnow")).toBe("rainsnow");
    expect(iconKind("moon_bigcloud_rain")).toBe("rain");
    expect(iconKind("cloud_snow")).toBe("snow");
    expect(iconKind("moon_bigcloud")).toBe("cloud-moon");
    expect(iconKind("sun_smallcloud")).toBe("cloud-sun");
    expect(iconKind("moon")).toBe("moon");
    expect(iconKind("sun")).toBe("sun");
    expect(iconKind("cloud")).toBe("cloud");
    expect(iconKind("")).toBe("cloud");
  });
  it("filters upcoming precipitation rows from current time and falls back when all rows are past (#3115)", () => {
    const pt = (
      at: string,
      extra: Partial<Point> = {},
    ): Point => ({
      at,
      temperature: 10,
      low: null,
      high: null,
      humidity: 50,
      wind: 1,
      windDirection: "N",
      pressure: 1013,
      visibility: 10,
      precipitation: 0,
      precipitationHours: 1,
      precipitationBasis: "forecast",
      snowfall: null,
      snowfallHours: null,
      rainProbability: 10,
      feelsLike: 10,
      icon: "sun",
      iconPm: "",
      description: "",
      sunrise: "",
      sunset: "",
      uv: "",
      discomfort: "",
      ...extra,
    });
    const current = pt("2026-09-23T10:00");
    const hourly = [
      pt("2026-09-21T00:00"),
      pt("2026-09-22T18:00"),
      pt("2026-09-23T06:00"),
      pt("2026-09-23T09:00"),
      pt("2026-09-23T10:00"),
      pt("2026-09-23T12:00", { precipitationBasis: "partial", precipitationHours: null }),
      pt("2026-09-23T15:00"),
      pt("2026-09-23T18:00"),
      pt("2026-09-23T21:00"),
      pt("2026-09-24T00:00"),
      pt("2026-09-24T03:00"),
      pt("2026-09-24T06:00"),
    ];
    const daily = [
      pt("2026-09-20T00:00"),
      pt("2026-09-21T00:00"),
      pt("2026-09-22T00:00"),
      pt("2026-09-23T00:00"),
      pt("2026-09-24T00:00"),
      pt("2026-09-25T00:00"),
      pt("2026-09-26T00:00"),
      pt("2026-09-27T00:00"),
      pt("2026-09-28T00:00"),
      pt("2026-09-29T00:00"),
      pt("2026-09-30T00:00"),
      pt("2026-10-01T00:00"),
    ];
    // Hourly keeps current + in-progress partial slot (at > current.at) + future rows, capped at 8.
    expect(
      upcomingPrecipitation({ current, hourly, daily }, "hourly").map((p) => p.at),
    ).toEqual([
      "2026-09-23T10:00",
      "2026-09-23T12:00",
      "2026-09-23T15:00",
      "2026-09-23T18:00",
      "2026-09-23T21:00",
      "2026-09-24T00:00",
      "2026-09-24T03:00",
      "2026-09-24T06:00",
    ]);
    // Overview uses the same hourly filter.
    expect(
      upcomingPrecipitation({ current, hourly, daily }, "overview")[0]?.at,
    ).toBe("2026-09-23T10:00");
    // Daily starts at today and caps at 8.
    expect(
      upcomingPrecipitation({ current, hourly, daily }, "daily").map((p) => p.at),
    ).toEqual([
      "2026-09-23T00:00",
      "2026-09-24T00:00",
      "2026-09-25T00:00",
      "2026-09-26T00:00",
      "2026-09-27T00:00",
      "2026-09-28T00:00",
      "2026-09-29T00:00",
      "2026-09-30T00:00",
    ]);
    // All-past fallback returns the last 8 rows instead of an empty list.
    const pastHourly = Array.from({ length: 10 }, (_, i) =>
      pt(`2026-09-21T${String(i).padStart(2, "0")}:00`),
    );
    expect(
      upcomingPrecipitation({ current, hourly: pastHourly, daily: daily.slice(0, 3) }, "hourly").map(
        (p) => p.at,
      ),
    ).toEqual(pastHourly.slice(-8).map((p) => p.at));
    expect(
      upcomingPrecipitation({ current, hourly: pastHourly, daily: daily.slice(0, 3) }, "daily").map(
        (p) => p.at,
      ),
    ).toEqual(daily.slice(0, 3).map((p) => p.at));
    // Unparseable current.at falls back safely to the first 8 rows (PR2-R2).
    const invalid = pt("bad");
    expect(
      upcomingPrecipitation({ current: invalid, hourly, daily }, "hourly").map((p) => p.at),
    ).toEqual(hourly.slice(0, 8).map((p) => p.at));
    expect(
      upcomingPrecipitation({ current: invalid, hourly, daily }, "daily").map((p) => p.at),
    ).toEqual(daily.slice(0, 8).map((p) => p.at));
  });
});
