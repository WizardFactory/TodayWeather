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
const DAY_MS = 86_400_000;

/** Applies the current observation to the forecast row at the same time. */
function mergeCurrentPoint(existing: Point, current: Point): Point {
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

/**
 * The hourly chart of the native apps (Cordova `convertWeatherData`): one
 * column per three-hour forecast row from yesterday 00:00 (the native
 * `slice(8)` of a series that starts the day before yesterday). Older rows
 * only supply the yesterday line. The current observation replaces the row
 * at its exact time; otherwise it is a marker between the row at or before it
 * and the next row, not a column of its own.
 */
export function hourlyChart(
  weather: Pick<Weather, "hourly" | "chartHourly" | "current" | "yesterday">,
) {
  const supplied = new Map<number, Point>();
  for (const point of weather.chartHourly ?? weather.hourly) {
    const time = wallTime(point.at);
    if (Number.isFinite(time)) supplied.set(time, point);
  }
  const now = wallTime(weather.current.at),
    nowTemperature = weather.current.temperature;
  const firstTime = Number.isFinite(now)
    ? now - (now % DAY_MS) - DAY_MS
    : -Infinity;
  const yesterdayTime = weather.yesterday
    ? wallTime(weather.yesterday.at)
    : NaN;
  const times = [...supplied.keys()]
    .filter((time) => time >= firstTime)
    .sort((a, b) => a - b);
  // Never move an out-of-extent observation onto an unrelated forecast point.
  const nowInRange =
      times.length > 0 && now >= times[0] && now <= times[times.length - 1],
    inRange = nowInRange && finite(nowTemperature);
  const rows: HourRow[] = times.map((time) => {
    const point = supplied.get(time)!;
    const current = inRange && time === now;
    return {
      time,
      point: current ? mergeCurrentPoint(point, weather.current) : point,
      current,
      yesterday:
        supplied.get(time - DAY_MS) ??
        (time - DAY_MS === yesterdayTime ? weather.yesterday : null),
    };
  });
  let currentIndex = -1;
  if (nowInRange)
    for (let i = 0; i < rows.length && rows[i].time <= now; i++) currentIndex = i;
  const between =
    inRange && !rows[currentIndex].current
      ? {
          /** Fractional column position, halfway to the next row (native). */
          index: currentIndex + 0.5,
          temperature: nowTemperature as number,
          yesterday:
            weather.yesterday && finite(weather.yesterday.temperature)
              ? weather.yesterday.temperature
              : null,
        }
      : null;
  return {
    rows,
    domain: temperatureDomain([
      ...rows.flatMap((r) => [r.point.temperature, r.yesterday?.temperature]),
      between?.temperature,
      between?.yesterday,
    ]),
    currentIndex,
    current: between,
    startIndex: Math.max(0, currentIndex - 1),
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
