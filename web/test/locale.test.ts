import { afterEach, describe, expect, it } from "vitest";
import { formatValue } from "@todayweather/core";
import {
  configureFormats,
  dateText,
  defaultUnits,
  detectRegion,
  hourText,
  MANAGED_REGIONS,
} from "../src/locale";
import { setLanguage } from "../src/i18n";
import { defaultState, restoreState } from "../src/state";

const row = (units: ReturnType<typeof defaultUnits>) =>
  [
    units.temperatureUnit,
    units.windSpeedUnit,
    units.pressureUnit,
    units.distanceUnit,
    units.precipitationUnit,
    units.airUnit,
  ].join(" ");

describe("default units by country (#2613)", () => {
  it("follows the owner's table for every managed country", () => {
    const expected: Record<string, string> = {
      KR: "C m/s hPa km mm airkorea",
      JP: "C m/s hPa km mm airnow",
      US: "F mph inHg mi in airnow",
      GB: "C mph hPa mi mm airnow",
    };
    for (const region of MANAGED_REGIONS)
      expect(row(defaultUnits(region)), region).toBe(
        expected[region] ?? "C km/h hPa km mm airnow",
      );
  });
  it("uses the international standard for any other or unknown country", () => {
    for (const region of ["VN", "IT", "NL", null])
      expect(row(defaultUnits(region)), String(region)).toBe(
        "C m/s hPa km mm airnow",
      );
  });
  it("reads the country from the first browser language with a region", () => {
    expect(detectRegion(["pt-BR"])).toBe("BR");
    expect(detectRegion(["ko", "en-US"])).toBe("US");
    expect(detectRegion(["zh-Hant-TW"])).toBe("TW");
    expect(detectRegion(["fr"])).toBeNull();
  });
});

describe("saved units", () => {
  afterEach(() => configureFormats(["ko-KR"]));
  it("new installs take the country defaults; saved units never change", () => {
    configureFormats(["en-US"]);
    expect(row(defaultState().settings.units)).toBe("F mph inHg mi in airnow");
    // Saved before automatic defaults existed: every stored unit stays.
    const legacy = JSON.stringify({
      version: 1,
      places: [],
      selectedId: null,
      settings: {
        units: {
          temperatureUnit: "C",
          windSpeedUnit: "m/s",
          pressureUnit: "hPa",
          distanceUnit: "km",
          precipitationUnit: "mm",
          airUnit: "airkorea",
        },
      },
    });
    expect(row(restoreState({ getItem: () => legacy }).settings.units)).toBe(
      "C m/s hPa km mm airkorea",
    );
    // Only automatic units follow a new country; the user's choice stays.
    const mixed = JSON.stringify({
      ...JSON.parse(legacy),
      settings: {
        ...JSON.parse(legacy).settings,
        userUnits: ["temperatureUnit"],
      },
    });
    configureFormats(["pt-BR"]);
    expect(row(restoreState({ getItem: () => mixed }).settings.units)).toBe(
      "C km/h hPa km mm airnow",
    );
    configureFormats(["en-US"]);
    expect(row(restoreState({ getItem: () => mixed }).settings.units)).toBe(
      "C mph inHg mi in airnow",
    );
  });
});

describe("date, hour and number conventions", () => {
  afterEach(async () => {
    configureFormats(["ko-KR"]);
    await setLanguage("ko");
  });
  const at = "2026-09-24 15:00";
  async function as(tag: string) {
    configureFormats([tag]);
    await setLanguage(
      (["ko", "en", "es", "ja", "de", "pt", "fr"] as const).find((l) =>
        tag.startsWith(l),
      ) ?? "en",
    );
  }
  it("en-US: 12-hour, month/day, decimal point", async () => {
    await as("en-US");
    expect(hourText(at)).toMatch(/3:00\s?PM/);
    expect(dateText(at)).toBe("9/24");
    expect(formatValue(0.5, 1)).toBe("0.5");
  });
  it("de-DE, fr-FR, pt-BR, es-ES: 24-hour, day before month, decimal comma", async () => {
    for (const tag of ["de-DE", "fr-FR", "pt-BR", "es-ES"]) {
      await as(tag);
      expect(hourText(at), tag).toMatch(/15/);
      expect(dateText(at), tag).toMatch(/^24\D+0?9/);
      expect(formatValue(0.5, 1), tag).toBe("0,5");
    }
  });
  it("es-MX keeps the decimal point", async () => {
    await as("es-MX");
    expect(formatValue(0.5, 1)).toBe("0.5");
  });
  it("unmanaged countries use the international standard", async () => {
    for (const tag of ["it-IT", "vi-VN", "en"]) {
      await as(tag);
      expect(hourText(at), tag).toBe("15:00");
      expect(dateText(at), tag).toBe("09-24");
      expect(formatValue(0.5, 1), tag).toBe("0.5");
    }
  });
  it("ko-KR, ja-JP and en-GB follow their locale data", async () => {
    for (const tag of ["ko-KR", "ja-JP", "en-GB"]) {
      await as(tag);
      expect(hourText(at), tag).toBe(
        new Intl.DateTimeFormat(tag, {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
        }).format(new Date("2000-01-01T15:00:00Z")),
      );
    }
  });
});
