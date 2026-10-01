import {
  Cloud,
  CloudFog,
  Haze,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudMoon,
  CloudHail,
  Sun,
  Moon,
  CloudLightning,
  Wind,
  LoaderCircle,
  TriangleAlert,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { formatValue, type Point, type Weather } from "@todayweather/core";
import { Fragment, type ReactNode } from "react";
import { t, useLanguage } from "./i18n";
import { hourText, instantText } from "./locale";
import {
  dayLabel,
  iconKind,
  isOld,
  relativeDay,
  type IconKind,
} from "./format";
export { dayLabel, isOld };
const ICONS: Record<IconKind, typeof Cloud> = {
  lightning: CloudLightning,
  rainsnow: CloudHail,
  rain: CloudRain,
  snow: CloudSnow,
  "cloud-moon": CloudMoon,
  "cloud-sun": CloudSun,
  moon: Moon,
  sun: Sun,
  wind: Wind,
  cloud: Cloud,
  fog: CloudFog,
  dust: Haze,
};
export function WeatherIcon({
  icon = "",
  size = 40,
}: {
  icon?: string;
  size?: number;
}) {
  const Icon = ICONS[iconKind(icon)];
  return (
    <Icon
      size={size}
      strokeWidth={1.5}
      className={`weather-icon ${Icon === Sun || Icon === CloudSun ? "sunny" : ""}`}
    />
  );
}
export function Loading() {
  return (
    <div className="empty-state skeleton" role="status">
      <LoaderCircle className="spin" size={26} />
      <p>{t("loading.weather")}</p>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="empty-state error" role="alert">
      <TriangleAlert size={28} />
      <h3>{t("error.title")}</h3>
      <p>{error instanceof Error ? error.message : t("error.retryLater")}</p>
      {retry && (
        <button className="button" onClick={retry}>
          <RefreshCw size={16} /> {t("common.retry")}
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Cloud size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Stamp({
  at,
  label,
  timeZone,
  zone,
}: {
  at: string | null | undefined;
  label?: string;
  timeZone?: "Asia/Seoul";
  /** Zone of a naive wall time: KMA/AirKorea are KST, overseas are local. */
  zone?: "KST" | "local";
}) {
  useLanguage();
  const text = stampTime(at, timeZone);
  const suffix =
    !zone || timeZone || text === t("common.noInfo")
      ? ""
      : " " + t(zone === "KST" ? "time.kst" : "time.local");
  return (
    <span className="stamp">
      {label ?? t("stamp.observed")} {text}
      {suffix}
    </span>
  );
}
/** Device-clock instants (fetch/save times) shown in Korea time. */
export function kstTime(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return t("common.noInfo");
  return instantText(date) + " " + t("time.kst");
}
function stampTime(
  at: string | null | undefined,
  timeZone?: "Asia/Seoul",
): string {
  if (!at) return t("common.noInfo");
  if (!timeZone) return at.replace("T", " ").slice(0, 19);
  // Only explicit offsets identify an instant. Naive KMA wall times must not move.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(at)) return t("common.noInfo");
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(at))
    return at.replace("T", " ").slice(0, 19);
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return t("common.noInfo");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} KST`;
}
export function DataNotice({
  weather,
  snapshot,
  refreshing = false,
  refreshFailed = false,
  notice,
}: {
  weather: Weather;
  snapshot: boolean;
  refreshing?: boolean;
  refreshFailed?: boolean;
  /** Why the stored snapshot is shown, e.g. a rate limit with its wait. */
  notice?: string;
}) {
  return (
    <>
      {weather.mode === "demo" && (
        <div className="notice demo">
          <span className="dot" />
          <strong>{t("notice.demo.title")}</strong>
          <span>{t("notice.demo.body")}</span>
        </div>
      )}
      {refreshing && (
        <div className="notice" role="status">
          <LoaderCircle className="spin" size={16} />
          <span>
            {t("notice.refreshing", { time: kstTime(weather.fetchedAt) })}
          </span>
        </div>
      )}
      {refreshFailed && (
        <div className="notice warning" role="status">
          <TriangleAlert size={16} />
          <span>
            {t("notice.refreshFailed", { time: kstTime(weather.fetchedAt) })}
          </span>
        </div>
      )}
      {snapshot && (
        <div className="notice warning" role="status">
          <TriangleAlert size={16} />
          <span>
            {notice
              ? t("notice.snapshotReason", {
                  reason: notice,
                  time: kstTime(weather.fetchedAt),
                })
              : t("notice.snapshot", { time: kstTime(weather.fetchedAt) })}
          </span>
        </div>
      )}
      {isOld(
        weather.observedAt,
        3,
        Date.now(),
        weather.source === "KMA" ? "KST" : "local",
      ) && <div className="notice warning">{t("notice.staleObservation")}</div>}
    </>
  );
}
/** Smallest horizontal distance between chart points, in SVG units. */
export const percent = (v: number | null) =>
  v === null ? "—" : `${formatValue(v)}%`;
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
/** Catalog text whose "\n" marks become line breaks. */
export function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}
export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
export function ExternalWeather() {
  return (
    <a
      className="text-link"
      href="https://www.weather.go.kr/"
      target="_blank"
      rel="noreferrer"
    >
      {t("external.kma")} <ArrowUpRight size={14} />
    </a>
  );
}
