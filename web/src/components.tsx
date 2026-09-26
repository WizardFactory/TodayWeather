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
import type { ReactNode } from "react";
import { dayLabel, iconKind, relativeDay, type IconKind } from "./format";
export { dayLabel };
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
      <p>날씨를 불러오는 중이에요</p>
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
      <h3>자료를 불러오지 못했어요</h3>
      <p>
        {error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."}
      </p>
      {retry && (
        <button className="button" onClick={retry}>
          <RefreshCw size={16} /> 다시 시도
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
  label = "관측 시각",
  timeZone,
}: {
  at: string | null | undefined;
  label?: string;
  timeZone?: "Asia/Seoul";
}) {
  return (
    <span className="stamp">
      {label} {stampTime(at, timeZone)}
    </span>
  );
}
function stampTime(
  at: string | null | undefined,
  timeZone?: "Asia/Seoul",
): string {
  if (!at) return "정보 없음";
  if (!timeZone) return at.replace("T", " ").slice(0, 19);
  // Only explicit offsets identify an instant. Naive KMA wall times must not move.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(at)) return "정보 없음";
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(at))
    return at.replace("T", " ").slice(0, 19);
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "정보 없음";
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
export function isOld(at: string | null, limitHours = 3) {
  if (!at) return false;
  const s = at.replace(" ", "T");
  const match = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) return false; // A conservative date-only check avoids guessing unknown source timezones.
  return (
    Date.now() - Date.parse(match[0] + "T23:59:59+14:00") >
    limitHours * 3600000 + 86400000
  );
}
export function DataNotice({
  weather,
  snapshot,
  refreshing = false,
  refreshFailed = false,
}: {
  weather: Weather;
  snapshot: boolean;
  refreshing?: boolean;
  refreshFailed?: boolean;
}) {
  return (
    <>
      {weather.mode === "demo" && (
        <div className="notice demo">
          <span className="dot" />
          <strong>예제 데이터</strong>
          <span>화면 체험용 가상 날씨입니다. 실제 날씨가 아닙니다.</span>
        </div>
      )}
      {refreshing && (
        <div className="notice" role="status">
          <LoaderCircle className="spin" size={16} />
          <span>
            저장된 자료를 먼저 표시하고 있습니다. 마지막 수신{" "}
            {new Date(weather.fetchedAt).toLocaleString("ko-KR")} · 최신 자료를
            불러오는 중입니다.
          </span>
        </div>
      )}
      {refreshFailed && (
        <div className="notice warning" role="status">
          <TriangleAlert size={16} />
          <span>
            최신 자료로 갱신하지 못했습니다. 마지막 수신{" "}
            {new Date(weather.fetchedAt).toLocaleString("ko-KR")}
          </span>
        </div>
      )}
      {snapshot && (
        <div className="notice warning" role="status">
          <TriangleAlert size={16} />
          <span>
            연결하지 못해 저장된 자료를 표시합니다. 마지막 수신{" "}
            {new Date(weather.fetchedAt).toLocaleString("ko-KR")}
          </span>
        </div>
      )}
      {isOld(weather.observedAt) && (
        <div className="notice warning">
          관측 시각이 오래된 자료입니다. 외출 전 최신 기상 정보를 확인해 주세요.
        </div>
      )}
    </>
  );
}
export const hourLabel = (at: string) =>
  at.slice(11, 13) + ":" + at.slice(14, 16);
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
  if (!data.length || !temps.length)
    return <Empty title="시간별 예보가 없습니다" />;
  const low = Math.min(...temps) - 3,
    range = Math.max(...temps) - low + 4,
    width = Math.max(720, data.length * 68),
    height = 220;
  // Rows mix 1-hour and 3-hour steps; position by time, not by index.
  const minutes = (p: Point) => Date.parse(p.at + ":00Z") / 60000,
    start = minutes(data[0]),
    span = Math.max(minutes(data[data.length - 1]) - start, 1);
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
          aria-label="시간별 기온 변화, 아래 표에서 수치 확인 가능"
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
        <summary>시간별 상세 수치 보기</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>기온 (°{unit})</th>
                <th>강수확률</th>
                <th>습도</th>
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
      기상청 날씨누리 <ArrowUpRight size={14} />
    </a>
  );
}
