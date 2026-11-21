import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_STORE_URL,
  FIXED_APP_QR_URL,
  PLAY_STORE_URL,
  appOpenHref,
  canonicalLinkForRoute,
  detectMobilePlatform,
  nearbySaved,
  parseCoordinateLink,
  shareLink,
} from "../src/deeplink";
import { APP_QR_PATH, APP_QR_VIEWBOX } from "../src/AppQrCode";

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

  it("maps current web routes to canonical link.todayweather.ai URLs", () => {
    const saved = [
      {
        id: "p_37.383_127.119",
        name: "분당구",
        address: "",
        country: "KR",
        lat: 37.383,
        lon: 127.119,
      },
    ];
    expect(canonicalLinkForRoute("/weather/seoul/hourly", "", saved)).toBe(
      "https://link.todayweather.ai/place/seoul",
    );
    expect(canonicalLinkForRoute("/weather/seoul/daily", "", saved)).toBe(
      "https://link.todayweather.ai/place/seoul?view=daily",
    );
    expect(
      canonicalLinkForRoute("/air/seoul", "?pollutant=pm25&from=link", saved),
    ).toBe("https://link.todayweather.ai/air/seoul?pollutant=pm25");
    expect(
      canonicalLinkForRoute(
        "/weather/p_37.383_127.119/daily",
        "?from=link",
        saved,
      ),
    ).toBe(
      "https://link.todayweather.ai/loc?lat=37.383&lon=127.119&name=%EB%B6%84%EB%8B%B9%EA%B5%AC&view=daily",
    );
    expect(
      canonicalLinkForRoute(
        "/loc",
        "?lat=0&lon=0&name=%EC%A0%81%EB%8F%84&view=daily&from=link",
        saved,
      ),
    ).toBe(
      "https://link.todayweather.ai/loc?lat=0&lon=0&name=%EC%A0%81%EB%8F%84&view=daily",
    );
    expect(canonicalLinkForRoute("/nation/weather", "", saved)).toBe(
      "https://link.todayweather.ai/nation/weather",
    );
    expect(canonicalLinkForRoute("/nation/air", "", saved)).toBe(
      "https://link.todayweather.ai/nation/air",
    );
    expect(canonicalLinkForRoute("/warnings", "", saved)).toBe(
      "https://link.todayweather.ai/warnings",
    );
    expect(canonicalLinkForRoute("/locations", "", saved)).toBe(
      "https://link.todayweather.ai/open",
    );
  });

  it("builds OS-specific app-open URLs preserving the current place and store fallback", () => {
    const placeUrl = "https://link.todayweather.ai/place/seoul?view=daily";
    const androidUa =
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36";
    const iosUa =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
    const macUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

    expect(detectMobilePlatform(androidUa, 5)).toBe("android");
    expect(detectMobilePlatform(iosUa, 5)).toBe("ios");
    expect(detectMobilePlatform(macUa, 5)).toBe("ipados");
    expect(detectMobilePlatform(macUa, 0)).toBe("desktop");

    expect(appOpenHref(placeUrl, androidUa, 5)).toBe(
      "intent://link.todayweather.ai/place/seoul?view=daily#Intent;scheme=https;package=net.wizardfactory.todayweather;S.browser_fallback_url=" +
        encodeURIComponent(PLAY_STORE_URL) +
        ";end",
    );
    expect(appOpenHref(placeUrl, iosUa, 5)).toBe(
      "https://link.todayweather.ai/place/seoul?view=daily&fallback=store",
    );
    expect(appOpenHref(placeUrl, macUa, 5)).toBe(
      "https://link.todayweather.ai/place/seoul?view=daily&fallback=store&store=ios",
    );
    expect(appOpenHref("https://link.todayweather.ai/open", macUa, 0)).toBe(
      "https://link.todayweather.ai/open?fallback=store",
    );
    expect(APP_STORE_URL).toBe("https://apps.apple.com/app/id1041700694");
    expect(FIXED_APP_QR_URL).toBe(
      "https://link.todayweather.ai/open?fallback=store",
    );
  });

  it("renders a valid ISO/IEC 18004 QR SVG decoding to the fixed store-fallback URL", () => {
    expect(APP_QR_VIEWBOX).toBe("0 0 41 41");
    const SIZE = 33;
    const Q = 4;
    const m = Array.from({ length: SIZE }, () => new Uint8Array(SIZE));
    for (const match of APP_QR_PATH.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const c0 = Number(match[1]) - Q;
      const r = Number(match[2]) - Q;
      const w = Number(match[3]);
      for (let dc = 0; dc < w; dc++) m[r][c0 + dc] = 1;
    }

    // Verify dark module and both format strips match ISO/IEC 18004 Table C.1.
    expect(m[SIZE - 8][8]).toBe(1);
    const coordsA = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    const coordsB = [
      [SIZE - 1, 8], [SIZE - 2, 8], [SIZE - 3, 8], [SIZE - 4, 8], [SIZE - 5, 8], [SIZE - 6, 8], [SIZE - 7, 8],
      [8, SIZE - 8], [8, SIZE - 7], [8, SIZE - 6], [8, SIZE - 5], [8, SIZE - 4], [8, SIZE - 3], [8, SIZE - 2], [8, SIZE - 1],
    ];
    let fmtA = 0;
    let fmtB = 0;
    for (let i = 0; i < 15; i++) {
      fmtA = (fmtA << 1) | m[coordsA[i][0]][coordsA[i][1]];
      fmtB = (fmtB << 1) | m[coordsB[i][0]][coordsB[i][1]];
    }
    expect(fmtA).toBe(fmtB);
    const unmaskedFmt = fmtA ^ 0x5412;
    const ecBits = (unmaskedFmt >> 13) & 0b11;
    const maskId = (unmaskedFmt >> 10) & 0b111;
    expect(ecBits).toBe(0b00); // Level M
    // Check BCH(15,5) remainder is 0.
    let rem = unmaskedFmt;
    for (let i = 14; i >= 10; i--) {
      if (rem & (1 << i)) rem ^= 0b10100110111 << (i - 10);
    }
    expect(rem).toBe(0);

    // Mark function modules and unmask data bits.
    const isFunc = Array.from({ length: SIZE }, () => new Uint8Array(SIZE));
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) isFunc[r][c] = 1;
    for (let r = 0; r < 9; r++) for (let c = SIZE - 8; c < SIZE; c++) isFunc[r][c] = 1;
    for (let r = SIZE - 8; r < SIZE; r++) for (let c = 0; c < 9; c++) isFunc[r][c] = 1;
    for (let i = 0; i < SIZE; i++) { isFunc[6][i] = 1; isFunc[i][6] = 1; }
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) isFunc[26 + dr][26 + dc] = 1;

    const maskPredicates = [
      (r: number, c: number) => (r + c) % 2 === 0,
      (r: number) => r % 2 === 0,
      (_r: number, c: number) => c % 3 === 0,
      (r: number, c: number) => (r + c) % 3 === 0,
      (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ];
    const bits: number[] = [];
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let step = 0; step < SIZE; step++) {
        const r = upward ? SIZE - 1 - step : step;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            bits.push(m[r][c] ^ (maskPredicates[maskId](r, c) ? 1 : 0));
          }
        }
      }
      upward = !upward;
    }
    const cw: number[] = [];
    for (let i = 0; i + 8 <= bits.length && cw.length < 100; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    // De-interleave 2 blocks (32 data + 18 EC) and check RS syndromes over GF(256).
    const EXP = new Uint8Array(512);
    const LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const gfMul = (a: number, b: number) =>
      a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

    const block1: number[] = [];
    const block2: number[] = [];
    for (let i = 0; i < 32; i++) {
      block1.push(cw[i * 2]);
      block2.push(cw[i * 2 + 1]);
    }
    for (let i = 0; i < 18; i++) {
      block1.push(cw[64 + i * 2]);
      block2.push(cw[64 + i * 2 + 1]);
    }
    for (const block of [block1, block2]) {
      for (let s = 0; s < 18; s++) {
        let acc = 0;
        for (const coeff of block) acc = gfMul(acc, EXP[s]) ^ coeff;
        expect(acc).toBe(0);
      }
    }
    const dataBits: number[] = [];
    for (const b of [...block1.slice(0, 32), ...block2.slice(0, 32)]) {
      for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
    }
    const readBits = (offset: number, count: number) => {
      let v = 0;
      for (let i = 0; i < count; i++) v = (v << 1) | dataBits[offset + i];
      return v;
    };
    expect(readBits(0, 4)).toBe(0b0100); // Byte mode
    const len = readBits(4, 8);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = readBits(12 + i * 8, 8);
    expect(new TextDecoder().decode(bytes)).toBe(FIXED_APP_QR_URL);
  });
});
