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
  hourlyXPositions,
  linePath,
  formatValue,
  type Point,
  type Weather,
} from "@todayweather/core";
import { WeatherIcon, Empty, SectionHead, percent } from "./components";
import {
  precipitationAmount,
  forecastAmount,
  dayLabel,
  relativeDay,
  windText,
  iconKind,
} from "./format";
import { dateText, hourText } from "./locale";
import { t, useLanguage } from "./i18n";
import { useApp } from "./context";

let measureCtx: CanvasRenderingContext2D | null | undefined;
function maxTextWidth(labels: string[], font: string): number {
  if (measureCtx === undefined)
    measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx || !labels.length) return 0;
  measureCtx.font = font;
  return Math.max(
    0,
    ...labels.map((label) => measureCtx!.measureText(label).width),
  );
}

function useMetrics(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  const [metrics, setMetrics] = useState({
    rem: 16,
    width: 320,
    measured: false,
  });
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const update = () => {
      if (!ref.current) return;
      setMetrics({
        rem:
          parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
        width: ref.current.clientWidth || 320,
        measured: true,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    observer.observe(ref.current);
    document.fonts.ready.then(update);
    update();
    return () => observer.disconnect();
  }, [ref, active]);
  return metrics;
}

function useCursor(
  length: number,
  x: (i: number) => number,
  ref: RefObject<HTMLDivElement | null>,
  initial: number,
  leftClearance = 20,
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
      if (at < el.scrollLeft + leftClearance)
        el.scrollLeft = Math.max(0, at - leftClearance - 20);
      else if (at > el.scrollLeft + el.clientWidth - 20)
        el.scrollLeft = at - el.clientWidth + 40;
    }
  };
  return { cursor, setCursor, keyDown };
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

function dailyHeader(at: string, reference: string, lang: string) {
  const a = Date.parse(at.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(reference.slice(0, 10) + "T00:00:00Z");
  const days =
    Number.isFinite(a) && Number.isFinite(b)
      ? Math.round((a - b) / 86400000)
      : NaN;
  const rel =
    lang === "ko" || (Number.isFinite(days) && Math.abs(days) <= 1)
      ? relativeDay(at, reference)
      : "";
  if (rel) return { primary: rel, secondary: dateText(at, true) };
  const d = new Date(at.slice(0, 10) + "T12:00:00Z");
  const weekday = Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat(lang, {
        weekday: "short",
        timeZone: "UTC",
      }).format(d);
  return { primary: weekday, secondary: dateText(at, false) };
}

export function HourlyChart({ weather: w }: { weather: Weather }) {
  const { display, setDisplay } = useApp(),
    lang = useLanguage();
  const model = useMemo(() => hourlyChart(w), [w]);
  const n = model.rows.length;
  const ref = useRef<HTMLDivElement>(null),
    { rem, width: viewport, measured } = useMetrics(ref, n > 0);
  const axisFont = `${rem}px Pretendard`;
  const captionFont = `${rem * 0.875}px Pretendard`;
  const hourW = maxTextWidth(
    model.rows.map((r) => hourText(r.point.at)),
    axisFont,
  );
  const rainW = maxTextWidth(
    model.rows.slice(1).map((r) => rain(r.point, w.units.precipitationUnit)),
    captionFont,
  );
  const windDirW = display.chartExpanded
    ? maxTextWidth(
        model.rows.map((r) => windText(r.point.windDirection)),
        axisFont,
      ) +
      rem * 1.75
    : 0;
  const windSpeedW = display.chartExpanded
    ? maxTextWidth(
        model.rows.map(
          (r) => `${formatValue(r.point.wind, 1)} ${w.units.windSpeedUnit}`,
        ),
        axisFont,
      )
    : 0;
  const column = Math.max(
    rem * (display.chartExpanded ? 5.5 : 4.25),
    hourW + rem * 1.25,
    rainW + rem * 1.0,
    windDirW + rem * 1.25,
    windSpeedW + rem * 1.25,
  );
  const yAxisPad = rem * 2.75;
  const pad = Math.max(column * 0.6, yAxisPad + column * 0.5);
  const { xs, width, gapBefore } = useMemo(
    () =>
      hourlyXPositions(
        model.rows.map((r) => r.time),
        column,
        pad,
        viewport,
      ),
    [model.rows, column, pad, viewport],
  );
  const height = rem * 11;
  const x = (i: number) => xs[i] ?? pad;
  const y = (v: number) =>
    rem * 1.5 +
    ((model.domain[1] - v) / (model.domain[1] - model.domain[0])) *
      (height - rem * 3);
  const tempTextW = maxTextWidth(
    model.rows
      .flatMap((r) => [r.point.temperature, r.yesterday?.temperature])
      .filter((v): v is number => v !== null && v !== undefined)
      .map((v) => `${formatValue(v)}°`),
    `${rem}px Pretendard`,
  );
  const dotRadius = Math.max(rem * 0.78, tempTextW / 2 + rem * 0.28);
  const yesterdayClose = (r: (typeof model.rows)[number]) =>
    r.yesterday?.temperature !== null &&
    r.yesterday?.temperature !== undefined &&
    r.point.temperature !== null &&
    Math.abs(y(r.yesterday.temperature) - y(r.point.temperature)) <
      dotRadius * 2 + rem * 0.35;
  const { cursor, setCursor, keyDown } = useCursor(
    n,
    x,
    ref,
    model.currentIndex,
    yAxisPad,
  );
  const readoutId = useId();
  const identity = `${w.location.id}|${lang}|${w.units.temperatureUnit}|${w.units.windSpeedUnit}|${w.units.precipitationUnit}`;
  const lastIdentity = useRef(identity);
  const anchorRef = useRef<{ time: number; offset: number } | null>(null);
  const restoring = useRef(false);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    anchorRef.current = null;
  }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!measured || !el || !n) return;
    restoring.current = true;
    if (anchorRef.current === null) {
      const start = Math.max(0, Math.min(n - 1, model.startIndex));
      const target = Math.max(0, x(start) - yAxisPad - column * 0.55);
      el.scrollLeft = target;
      anchorRef.current = {
        time: model.rows[start].time,
        offset: x(start) - target,
      };
    } else {
      const { time, offset } = anchorRef.current;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(model.rows[i].time - time);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      el.scrollLeft = Math.max(0, x(nearest) - offset);
    }
    const frame = requestAnimationFrame(() => {
      restoring.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [measured, identity, n, width, viewport, model.startIndex, yAxisPad, column]);
  const handleScroll = () => {
    const el = ref.current;
    if (!el || !n || restoring.current) return;
    const probe = el.scrollLeft + yAxisPad + column * 0.5;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - probe);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    anchorRef.current = {
      time: model.rows[nearest].time,
      offset: x(nearest) - el.scrollLeft,
    };
  };
  if (!n) return <Empty title={t("chart.empty")} />;
  const row = model.rows[cursor] ?? model.rows[0];
  const readout = `${dayLabel(row.point.at, w.current.at)} ${hourText(row.point.at)} ${formatValue(row.point.temperature, 1)}°${w.units.temperatureUnit} · ${t("display.yesterday")} ${formatValue(row.yesterday?.temperature ?? null, 1)}° · ${t("display.precipitation")} ${rain(row.point, w.units.precipitationUnit)}`;
  const ticks = [0, 1, 2].map(
    (i) => model.domain[0] + (i * (model.domain[1] - model.domain[0])) / 2,
  );
  return (
    <>
      <div className="chart-plot-wrap">
        <div
          className="chart-y-axis"
          aria-hidden="true"
          style={{ height }}
        >
          {ticks.map((v, i) => (
            <span className="chart-y-tick" key={i} style={{ top: y(v) }}>
              {formatValue(v)}°
            </span>
          ))}
        </div>
        <div
          ref={ref}
          className="chart-scroll hourly-chart"
          tabIndex={0}
          role="group"
          aria-label={t("chart.label")}
          aria-describedby={readoutId}
          onKeyDown={keyDown}
          onScroll={handleScroll}
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
                    <span
                      className="chart-icon-placeholder"
                      aria-hidden="true"
                    />
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
              {ticks.map((v, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={width}
                  y1={y(v)}
                  y2={y(v)}
                  className="chart-grid"
                />
              ))}
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
                  (i) => gapBefore[i],
                )}
              />
              <path
                className="today-line"
                d={linePath(
                  model.rows.map((r) => r.point.temperature),
                  x,
                  y,
                  (i) => gapBefore[i],
                )}
              />
              <line
                className="cursor-line"
                x1={x(cursor)}
                x2={x(cursor)}
                y1={0}
                y2={height}
              />
              {model.rows.map((r, i) => {
                const hitLeft = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
                const hitRight = i === n - 1 ? width : (x(i) + x(i + 1)) / 2;
                return (
                  <g
                    key={r.point.at}
                    onClick={() => setCursor(i)}
                    onPointerEnter={(e) => {
                      if (e.pointerType === "mouse") setCursor(i);
                    }}
                  >
                    <rect
                      className="chart-hit"
                      x={hitLeft}
                      y={0}
                      width={Math.max(1, hitRight - hitLeft)}
                      height={height}
                    />
                    <title>{`${dayLabel(r.point.at, w.current.at)} ${hourText(r.point.at)} ${formatValue(r.point.temperature)}° · ${t("display.yesterday")} ${formatValue(r.yesterday?.temperature ?? null)}° · ${rain(r.point, w.units.precipitationUnit)}`}</title>
                    {r.current && r.point.temperature !== null && (
                      <line
                        className="now-line"
                        x1={x(i)}
                        x2={x(i)}
                        y1={0}
                        y2={height}
                      />
                    )}
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
                        {r.current && (
                          <circle
                            className="now"
                            cx={x(i)}
                            cy={y(r.point.temperature)}
                            r={dotRadius + rem * 0.2}
                          />
                        )}
                        <text
                          x={x(i)}
                          y={y(r.point.temperature)}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="chart-value today-value"
                        >
                          {formatValue(r.point.temperature)}°
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
            {display.chartExpanded && (
              <div className="chart-columns chart-extras">
                {model.rows.map((r, i) => (
                  <div
                    className="chart-column"
                    key={r.point.at}
                    style={{ left: x(i) - column * 0.5, width: column }}
                    onClick={() => setCursor(i)}
                  >
                    <WindValue point={r.point} unit={w.units.windSpeedUnit} />
                    <span>{formatValue(r.point.humidity)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
    n = model.rows.length,
    ref = useRef<HTMLDivElement>(null),
    { rem, width: viewport, measured } = useMetrics(ref, n > 0),
    lang = useLanguage();
  const hasSplitIcons = model.rows.some((r) => !r.mergedIcons);
  const headers = useMemo(
    () => model.rows.map((r) => dailyHeader(r.point.at, w.current.at, lang)),
    [model.rows, w.current.at, lang],
  );
  const axisFont = `${rem}px Pretendard`;
  const captionFont = `${rem * 0.875}px Pretendard`;
  const primaryW = maxTextWidth(
    headers.map((h) => h.primary),
    axisFont,
  );
  const secondaryW = maxTextWidth(
    headers.map((h) => h.secondary),
    captionFont,
  );
  const rainW = maxTextWidth(
    model.rows.map((r) => rain(r.point, w.units.precipitationUnit)),
    captionFont,
  );
  const amW = Math.max(rem * 1.5, maxTextWidth([t("display.am")], axisFont));
  const pmW = Math.max(rem * 1.5, maxTextWidth([t("display.pm")], axisFont));
  const splitIconW = hasSplitIcons ? amW + pmW + rem * 1.5 : 0;
  const column = Math.max(
    rem * 4.5,
    primaryW + rem * 1.0,
    secondaryW + rem * 1.0,
    rainW + rem * 1.0,
    splitIconW,
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
  const identity = `${w.location.id}|${lang}|${w.units.temperatureUnit}|${w.units.precipitationUnit}`;
  const lastIdentity = useRef(identity);
  const anchorDate = useRef<{ at: string; offset: number } | null>(null);
  const userScrolled = useRef(false);
  const restoring = useRef(false);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    anchorDate.current = null;
    userScrolled.current = false;
  }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!measured || !el || !n) return;
    restoring.current = true;
    if (width <= viewport + 1) {
      el.scrollLeft = 0;
      anchorDate.current = { at: model.rows[0].point.at, offset: 0 };
    } else if (!userScrolled.current || anchorDate.current === null) {
      const desired = model.startIndex * cell;
      const minForToday =
        model.todayIndex >= 0
          ? Math.max(0, (model.todayIndex + 1) * cell - viewport)
          : 0;
      const maxForToday =
        model.todayIndex >= 0 ? Math.max(0, model.todayIndex * cell) : desired;
      const target = Math.min(maxForToday, Math.max(desired, minForToday));
      el.scrollLeft = target;
      const firstIdx = Math.max(
        0,
        Math.min(n - 1, Math.floor(target / cell)),
      );
      anchorDate.current = {
        at: model.rows[firstIdx].point.at,
        offset: firstIdx * cell - target,
      };
    } else {
      const idx = model.rows.findIndex(
        (r) => r.point.at === anchorDate.current!.at,
      );
      if (idx >= 0) {
        el.scrollLeft = Math.max(0, idx * cell - anchorDate.current.offset);
      }
    }
    const frame = requestAnimationFrame(() => {
      restoring.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [measured, identity, n, width, viewport, cell, model.startIndex, model.todayIndex]);
  const handleScroll = () => {
    const el = ref.current;
    if (!el || !n || restoring.current) return;
    userScrolled.current = true;
    const idx = Math.max(
      0,
      Math.min(n - 1, Math.floor(el.scrollLeft / cell)),
    );
    anchorDate.current = {
      at: model.rows[idx].point.at,
      offset: idx * cell - el.scrollLeft,
    };
  };
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
        onScroll={handleScroll}
        data-cursor={cursor}
      >
        <div className="chart-timeline" style={{ width }}>
          <div
            className={`chart-columns daily-columns ${hasSplitIcons ? "" : "merged-only"}`}
          >
            {model.rows.map((r, i) => (
              <div
                className={`chart-column ${r.today ? "today-column" : ""} ${r.past ? "past" : ""}`}
                key={r.point.at}
                style={{ left: i * cell, width: cell }}
                onClick={() => setCursor(i)}
              >
                <span className="chart-day-primary">{headers[i].primary}</span>
                <span className="chart-day-date">{headers[i].secondary}</span>
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
                    {hasSplitIcons && (
                      <span aria-hidden="true" className="chart-period">
                        {r.mergedIcons ? "\u00a0" : t("display.am")}
                      </span>
                    )}
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
                <span>{probability(r)}</span>
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
            <line
              className="cursor-line"
              x1={x(cursor)}
              x2={x(cursor)}
              y1={0}
              y2={height}
            />
            {model.rows.map((r, i) => (
              <g
                key={r.point.at}
                className={r.past ? "past" : ""}
                onClick={() => setCursor(i)}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setCursor(i);
                }}
              >
                <rect
                  className="chart-hit"
                  x={i * cell}
                  y={0}
                  width={cell}
                  height={height}
                />
                <title>{`${dayLabel(r.point.at, w.current.at)} · ${formatValue(r.point.low)}°–${formatValue(r.point.high)}° · ${conditions(r)}`}</title>
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
                  <td>{probability(r)}</td>
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
