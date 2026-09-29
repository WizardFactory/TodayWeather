import { afterEach, describe, expect, it, vi } from "vitest";
import { compassPoint, formatValue } from "@todayweather/core";
import { windText } from "../src/format";
import {
  configureFormats,
  dateText,
  defaultUnits,
  detectRegion,
  hourText,
  MANAGED_REGIONS,
  autoUnits,
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
  it("reads the country from the device language only", () => {
    expect(detectRegion(["pt-BR"])).toBe("BR");
    expect(detectRegion(["ko", "ko-KR", "en-US"])).toBe("KR");
    expect(detectRegion(["zh-Hant-TW"])).toBe("TW");
    expect(detectRegion(["fr"])).toBeNull();
    // Another language's region is not the user's country.
    expect(detectRegion(["ko", "en-US", "en"])).toBeNull();
    expect(detectRegion(["de", "en-US", "en"])).toBeNull();
    expect(detectRegion([])).toBeNull();
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

describe("demo builds (independent verification MEDIUM-1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    configureFormats(["ko-KR"]);
  });
  it("keep the Korean air standard the demo data has, in any country", () => {
    vi.stubEnv("VITE_WEB_MODE", "demo");
    configureFormats(["en-US"]);
    expect(autoUnits().airUnit).toBe("airkorea");
    expect(autoUnits().temperatureUnit).toBe("F");
  });
});

describe("overseas wind direction", () => {
  afterEach(async () => {
    await setLanguage("ko");
  });
  it("turns degrees into the 16 compass points and shows them in the UI language", async () => {
    expect(
      [0, 11, 12, 83, 180, 206, 350, 359, -10, 720].map(compassPoint),
    ).toEqual(["N", "N", "NNE", "E", "S", "SSW", "N", "N", "N", "N"]);
    await setLanguage("ko");
    expect(windText("E")).toBe("동");
    await setLanguage("de");
    expect(windText("E")).toBe("O");
    await setLanguage("ja");
    expect(windText("SSW")).toBe("南南西");
    // Server text that is not a code stays as received.
    expect(windText("북북동")).toBe("북북동");
  });
});
