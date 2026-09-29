import { useSyncExternalStore } from "react";
import ko from "./ko";

export type MessageKey = keyof typeof ko;
/** Every language provides exactly the Korean keys. */
export type Catalog = Record<MessageKey, string>;

export const LANGUAGES = ["ko", "en", "es", "ja", "de", "pt", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];
/** Shown in the language picker in each language's own name. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  ko: "한국어",
  en: "English",
  es: "Español",
  ja: "日本語",
  de: "Deutsch",
  pt: "Português",
  fr: "Français",
};
// Korean ships in the main bundle; the others load on demand and are
// precached with the other assets for offline use.
const loaders: Record<
  Exclude<Language, "ko">,
  () => Promise<{ default: Catalog }>
> = {
  en: () => import("./en"),
  es: () => import("./es"),
  ja: () => import("./ja"),
  de: () => import("./de"),
  pt: () => import("./pt"),
  fr: () => import("./fr"),
};

let current: Language = "ko";
let catalog: Catalog = ko;
const listeners = new Set<() => void>();

export const isLanguage = (value: unknown): value is Language =>
  (LANGUAGES as readonly unknown[]).includes(value);

/** First supported browser language (region ignored), else English (#2613). */
export function detectLanguage(list: readonly string[]): Language {
  for (const tag of list) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLanguage(primary)) return primary;
  }
  return "en";
}

export const language = () => current;

let requests = 0;
/**
 * Loads and applies a language. Only the latest call applies: an earlier
 * choice that finishes later, or fails, is ignored (PR #2616 review).
 */
export async function setLanguage(next: Language): Promise<void> {
  const request = ++requests;
  if (next === current) return;
  let loaded: Catalog;
  try {
    loaded = next === "ko" ? ko : (await loaders[next]()).default;
  } catch (error) {
    if (request === requests) throw error;
    return;
  }
  if (request !== requests) return;
  current = next;
  catalog = loaded;
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
    document.title = loaded["app.title"];
  }
  for (const listener of listeners) listener();
}

/** Catalog text with `{name}` placeholders filled from `params`. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const text: string = catalog[key] ?? ko[key] ?? key;
  return params
    ? text.replace(/\{(\w+)\}/g, (hole, name: string) =>
        name in params ? String(params[name]) : hole,
      )
    : text;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Runs `listener` after every language change; returns the unsubscribe. */
export const onLanguageChange = (listener: () => void) => subscribe(listener);
/** Re-renders the caller when the language changes. */
export const useLanguage = () =>
  useSyncExternalStore(subscribe, language, language);

// Korean text produced by the shared data layer (and kept in stored
// snapshots) is translated at display time.
const CORE_TEXT: Record<string, MessageKey> = {
  "선택한 지역": "place.selected",
  "관측소 정보 없음": "air.noStation",
  "기상 특보": "warnings.defaultName",
  "어제 같은 시각의 기온을 제공하지 않습니다.": "notice.noYesterday",
  "이 지역의 대기질 관측 자료를 제공하지 않습니다.": "notice.noAir",
};
export const coreText = (text: string) =>
  text in CORE_TEXT ? t(CORE_TEXT[text]) : text;
