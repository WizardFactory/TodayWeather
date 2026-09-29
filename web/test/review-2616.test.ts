// PR #2616 review (2026-09-29): language race, device-locale formats and the
// newest snapshot of another language.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UNITS, formatValue, PLACES } from "@todayweather/core";
import { language, setLanguage, t } from "../src/i18n";
import {
  configureFormats,
  dateText,
  hourText,
  instantText,
} from "../src/locale";
import { readAnySnapshot } from "../src/api";
import { weatherKey } from "../src/state";

// German loads slowly, so a later choice finishes first.
vi.mock("../src/i18n/de", async (original) => {
  await new Promise((r) => setTimeout(r, 50));
  return original();
});

afterEach(async () => {
  configureFormats(["ko-KR"]);
  await setLanguage("ko");
});

describe("language choices", () => {
  it("apply only the last choice, also when it returns to the current language", async () => {
    await setLanguage("ko");
    await Promise.all([setLanguage("en"), setLanguage("ko")]);
    expect(language()).toBe("ko");
    expect(t("settings.title")).toBe("설정");
  });
  it("ignore an earlier choice that finishes later", async () => {
    await Promise.all([setLanguage("de"), setLanguage("ja")]);
    expect(language()).toBe("ja");
  });
});

describe("device-locale formats with another UI language (#2613)", () => {
  const at = "2026-09-24 15:00";
  it("en-US device, French UI: US order, 12-hour clock and decimal point", async () => {
    configureFormats(["en-US"]);
    await setLanguage("fr");
    expect(hourText(at)).toMatch(/^3:00\s?PM$/);
    expect(dateText(at)).toBe("9/24");
    expect(dateText(at, true)).toMatch(/^jeu\.?, 9\/24$/);
    expect(formatValue(5.4, 1)).toBe("5.4");
    expect(instantText(new Date("2026-09-24T06:00:00Z"))).toMatch(
      /^9\/24, 3:00\s?PM$/,
    );
  });
  it("pt-BR device, English UI: Brazilian order, 24-hour clock and decimal comma", async () => {
    configureFormats(["pt-BR"]);
    await setLanguage("en");
    expect(hourText(at)).toBe("15:00");
    expect(dateText(at)).toBe("24/09");
    expect(dateText(at, true)).toMatch(/^Thu\.?, 24\/09$/);
    expect(formatValue(5.4, 1)).toBe("5,4");
  });
});

describe("stored weather of another language", () => {
  it("is the newest valid snapshot", async () => {
    const place = PLACES[0];
    const snap = (fetchedAt: string) => ({ fetchedAt }) as any;
    const stored = new Map<string, any>([
      [weatherKey(place, DEFAULT_UNITS, "ko"), snap("2026-09-28T16:00:00Z")],
      [weatherKey(place, DEFAULT_UNITS, "en"), snap("2026-09-29T11:59:00Z")],
      [weatherKey(place, DEFAULT_UNITS, "de"), snap("not a time")],
    ]);
    const read = async (key: string) => stored.get(key);
    const found = await readAnySnapshot(
      weatherKey(place, DEFAULT_UNITS, "fr"),
      read,
    );
    expect(found?.fetchedAt).toBe("2026-09-29T11:59:00Z");
    // The current language's own snapshot still wins.
    stored.set(
      weatherKey(place, DEFAULT_UNITS, "fr"),
      snap("2026-09-01T00:00:00Z"),
    );
    expect(
      (await readAnySnapshot(weatherKey(place, DEFAULT_UNITS, "fr"), read))
        ?.fetchedAt,
    ).toBe("2026-09-01T00:00:00Z");
  });
});
