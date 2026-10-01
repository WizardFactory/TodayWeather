/** Display persistence is independent of version-1 locations and unit settings. */
export const DISPLAY_KEY = "tw.web.v1.display";
export type DisplayPreferences = {
  version: 1;
  appearance: "system" | "light" | "dark";
  heroStyle: "sky" | "plain" | "classic";
  textScale: 0.9 | 1 | 1.15 | 1.3;
  chartExpanded: boolean;
  motion: boolean;
};
export const defaultDisplay = (): DisplayPreferences => ({
  version: 1,
  appearance: "system",
  heroStyle: "sky",
  textScale: 1,
  chartExpanded: false,
  motion: false,
});
const valid = <T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);
export function validateDisplay(
  value: unknown,
  fallback = defaultDisplay(),
): DisplayPreferences {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { version?: unknown }).version !== 1
  )
    return fallback;
  const v = value as Record<string, unknown>;
  return {
    version: 1,
    appearance: valid(
      v.appearance,
      ["system", "light", "dark"],
      fallback.appearance,
    ),
    heroStyle: valid(
      v.heroStyle,
      ["sky", "plain", "classic"],
      fallback.heroStyle,
    ),
    textScale: valid(v.textScale, [0.9, 1, 1.15, 1.3], fallback.textScale),
    chartExpanded:
      typeof v.chartExpanded === "boolean"
        ? v.chartExpanded
        : fallback.chartExpanded,
    motion: typeof v.motion === "boolean" ? v.motion : fallback.motion,
  };
}
export function restoreDisplay(
  storage: Pick<Storage, "getItem">,
): DisplayPreferences {
  try {
    const raw = storage.getItem(DISPLAY_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1) return validateDisplay(parsed);
      } catch {
        /* Fall back to legacy. */
      }
    }
    const saved = JSON.parse(
      storage.getItem("tw.web.v1.preferences") ?? "null",
    );
    const theme = saved?.version === 1 ? saved.settings?.theme : undefined;
    if (["light", "dark", "photo", "classic"].includes(theme))
      return {
        ...defaultDisplay(),
        appearance: theme === "dark" ? "dark" : "light",
        heroStyle:
          theme === "photo" ? "sky" : theme === "classic" ? "classic" : "plain",
      };
  } catch {
    /* Unavailable storage keeps defaults. */
  }
  return defaultDisplay();
}
export function saveDisplay(
  value: DisplayPreferences,
  storage: Pick<Storage, "setItem">,
): boolean {
  try {
    storage.setItem(DISPLAY_KEY, JSON.stringify(validateDisplay(value)));
    return true;
  } catch {
    return false;
  }
}
export function resolvedAppearance(
  value: DisplayPreferences,
  osDark: boolean,
): "light" | "dark" {
  return value.appearance === "system"
    ? osDark
      ? "dark"
      : "light"
    : value.appearance;
}
export function legacyTheme(
  value: DisplayPreferences,
  osDark: boolean,
): "light" | "dark" | "photo" | "classic" {
  return value.heroStyle === "sky"
    ? "photo"
    : value.heroStyle === "classic"
      ? "classic"
      : resolvedAppearance(value, osDark);
}
export function applyDisplay(value: DisplayPreferences, osDark: boolean) {
  const root = document.documentElement;
  root.dataset.appearance = value.appearance;
  root.dataset.resolvedAppearance = resolvedAppearance(value, osDark);
  root.dataset.heroStyle = value.heroStyle;
  root.dataset.motion = String(value.motion);
  root.dataset.theme = legacyTheme(value, osDark);
  root.style.setProperty("--tw-text-scale", String(value.textScale));
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(root).getPropertyValue("--tw-bg-canvas").trim(),
    );
}
