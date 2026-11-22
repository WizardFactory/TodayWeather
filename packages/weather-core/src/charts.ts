import type { Point, Weather } from "./index";
/** Coordinate arithmetic on source wall times; UTC is used only to avoid host DST. */
export function wallTime(at: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(at);
  return match ? Date.parse(`${match[1]}T${match[2]}:00Z`) : NaN;
}
const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);
export function temperatureDomain(
  values: (number | null | undefined)[],
): [number, number] {
  const numbers = values.filter(finite);
  if (!numbers.length) return [0, 1];
  const low = Math.min(...numbers),
    high = Math.max(...numbers),
    pad = Math.max(1, (high - low) * 0.1);
  return [Math.floor(low - pad), Math.ceil(high + pad)];
}
export type HourRow = {
  point: Point;
  time: number;
  yesterday: Point | null;
  current: boolean;
};
const HOUR_MS = 3_600_000;
const MAX_CONNECTED_GAP_MS = 3 * HOUR_MS;

function mergeCurrentPoint(
  existing: Point | undefined,
  current: Point,
  supplied: Map<number, Point>,
  times: number[],
  now: number,
): Point {
  if (existing) {
    return {
      ...existing,
      at: current.at,
      temperature: current.temperature,
      low: current.low ?? existing.low,
      high: current.high ?? existing.high,
      humidity: current.humidity ?? existing.humidity,
      wind: current.wind ?? existing.wind,
      windDirection: current.windDirection || existing.windDirection,
      windDegrees: current.windDegrees ?? existing.windDegrees,
      pressure: current.pressure ?? existing.pressure,
      visibility: current.visibility ?? existing.visibility,
      rainProbability: current.rainProbability ?? existing.rainProbability,
      feelsLike: current.feelsLike ?? existing.feelsLike,
      icon: current.icon || existing.icon,
      iconPm: current.iconPm || existing.iconPm,
      description: current.description || existing.description,
      sunrise: current.sunrise || existing.sunrise,
      sunset: current.sunset || existing.sunset,
      uv: current.uv || existing.uv,
      discomfort: current.discomfort || existing.discomfort,
      ...(current.precipitation !== null
        ? {
            precipitation: current.precipitation,
            precipitationHours: current.precipitationHours,
            precipitationBasis: current.precipitationBasis,
            precipitationApprox: current.precipitationApprox,
          }
        : {}),
      ...(current.snowfall !== null
        ? {
            snowfall: current.snowfall,
            snowfallHours: current.snowfallHours,
            snowfallBasis: current.snowfallBasis,
            snowfallApprox: current.snowfallApprox,
          }
        : {}),
      ...(current.uvIndex !== undefined ? { uvIndex: current.uvIndex } : {}),
      ...(current.pollenOak !== undefined ? { pollenOak: current.pollenOak } : {}),
      ...(current.pollenPine !== undefined ? { pollenPine: current.pollenPine } : {}),
      ...(current.pollenWeeds !== undefined ? { pollenWeeds: current.pollenWeeds } : {}),
    };
  }
  if (current.rainProbability !== null) return current;
  // Borrow rainProbability from the enclosing supplied forecast slot within 3h.
  let borrowed: number | null = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const t = times[i];
    if (t <= now && now - t <= MAX_CONNECTED_GAP_MS) {
      const p = supplied.get(t);
      if (p && p.rainProbability !== null) {
        borrowed = p.rainProbability;
        break;
      }
    }
  }
  if (borrowed === null) {
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t > now && t - now <= MAX_CONNECTED_GAP_MS) {
        const p = supplied.get(t);
        if (p && p.rainProbability !== null) {
          borrowed = p.rainProbability;
          break;
        }
      }
    }
  }
  return borrowed === null ? current : { ...current, rainProbability: borrowed };
}

/** Bounded chronological x-coordinates for mixed 1h/3h/off-hour hourly timelines. */
export function hourlyXPositions(
  times: number[],
  column: number,
  pad: number,
  viewport: number,
): { xs: number[]; width: number; gapBefore: boolean[] } {
  const n = times.length;
  if (!n) return { xs: [], width: viewport, gapBefore: [] };
  const xs = new Array<number>(n);
  const gapBefore = new Array<boolean>(n).fill(false);
  xs[0] = pad;
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0, times[i] - times[i - 1]);
    const isGap = dt > MAX_CONNECTED_GAP_MS;
    gapBefore[i] = isGap;
    const factor =
      dt <= HOUR_MS
        ? 1
        : dt <= MAX_CONNECTED_GAP_MS
          ? 1 + 0.35 * ((dt - HOUR_MS) / (2 * HOUR_MS))
          : 1.5;
    xs[i] = xs[i - 1] + column * factor;
  }
  return {
    xs,
    width: Math.max(viewport, xs[n - 1] + pad),
    gapBefore,
  };
}

export function hourlyChart(
  weather: Pick<Weather, "hourly" | "current" | "yesterday">,
) {
  const supplied = new Map<number, Point>();
  for (const point of weather.hourly) {
    const time = wallTime(point.at);
    if (Number.isFinite(time)) supplied.set(time, point);
  }
  const timeline = new Map(supplied),
    times = [...timeline.keys()].sort((a, b) => a - b),
    now = wallTime(weather.current.at);
  // Never move an out-of-extent observation onto an unrelated forecast point.
  const inRange =
    times.length > 0 && now >= times[0] && now <= times[times.length - 1];
  if (inRange && finite(weather.current.temperature))
    timeline.set(
      now,
      mergeCurrentPoint(timeline.get(now), weather.current, supplied, times, now),
    );
  const yesterdayTime = weather.yesterday
    ? wallTime(weather.yesterday.at)
    : NaN;
  const rows: HourRow[] = [...timeline]
    .sort(([a], [b]) => a - b)
    .map(([time, point]) => ({
      time,
      point,
      current: inRange && time === now && finite(weather.current.temperature),
      yesterday:
        supplied.get(time - 86400000) ??
        (time - 86400000 === yesterdayTime ? weather.yesterday : null),
    }));
  return {
    rows,
    domain: temperatureDomain(
      rows.flatMap((r) => [r.point.temperature, r.yesterday?.temperature]),
    ),
    currentIndex: rows.findIndex((r) => r.current),
    startIndex: Math.max(0, rows.findIndex((r) => r.time >= now) - 1),
  };
}
export type DayRow = {
  point: Point;
  past: boolean;
  today: boolean;
  mergedIcons: boolean;
  validRange: boolean;
};
export function dailyChart(weather: Pick<Weather, "daily" | "current">) {
  const days = new Map<string, Point>();
  for (const point of weather.daily)
    if (Number.isFinite(wallTime(point.at)))
      days.set(point.at.slice(0, 10), point);
  const today = weather.current.at.slice(0, 10);
  const rows: DayRow[] = [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, point]) => ({
      point,
      past: day < today,
      today: day === today,
      mergedIcons: !point.iconPm || point.iconPm === point.icon,
      validRange:
        finite(point.low) && finite(point.high) && point.low <= point.high,
    }));
  const todayIndex = rows.findIndex((r) => r.today),
    current =
      todayIndex >= 0 && finite(weather.current.temperature)
        ? weather.current.temperature
        : null;
  return {
    rows,
    todayIndex,
    current,
    domain: temperatureDomain([
      // Partial days still render their supplied extremum, even without a bar.
      ...rows.flatMap((r) => [r.point.low, r.point.high]),
      current,
    ]),
    startIndex: Math.max(0, todayIndex - 2),
  };
}
export function linePath(
  values: (number | null | undefined)[],
  x: (i: number) => number,
  y: (value: number) => number,
  breakBefore?: (i: number) => boolean,
): string {
  let connected = false;
  return values
    .map((value, i) => {
      if (breakBefore?.(i)) connected = false;
      if (!finite(value)) {
        connected = false;
        return "";
      }
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${x(i)},${y(value)}`;
    })
    .filter(Boolean)
    .join(" ");
}
