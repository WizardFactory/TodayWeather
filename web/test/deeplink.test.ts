import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nearbySaved, parseCoordinateLink, shareLink } from "../src/deeplink";

const golden = JSON.parse(readFileSync("specs/deeplink.golden.json", "utf8"));
describe("web deep-link contract", () => {
  it("parses coordinate links using the shared golden vectors", () => {
    for (const row of golden.parseCases) {
      if (!row.url.startsWith("https://link.todayweather.ai/loc")) continue;
      const actual = parseCoordinateLink(new URL(row.url).searchParams);
      const expected = row.native && {
        lat: row.native.lat,
        lon: row.native.lon,
        name: row.native.name,
        view: row.native.view,
        pollutant: row.native.pollutant,
      };
      expect(actual, row.id).toEqual(expected);
    }
  });

  it("preserves markup-like display names as plain text values", () => {
    const query = new URLSearchParams({
      lat: "0",
      lon: "0",
      name: " <b>North</b> ",
    });
    expect(parseCoordinateLink(query)?.name).toBe("<b>North</b>");
  });

  it("shares already stored names with lone surrogates and keeps emoji", () => {
    const url = shareLink({ lat: 0, lon: 0, name: "North \ud800 🌦️" });
    expect(new URL(url).searchParams.get("name")).toBe("North � 🌦️");
  });

  it("matches an inclusive 0.01 degree boundary on both axes", () => {
    const saved = {
      id: "favorite",
      name: "Favorite",
      address: "",
      country: "",
      lat: 37.566,
      lon: 126.978,
    };
    expect(nearbySaved([saved], 37.556, 126.968)).toBe(saved);
    expect(nearbySaved([saved], 37.555, 126.968)).toBeUndefined();
  });

  it("generates the golden URLs including GPS rounding and catalog air sharing", () => {
    for (const row of golden.shareBuildCases) {
      const { placeId, ...place } = row.input;
      expect(
        shareLink({ ...place, id: placeId }, place.view, place.pollutant),
        row.id,
      ).toBe(row.url);
    }
  });
});
