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
    timeline.set(now, {
      ...(timeline.get(now) ?? weather.current),
      ...weather.current,
    });
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
): string {
  let connected = false;
  return values
    .map((value, i) => {
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
