import { describe, expect, it } from "vitest";
import {
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
} from "../src/format";

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
});
