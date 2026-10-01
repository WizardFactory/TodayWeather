import { expect, it } from "vitest";
import { defaultDisplay, DISPLAY_KEY, restoreDisplay } from "../src/display";
import { defaultState, STATE_KEY, saveState, restoreState } from "../src/state";
const store = (values: Record<string, string> = {}) => ({
  getItem: (k: string) => values[k] ?? null,
  setItem: (k: string, v: string) => {
    values[k] = v;
  },
});
it.each([
  ["light", "light", "plain"],
  ["dark", "dark", "plain"],
  ["photo", "light", "sky"],
  ["classic", "light", "classic"],
])(
  "migrates legacy %s without rewriting places or units",
  (theme, appearance, heroStyle) => {
    const s = store({
      [STATE_KEY]: JSON.stringify({
        ...defaultState(),
        settings: { ...defaultState().settings, theme },
      }),
    });
    expect(restoreDisplay(s)).toEqual({
      ...defaultDisplay(),
      appearance,
      heroStyle,
    });
  },
);
it("independent display values survive an older build rewriting only generic preferences", () => {
  const wanted = {
    ...defaultDisplay(),
    appearance: "dark",
    heroStyle: "plain",
    textScale: 1.3,
    chartExpanded: true,
  };
  const s = store({ [DISPLAY_KEY]: JSON.stringify(wanted) });
  saveState(defaultState(), s);
  expect(restoreState(s).settings.theme).toBe("light");
  expect(restoreDisplay(s)).toEqual(wanted);
});
it("validates each field independently and recovers from corrupt/unavailable storage", () => {
  const s = store({
    [DISPLAY_KEY]: JSON.stringify({
      version: 1,
      appearance: "script",
      heroStyle: "classic",
      textScale: 1.3,
      chartExpanded: "true",
      motion: true,
    }),
  });
  expect(restoreDisplay(s)).toEqual({
    ...defaultDisplay(),
    heroStyle: "classic",
    textScale: 1.3,
    motion: true,
  });
  expect(restoreDisplay(store({ [DISPLAY_KEY]: "{" }))).toEqual(
    defaultDisplay(),
  );
  expect(
    restoreDisplay({
      getItem() {
        throw Error("unavailable");
      },
    }),
  ).toEqual(defaultDisplay());
});

import { legacyTheme, saveDisplay, validateDisplay } from "../src/display";
it("dual-write values stay valid for a rolled-back build, including system changes", () => {
  for (const heroStyle of ["sky", "plain", "classic"] as const)
    for (const appearance of ["system", "light", "dark"] as const)
      for (const osDark of [false, true]) {
        expect(["light", "dark", "photo", "classic"]).toContain(
          legacyTheme({ ...defaultDisplay(), heroStyle, appearance }, osDark),
        );
      }
  expect(legacyTheme({ ...defaultDisplay(), heroStyle: "plain" }, true)).toBe(
    "dark",
  );
  expect(
    saveDisplay(defaultDisplay(), {
      setItem() {
        throw Error("quota");
      },
    }),
  ).toBe(false);
  expect(validateDisplay({ version: 2, textScale: 1.3 })).toEqual(
    defaultDisplay(),
  );
});
