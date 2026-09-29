import { afterEach, describe, expect, it } from "vitest";
import ko from "../src/i18n/ko";
import en from "../src/i18n/en";
import es from "../src/i18n/es";
import ja from "../src/i18n/ja";
import de from "../src/i18n/de";
import pt from "../src/i18n/pt";
import fr from "../src/i18n/fr";
import { detectLanguage, LANGUAGES, setLanguage, t } from "../src/i18n";
import { dayLabel, relativeDay } from "../src/format";

const catalogs = { ko, en, es, ja, de, pt, fr } as Record<
  string,
  Record<string, string>
>;
const holes = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

describe("catalogs", () => {
  it("cover the seven supported languages", () => {
    expect([...LANGUAGES].sort()).toEqual(
      ["de", "en", "es", "fr", "ja", "ko", "pt"].sort(),
    );
  });
  it("share the Korean keys and placeholders, with no empty text", () => {
    const keys = Object.keys(ko).sort();
    expect(keys.length).toBeGreaterThan(300);
    for (const [code, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), code).toEqual(keys);
      for (const key of keys) {
        expect(catalog[key].trim(), `${code} ${key}`).not.toBe("");
        expect(holes(catalog[key]), `${code} ${key}`).toBe(
          holes((ko as Record<string, string>)[key]),
        );
      }
    }
  });
  it("leave no Korean text in the other languages", () => {
    for (const [code, catalog] of Object.entries(catalogs)) {
      if (code === "ko") continue;
      const korean = Object.entries(catalog).filter(([, v]) =>
        /[가-힣]/.test(v),
      );
      // Only the Korean provider names quoted in attributions may stay.
      expect(
        korean.filter(([k]) => !k.startsWith("air.source")),
        code,
      ).toEqual([]);
    }
  });
});

describe("language detection", () => {
  it("takes the first supported browser language, ignores the region and falls back to English", () => {
    expect(detectLanguage(["ja-JP", "en-US"])).toBe("ja");
    expect(detectLanguage(["pt-BR"])).toBe("pt");
    expect(detectLanguage(["EN-gb"])).toBe("en");
    expect(detectLanguage(["zh-CN", "de-AT"])).toBe("de");
    expect(detectLanguage(["zh-CN"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
    expect(detectLanguage(["zh-TW", "it-IT"])).toBe("en");
  });
});

describe("formatting follows the selected language", () => {
  afterEach(async () => {
    await setLanguage("ko");
  });
  const ref = "2026-09-23 09:00";
  it("keeps the Korean relative-day words", async () => {
    await setLanguage("ko");
    expect(relativeDay("2026-09-24 00:00", ref)).toBe("내일");
    expect(relativeDay("2026-09-26 00:00", ref)).toBe("글피");
  });
  it("uses each language's words for nearby days", async () => {
    await setLanguage("en");
    expect(relativeDay("2026-09-22 00:00", ref)).toBe("Yesterday");
    expect(relativeDay("2026-09-23 00:00", ref)).toBe("Today");
    expect(relativeDay("2026-09-24 00:00", ref)).toBe("Tomorrow");
    expect(relativeDay("2026-09-28 00:00", ref)).toBe("");
    expect(dayLabel("2026-09-24 00:00")).toMatch(/Thu/);
    await setLanguage("de");
    expect(relativeDay("2026-09-25 00:00", ref)).toBe("Übermorgen");
    await setLanguage("ja");
    expect(relativeDay("2026-09-22 00:00", ref)).toBe("昨日");
  });
  it("interpolates parameters", async () => {
    await setLanguage("en");
    expect(t("error.rateLimitSeconds", { seconds: 30 })).toContain("30");
    expect(t("settings.language")).toBe("Language");
  });
});
