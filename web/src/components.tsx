import {
  Cloud,
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
    <div className="empty-state" role="status">
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
const CHART_MIN_GAP = 52;
/** Rough width of an 11px chart label: CJK/Hangul glyphs are about square. */
const labelWidth = (text: string) =>
  [...text].reduce((w, c) => w + (/[\u1100-\uffff]/.test(c) ? 11 : 6.6), 0);
export const hourLabel = hourText;
export function TemperatureChart({
  points,
  yesterday,
  unit,
  reference,
}: {
  points: Point[];
  yesterday: Point[];
  unit: string;
  reference: string;
}) {
  const data = points.slice(0, 16),
    temps = [...data, ...yesterday]
      .map((p) => p.temperature)
      .filter((v): v is number => v !== null);
  if (!data.length || !temps.length) return <Empty title={t("chart.empty")} />;
  // Rows mix 1-hour and 3-hour steps; position by time, not by index, but
  // keep the closest points far enough apart that hour labels never touch.
  const minutes = (p: Point) => Date.parse(p.at + ":00Z") / 60000,
    start = minutes(data[0]),
    span = Math.max(minutes(data[data.length - 1]) - start, 1),
    step = Math.min(
      ...data.slice(1).map((p, i) => minutes(p) - minutes(data[i])),
      span,
    );
  // Regional hour labels ("3:00 PM", "오후 3:00") need more room than "15:00".
  const gap = Math.max(
    CHART_MIN_GAP,
    ...data.map((p) => labelWidth(hourLabel(p.at)) + 12),
  );
  const low = Math.min(...temps) - 3,
    range = Math.max(...temps) - low + 4,
    width = Math.ceil(
      Math.max(720, data.length * 68, 76 + (span * gap) / step),
    ),
    height = 220;
  const x = (i: number) =>
      data.length > 1
        ? 38 + ((minutes(data[i]) - start) * (width - 76)) / span
        : width / 2,
    y = (v: number) => height - 36 - ((v - low) / range) * (height - 70);
  const midnights = data
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) => i > 0 && p.at.slice(0, 10) !== data[i - 1].at.slice(0, 10),
    );
  const segments = (rows: Point[]) => {
    let previous = false;
    return rows
      .map((p, i) => {
        if (p.temperature === null) {
          previous = false;
          return "";
        }
        const part = `${previous ? "L" : "M"} ${x(i)} ${y(p.temperature)}`;
        previous = true;
        return part;
      })
      .join(" ");
  };
  return (
    <>
      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
          role="img"
          aria-label={t("chart.label")}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4c8eff" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#4c8eff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2].map((i) => (
            <line
              key={i}
              x1="20"
              x2={width - 20}
              y1={50 + i * 60}
              y2={50 + i * 60}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
          ))}
          {midnights.map(({ p, i }) => {
            const mx = (x(i - 1) + x(i)) / 2;
            return (
              <g key={"day" + p.at}>
                <line
                  x1={mx}
                  x2={mx}
                  y1={20}
                  y2={height - 28}
                  stroke="var(--line)"
                  strokeWidth="2"
                />
                <text x={mx + 6} y={30} className="chart-day-label">
                  {relativeDay(p.at, reference) || dayLabel(p.at)}
                </text>
              </g>
            );
          })}
          <path
            d={segments(yesterday.slice(0, data.length))}
            fill="none"
            stroke="#aebdce"
            strokeWidth="2"
            strokeDasharray="5 6"
          />
          <path
            d={segments(data)}
            fill="none"
            stroke="#4087ef"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {data.map((p, i) => (
            <g key={p.at}>
              {p.temperature !== null && (
                <>
                  <circle
                    cx={x(i)}
                    cy={y(p.temperature)}
                    r="4"
                    fill="var(--panel)"
                    stroke="#4087ef"
                    strokeWidth="2"
                  />
                  <text
                    x={x(i)}
                    y={y(p.temperature) - 15}
                    textAnchor="middle"
                    className="chart-value"
                  >
                    {formatValue(p.temperature)}°
                  </text>
                </>
              )}
              <text
                x={x(i)}
                y={height - 10}
                textAnchor="middle"
                className="chart-label"
              >
                {hourLabel(p.at)}
              </text>
            </g>
          ))}
        </svg>
        <div className="hour-icons" style={{ minWidth: width }}>
          {data.map((p, i) => (
            <div key={p.at} style={{ left: `${(x(i) / width) * 100}%` }}>
              <WeatherIcon icon={p.icon} size={23} />
              <span>{percent(p.rainProbability)}</span>
            </div>
          ))}
        </div>
      </div>
      <details className="data-table">
        <summary>{t("chart.table")}</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("chart.col.time")}</th>
                <th>{t("chart.col.temperature", { unit })}</th>
                <th>{t("chart.col.rainProbability")}</th>
                <th>{t("chart.col.humidity")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.at}>
                  <td>
                    {dayLabel(p.at, reference)} {hourLabel(p.at)}
                  </td>
                  <td>{formatValue(p.temperature, 1)}</td>
                  <td>{percent(p.rainProbability)}</td>
                  <td>{formatValue(p.humidity)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
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
