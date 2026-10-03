import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowUp } from "lucide-react";
import {
  dailyChart,
  hourlyChart,
  linePath,
  formatValue,
  type Point,
  type Weather,
} from "@todayweather/core";
import { WeatherIcon, Empty, SectionHead, percent } from "./components";
import {
  amount,
  precipitationAmount,
  forecastAmount,
  dayLabel,
  windText,
  iconKind,
} from "./format";
import { hourText } from "./locale";
import { t, useLanguage } from "./i18n";
import { useApp } from "./context";

function useMetrics(ref: RefObject<HTMLDivElement | null>) {
  const [metrics, setMetrics] = useState({ rem: 16, width: 320 });
  useLayoutEffect(() => {
    const update = () =>
      setMetrics({
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        width: ref.current?.clientWidth ?? 320,
      });
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    if (ref.current) observer.observe(ref.current);
    document.fonts.ready.then(update);
    update();
    return () => observer.disconnect();
  }, [ref]);
  return metrics;
}
function useCursor(
  length: number,
  x: (i: number) => number,
  ref: RefObject<HTMLDivElement | null>,
  initial: number,
) {
  const [cursor, setCursor] = useState(Math.max(0, initial));
  useEffect(() => {
    setCursor(Math.max(0, Math.min(length - 1, initial)));
  }, [length, initial]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? length - 1
          : event.key === "ArrowLeft"
            ? cursor - 1
            : event.key === "ArrowRight"
              ? cursor + 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(length - 1, next));
    setCursor(index);
    const el = ref.current;
    if (el) {
      const at = x(index);
      if (at < el.scrollLeft) el.scrollLeft = Math.max(0, at - 20);
      else if (at > el.scrollLeft + el.clientWidth - 20)
        el.scrollLeft = at - el.clientWidth + 40;
    }
  };
  return { cursor, setCursor, keyDown };
}
function measuredWidth(labels: string[], font: string, floor: number): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return floor;
  ctx.font = font;
  return Math.max(
    floor,
    ...labels.map((label) => ctx.measureText(label).width + floor * 0.35),
  );
}
function rain(point: Point, unit: string) {
  if (point.precipitation === null && point.snowfall === null) return "—";
  const value = precipitationAmount(point, unit);
  return point.snowfall !== null && point.snowfall > 0
    ? `${value} / ${forecastAmount(point.snowfall, unit, point.snowfallApprox)}`
    : value;
}
function WindValue({ point, unit }: { point: Point; unit: string }) {
  return (
    <span className="chart-wind">
      <span className="chart-wind-direction">
        {point.windDegrees !== null && point.windDegrees !== undefined && (
          <ArrowUp
            aria-hidden="true"
            size="1em"
            style={{ transform: `rotate(${point.windDegrees + 180}deg)` }}
          />
        )}
        {windText(point.windDirection)}
      </span>
      <span>
        {formatValue(point.wind, 1)} {unit}
      </span>
    </span>
  );
}
export function HourlyChart({ weather: w }: { weather: Weather }) {
  const { display, setDisplay } = useApp(),
    lang = useLanguage();
  const model = useMemo(() => hourlyChart(w), [w]);
  const ref = useRef<HTMLDivElement>(null),
    { rem, width: viewport } = useMetrics(ref);
  const n = model.rows.length;
  const column = measuredWidth(
    model.rows.flatMap((r) => [
      hourText(r.point.at),
      ...(display.chartExpanded
        ? [
            windText(r.point.windDirection),
            `${formatValue(r.point.wind, 1)} ${w.units.windSpeedUnit}`,
          ]
        : []),
    ]),
    `${rem * 0.8125}px Pretendard`,
    rem * (display.chartExpanded ? 5.5 : 3.5),
  );
  const intervals = model.rows
    .slice(1)
    .map((r, i) => r.time - model.rows[i].time)
    .filter((v) => v > 0);
  const step = intervals.length ? Math.min(...intervals) : 3600000;
  const first = model.rows[0]?.time ?? 0,
    span = (model.rows[n - 1]?.time ?? first) - first;
  const width = Math.max(viewport, column * 2 + (span / step) * column),
    height = rem * 11,
    pad = column;
  const x = (i: number) =>
    pad +
    ((model.rows[i].time - first) / Math.max(span, step)) * (width - pad * 2);
  const y = (v: number) =>
    rem * 1.4 +
    ((model.domain[1] - v) / (model.domain[1] - model.domain[0])) *
      (height - rem * 3);
  const dotRadius = Math.max(
    rem * 0.8,
    measuredWidth(
      model.rows
        .flatMap((r) => [r.point.temperature, r.yesterday?.temperature])
        .filter((v) => v !== null && v !== undefined)
        .map((v) => `${formatValue(v)}°`),
      `${rem}px Pretendard`,
      rem * 1.4,
    ) / 2,
  );
  const yesterdayClose = (r: (typeof model.rows)[number]) =>
    r.yesterday?.temperature !== null &&
    r.yesterday?.temperature !== undefined &&
    r.point.temperature !== null &&
    (Math.abs(y(r.yesterday.temperature) - y(r.point.temperature)) <
      dotRadius * 2 ||
      (r.current &&
        Math.abs(
          y(r.yesterday.temperature) -
            (y(r.point.temperature) - dotRadius - rem * 0.5),
        ) <
          rem * 1.25));
  const { cursor, setCursor, keyDown } = useCursor(
    n,
    x,
    ref,
    model.currentIndex,
  );
  const readoutId = useId();
  useEffect(() => {
    if (ref.current && n)
      ref.current.scrollLeft = Math.max(0, x(model.startIndex) - column * 0.55);
  }, [n, width, model.startIndex, lang]);
  if (!n) return <Empty title={t("chart.empty")} />;
  const row = model.rows[cursor] ?? model.rows[0];
  const readout = `${dayLabel(row.point.at, w.current.at)} ${hourText(row.point.at)} ${formatValue(row.point.temperature, 1)}°${w.units.temperatureUnit} · ${t("display.yesterday")} ${formatValue(row.yesterday?.temperature ?? null, 1)}° · ${t("display.precipitation")} ${rain(row.point, w.units.precipitationUnit)}`;
  return (
    <>
      <div
        ref={ref}
        className="chart-scroll hourly-chart"
        tabIndex={0}
        role="group"
        aria-label={t("chart.label")}
        aria-describedby={readoutId}
        onKeyDown={keyDown}
        data-cursor={cursor}
      >
        <div className="chart-timeline" style={{ width }}>
          <div className="chart-columns hourly-columns">
            {model.rows.map((r, i) => (
              <div
                key={r.point.at}
                className={`chart-column ${r.current ? "current-column" : ""}`}
                style={{ left: x(i) - column * 0.5, width: column }}
                onClick={() => setCursor(i)}
              >
                <span className="chart-date">
                  {i < n - 2 &&
                  (i === 0 ||
                    r.point.at.slice(0, 10) !==
                      model.rows[i - 1].point.at.slice(0, 10))
                    ? dayLabel(r.point.at, w.current.at)
                    : "\u00a0"}
                </span>
                <span className="chart-hour">{hourText(r.point.at)}</span>
                {i > 0 ? (
                  <WeatherIcon icon={r.point.icon} size={rem * 1.5} />
                ) : (
                  <span className="chart-icon-placeholder" aria-hidden="true" />
                )}
                <span className="chart-probability">
                  {i > 0 ? percent(r.point.rainProbability) : "\u00a0"}
                </span>
                <span className="chart-amount">
                  {i > 0 ? rain(r.point, w.units.precipitationUnit) : "\u00a0"}
                </span>
              </div>
            ))}
          </div>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={t("chart.label")}
          >
            {[0, 1, 2].map((i) => {
              const v =
                model.domain[0] + (i * (model.domain[1] - model.domain[0])) / 2;
              return (
                <g key={i}>
                  <line
                    x1={0}
                    x2={width}
                    y1={y(v)}
                    y2={y(v)}
                    className="chart-grid"
                  />
                  <text
                    x={rem * 0.3}
                    y={y(v) - rem * 0.3}
                    className="chart-axis"
                  >
                    {formatValue(v)}°
                  </text>
                </g>
              );
            })}
            {model.rows.map((r, i) =>
              i > 0 &&
              r.point.at.slice(0, 10) !==
                model.rows[i - 1].point.at.slice(0, 10) ? (
                <line
                  key={r.point.at}
                  x1={(x(i) + x(i - 1)) / 2}
                  x2={(x(i) + x(i - 1)) / 2}
                  y1={0}
                  y2={height}
                  className="chart-grid day-boundary"
                />
              ) : null,
            )}
            <path
              className="yesterday-line"
              d={linePath(
                model.rows.map((r) => r.yesterday?.temperature),
                x,
                y,
              )}
            />
            <path
              className="today-line"
              d={linePath(
                model.rows.map((r) => r.point.temperature),
                x,
                y,
              )}
            />
            {model.rows.map((r, i) => (
              <g key={r.point.at} onMouseEnter={() => setCursor(i)}>
                <title>{`${dayLabel(r.point.at, w.current.at)} ${hourText(r.point.at)} ${formatValue(r.point.temperature)}° · ${t("display.yesterday")} ${formatValue(r.yesterday?.temperature ?? null)}° · ${rain(r.point, w.units.precipitationUnit)}`}</title>
                {r.yesterday?.temperature !== null &&
                  r.yesterday?.temperature !== undefined && (
                    <circle
                      className="yesterday-point"
                      cx={x(i)}
                      cy={y(r.yesterday.temperature)}
                      r={yesterdayClose(r) ? rem * 0.25 : dotRadius}
                    />
                  )}
                {r.yesterday?.temperature !== null &&
                  r.yesterday?.temperature !== undefined &&
                  !yesterdayClose(r) && (
                    <text
                      x={x(i)}
                      y={y(r.yesterday.temperature)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="chart-value yesterday-value"
                    >
                      {formatValue(r.yesterday.temperature)}°
                    </text>
                  )}
                {r.point.temperature !== null && (
                  <>
                    <circle
                      className="today-point"
                      cx={x(i)}
                      cy={y(r.point.temperature)}
                      r={dotRadius}
                    />
                    <text
                      x={x(i)}
                      y={
                        y(r.point.temperature) -
                        (r.current ? dotRadius + rem * 0.5 : 0)
                      }
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={`chart-value ${r.current ? "current-value" : "today-value"}`}
                    >
                      {formatValue(r.point.temperature)}°
                    </text>
                  </>
                )}
                {r.current && r.point.temperature !== null && (
                  <>
                    <line
                      className="now-line"
                      x1={x(i)}
                      x2={x(i)}
                      y1={0}
                      y2={height}
                    />
                    <circle
                      className="now"
                      cx={x(i)}
                      cy={y(r.point.temperature)}
                      r={rem * 0.26}
                    />
                  </>
                )}
              </g>
            ))}
            <line
              className="cursor-line"
              x1={x(cursor)}
              x2={x(cursor)}
              y1={0}
              y2={height}
            />
          </svg>
          {display.chartExpanded && (
            <div className="chart-columns chart-extras">
              {model.rows.map((r, i) => (
                <div
                  className="chart-column"
                  key={r.point.at}
                  style={{ left: x(i) - column * 0.5, width: column }}
                >
                  <WindValue point={r.point} unit={w.units.windSpeedUnit} />
                  <span>{formatValue(r.point.humidity)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p
        id={readoutId}
        className="cursor-readout"
        role="status"
        aria-live="polite"
      >
        {readout}
      </p>
      <button
        className="button chart-expander"
        aria-expanded={display.chartExpanded}
        onClick={() =>
          setDisplay((d) => ({ ...d, chartExpanded: !d.chartExpanded }))
        }
      >
        {t(display.chartExpanded ? "display.collapse" : "display.expand")}
      </button>
      <details className="data-table">
        <summary>{t("display.table")}</summary>
        <div className="table-scroll">
          <table>
            <caption>{t("weather.hourly.title")}</caption>
            <thead>
              <tr>
                {[
                  t("chart.col.time"),
                  t("chart.col.temperature", { unit: w.units.temperatureUnit }),
                  t("display.yesterday"),
                  t("display.current"),
                  t("display.probability"),
                  t("display.precipitation"),
                  t("display.wind"),
                  t("display.humidity"),
                ].map((s) => (
                  <th scope="col" key={s}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.point.at}>
                  <th scope="row">
                    {dayLabel(r.point.at, w.current.at)} {hourText(r.point.at)}
                  </th>
                  <td>{formatValue(r.point.temperature, 1)}°</td>
                  <td>{formatValue(r.yesterday?.temperature ?? null, 1)}°</td>
                  <td>{r.current ? t("display.current") : "—"}</td>
                  <td>{percent(r.point.rainProbability)}</td>
                  <td>{rain(r.point, w.units.precipitationUnit)}</td>
                  <td>
                    <WindValue point={r.point} unit={w.units.windSpeedUnit} />
                  </td>
                  <td>{formatValue(r.point.humidity)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function DailyChart({ weather: w }: { weather: Weather }) {
  const model = useMemo(() => dailyChart(w), [w]),
    ref = useRef<HTMLDivElement>(null),
    { rem, width: viewport } = useMetrics(ref),
    lang = useLanguage();
  const n = model.rows.length,
    column = measuredWidth(
      model.rows.map((r) => dayLabel(r.point.at, w.current.at)),
      `${rem * 0.8125}px Pretendard`,
      measuredWidth(
        [`${t("display.am")} ${t("display.pm")}`],
        `${rem * 0.8125}px Pretendard`,
        rem * 5,
      ),
    );
  const width = Math.max(viewport, n * column),
    cell = n ? width / n : column,
    height = rem * 12,
    x = (i: number) => cell * (i + 0.5),
    y = (v: number) =>
      rem * 1.5 +
      ((model.domain[1] - v) / (model.domain[1] - model.domain[0])) *
        (height - rem * 3.5);
  const { cursor, setCursor, keyDown } = useCursor(n, x, ref, model.todayIndex),
    id = useId(),
    readoutId = useId();
  useEffect(() => {
    if (ref.current)
      ref.current.scrollLeft =
        width > viewport + 1 ? model.startIndex * cell : 0;
  }, [width, viewport, model.startIndex, lang]);
  if (!n)
    return (
      <section
        className="panel daily-chart-panel"
        data-weather-section="daily"
        tabIndex={-1}
      >
        <SectionHead title={t("daily.title")} />
        <Empty title={t("daily.empty")} />
      </section>
    );
  const row = model.rows[cursor] ?? model.rows[0];
  const condition = (icon: string) =>
    icon ? t(`condition.${iconKind(icon)}`) : t("common.noInfo");
  const conditions = (r: typeof row) =>
    r.mergedIcons
      ? condition(r.point.icon)
      : `${t("display.am")} ${condition(r.point.icon)} · ${t("display.pm")} ${condition(r.point.iconPm)}`;
  const probability = (r: typeof row) =>
    !r.past && r.point.rainProbability ? percent(r.point.rainProbability) : "—";
  return (
    <section
      className="panel daily-chart-panel"
      data-weather-section="daily"
      tabIndex={-1}
    >
      <SectionHead
        title={t("daily.title")}
        aside={<span className="muted-text">{t("daily.legend")}</span>}
      />
      <div
        ref={ref}
        className="chart-scroll daily-chart"
        role="group"
        tabIndex={0}
        aria-label={t("daily.title")}
        aria-describedby={readoutId}
        onKeyDown={keyDown}
        data-cursor={cursor}
      >
        <div className="chart-timeline" style={{ width }}>
          <div className="chart-columns daily-columns">
            {model.rows.map((r, i) => (
              <div
                className={`chart-column ${r.today ? "today-column" : ""} ${r.past ? "past" : ""}`}
                key={r.point.at}
                style={{ left: i * cell, width: cell }}
                onClick={() => setCursor(i)}
              >
                <span>{dayLabel(r.point.at, w.current.at)}</span>
                <div className="chart-icons">
                  <span
                    className="chart-condition"
                    role="img"
                    aria-label={
                      r.mergedIcons
                        ? condition(r.point.icon)
                        : `${t("display.am")} ${condition(r.point.icon)}`
                    }
                  >
                    <span aria-hidden="true" className="chart-period">
                      {r.mergedIcons ? "" : t("display.am")}
                    </span>
                    <WeatherIcon icon={r.point.icon} size={rem * 1.5} />
                  </span>
                  {!r.mergedIcons && (
                    <span
                      className="chart-condition"
                      role="img"
                      aria-label={`${t("display.pm")} ${condition(r.point.iconPm)}`}
                    >
                      <span aria-hidden="true" className="chart-period">
                        {t("display.pm")}
                      </span>
                      <WeatherIcon icon={r.point.iconPm} size={rem * 1.5} />
                    </span>
                  )}
                </div>
                <span>
                  {!r.past && r.point.rainProbability
                    ? percent(r.point.rainProbability)
                    : "—"}
                </span>
                <span>{rain(r.point, w.units.precipitationUnit)}</span>
              </div>
            ))}
          </div>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={t("daily.title")}
          >
            <defs>
              <linearGradient
                id={id}
                gradientUnits="userSpaceOnUse"
                x1={0}
                x2={0}
                y1={y(model.domain[0])}
                y2={y(model.domain[1])}
              >
                <stop offset="0%" stopColor="var(--tw-chart-range-cool)" />
                <stop offset="100%" stopColor="var(--tw-chart-range-warm)" />
              </linearGradient>
            </defs>
            {[0, 1, 2].map((i) => {
              const v =
                model.domain[0] + (i * (model.domain[1] - model.domain[0])) / 2;
              return (
                <line
                  key={i}
                  x1={0}
                  x2={width}
                  y1={y(v)}
                  y2={y(v)}
                  className="chart-grid"
                />
              );
            })}
            {model.rows.map((r, i) => (
              <g key={r.point.at} className={r.past ? "past" : ""}>
                {r.validRange && (
                  <rect
                    className="range"
                    x={x(i) - rem * 0.1875}
                    y={y(r.point.high!)}
                    width={rem * 0.375}
                    height={Math.max(
                      rem * 0.375,
                      y(r.point.low!) - y(r.point.high!),
                    )}
                    rx={rem * 0.1875}
                    fill={`url(#${id})`}
                  />
                )}
                <text
                  x={x(i)}
                  y={r.point.high === null ? rem : y(r.point.high) - rem * 0.6}
                  textAnchor="middle"
                  className="chart-value"
                >
                  {formatValue(r.point.high)}°
                </text>
                <text
                  x={x(i)}
                  y={
                    r.point.low === null
                      ? height - rem
                      : y(r.point.low) + rem * 1.2
                  }
                  textAnchor="middle"
                  className="chart-value"
                >
                  {formatValue(r.point.low)}°
                </text>
                {r.today && model.current !== null && (
                  <>
                    <line
                      className="now-line"
                      x1={x(i)}
                      x2={x(i)}
                      y1={0}
                      y2={height}
                    />
                    <circle
                      className="now"
                      cx={x(i)}
                      cy={y(model.current)}
                      r={rem * 0.26}
                    />
                  </>
                )}
              </g>
            ))}
            <line
              className="cursor-line"
              x1={x(cursor)}
              x2={x(cursor)}
              y1={0}
              y2={height}
            />
          </svg>
        </div>
      </div>
      <p
        id={readoutId}
        className="cursor-readout"
        role="status"
        aria-live="polite"
      >
        {dayLabel(row.point.at, w.current.at)} · {formatValue(row.point.low)}°–
        {formatValue(row.point.high)}°
        {` · ${conditions(row)} · ${t("display.probability")} ${probability(row)} · ${t("display.precipitation")} ${rain(row.point, w.units.precipitationUnit)}`}
        {row.today && model.current !== null
          ? ` · ${t("display.current")} ${formatValue(model.current)}°`
          : ""}
      </p>
      <details className="data-table">
        <summary>{t("display.table")}</summary>
        <div className="table-scroll">
          <table>
            <caption>
              {t("daily.title")} · °{w.units.temperatureUnit}
            </caption>
            <thead>
              <tr>
                {[
                  t("chart.col.time"),
                  t("display.range"),
                  t("display.current"),
                  t("display.probability"),
                  t("display.precipitation"),
                  t("display.conditions"),
                ].map((s) => (
                  <th scope="col" key={s}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.point.at}>
                  <th scope="row">{dayLabel(r.point.at, w.current.at)}</th>
                  <td>
                    {formatValue(r.point.low)}°–{formatValue(r.point.high)}°
                  </td>
                  <td>{r.today ? formatValue(model.current) : "—"}</td>
                  <td>
                    {!r.past && r.point.rainProbability
                      ? percent(r.point.rainProbability)
                      : "—"}
                  </td>
                  <td>{rain(r.point, w.units.precipitationUnit)}</td>
                  <td>{conditions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
