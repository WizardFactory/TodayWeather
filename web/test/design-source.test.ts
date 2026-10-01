import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
it("production styles use shared colors and rem typography with no dead selectors or native confirm", () => {
  const dir = resolve("web/src"),
    css = readFileSync(resolve(dir, "style.css"), "utf8");
  expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(css).not.toMatch(/font-size\s*:\s*\d+(?:\.\d+)?px/);
  expect(css).not.toMatch(
    /\.(weekday-picker|alarm-times|toggle-label|form-actions|neutral|danger|text-button)(?![\w-])/,
  );
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
    const source = readFileSync(resolve(dir, name), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(source, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source, name).not.toContain("window.confirm");
  }
  expect(css.replace(/@font-face\s*\{[^}]+\}/g, "")).not.toMatch(
    /(?:font-weight|line-height):\s*\d/,
  );
  const generated = readFileSync(resolve(dir, "generated/tokens.css"), "utf8"),
    defined = new Set(
      [...(css + generated).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    );
  for (const name of css.matchAll(/var\((--[\w-]+)/g))
    expect(defined.has(name[1]), name[1]).toBe(true);
});
