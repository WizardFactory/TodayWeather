/** Pure browser/server domain adapters. Never import the legacy application runtime. */
export type Units = {
  temperatureUnit: string;
  windSpeedUnit: string;
  pressureUnit: string;
  distanceUnit: string;
  precipitationUnit: string;
  airUnit: string;
};
export const DEFAULT_UNITS: Units = {
  temperatureUnit: "C",
  windSpeedUnit: "m/s",
  pressureUnit: "hPa",
  distanceUnit: "km",
  precipitationUnit: "mm",
  airUnit: "airkorea",
};
export const UNIT_OPTIONS: Record<keyof Units, readonly string[]> = {
  temperatureUnit: ["C", "F"],
  windSpeedUnit: ["m/s", "km/h", "mph", "kt", "bft"],
  pressureUnit: ["hPa", "mb", "mmHg", "inHg"],
  distanceUnit: ["km", "mi"],
  precipitationUnit: ["mm", "in"],
  airUnit: ["airkorea", "airnow", "aqicn", "airkorea_who"],
};
export const POLLUTANTS = [
  "aqi",
  "pm25",
  "pm10",
  "o3",
  "no2",
  "so2",
  "co",
] as const;
export type Pollutant = (typeof POLLUTANTS)[number];
export type Place = {
  id: string;
  name: string;
  address: string;
  country: string;
  lat: number;
  lon: number;
  current?: boolean;
};
export type Point = {
  at: string;
  temperature: number | null;
  low: number | null;
  high: number | null;
  humidity: number | null;
  wind: number | null;
  windDirection: string;
  pressure: number | null;
  visibility: number | null;
  precipitation: number | null;
  precipitationHours: number | null;
  /** D45: KMA forecast amounts are hidden; observed and approximate (category lower bound) amounts are marked. */
  precipitationBasis: "observed" | "partial" | "approx" | null;
  snowfall: number | null;
  snowfallHours: number | null;
  rainProbability: number | null;
  feelsLike: number | null;
  icon: string;
  iconPm: string;
  description: string;
  sunrise: string;
  sunset: string;
  uv: string;
  discomfort: string;
  foodPoisoning: string;
};
export type AirMeasure = {
  value: number | null;
  grade: number | null;
  label: string;
  guide: string;
  /** Station that supplied this pollutant when it differs from the main station. */
  station: string;
  hourly: {
    at: string;
    value: number | null;
    grade: number | null;
    forecast: boolean;
  }[];
  daily: { at: string; grade: number | null; label: string }[];
};
export type AirStation = {
  name: string;
  observedAt: string | null;
  forecastSource: string;
  forecastPublishedAt: string | null;
  pollutants: Record<Pollutant, AirMeasure>;
};
export type Weather = {
  schemaVersion: 1;
  source: "KMA" | "DSF";
  mode: "live" | "demo";
  location: Place;
  units: Units;
  observedAt: string | null;
  publishedAt: string | null;
  /** KMA short forecast publication; D43 says it can be stale. */
  forecastPublishedAt: string | null;
  fetchedAt: string;
  current: Point;
  yesterday: Point | null;
  hourly: Point[];
  daily: Point[];
  air: AirStation[];
  /** Provider wording only; no verified air observation time or inferred numeric grade. */
  airSummary?: string;
  availability: {
    weather: "available" | "partial";
    air: "available" | "unavailable";
  };
  notices: string[];
};
export type Nation = {
  mode: "demo" | "live";
  fetchedAt: string;
  units: Units;
  weather: { name: string; current: Point }[];
  air: { name: string; station: AirStation }[];
};
export type WarningBulletin = {
  id: string;
  name: string;
  announcement: string;
  comment: string;
  sections: { title: string; details: string[] }[];
  imageUrl?: string;
  type: number | null;
  /** Mobile shows the <참고사항> line only for numeric types 1 and 2. */
  note: boolean;
};
type Row = Record<string, unknown>;
const record = (v: unknown): Row =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

export function coordinates(
  lat: unknown,
  lon: unknown,
): { lat: number; lon: number } {
  if (
    (typeof lat !== "number" && typeof lat !== "string") ||
    (typeof lon !== "number" && typeof lon !== "string") ||
    String(lat).trim() === "" ||
    String(lon).trim() === ""
  )
    throw new Error("Invalid coordinates");
  const a = Number(lat),
    b = Number(lon);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    Math.abs(a) > 90 ||
    Math.abs(b) > 180
  )
    throw new Error("Invalid coordinates");
  return { lat: Math.round(a * 1000) / 1000, lon: Math.round(b * 1000) / 1000 };
}
export function placeId(lat: number, lon: number): string {
  const p = coordinates(lat, lon);
  return `p_${p.lat}_${p.lon}`;
}
export function numberValue(v: unknown, negative = false): number | null {
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    String(v).trim() === ""
  )
    return null;
  const n = Number(v);
  return Number.isFinite(n) && n > -100 && (negative || n >= 0) ? n : null;
}
export function parseUnits(value: unknown): Units {
  const r = record(value),
    out = { ...DEFAULT_UNITS };
  for (const key of Object.keys(UNIT_OPTIONS) as (keyof Units)[]) {
    if (r[key] !== undefined) {
      if (!UNIT_OPTIONS[key].includes(String(r[key])))
        throw new Error(`Invalid ${key}`);
      out[key] = String(r[key]);
    }
  }
  return out;
}
const factors: Record<string, Record<string, number>> = {
  wind: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kt: 0.5144444444 },
  pressure: { hPa: 1, mb: 1, mmHg: 1.33322387415, inHg: 33.8638866667 },
  distance: { km: 1, mi: 1.609344 },
  precipitation: { mm: 1, in: 25.4 },
};
// Server unitConverter band edges (lower-inclusive).
const beaufort = [
  0.3, 1.5, 3.3, 5.5, 8, 10.8, 13.9, 17.2, 20.7, 24.5, 28.4, 32.6,
];
export function convertValue(
  value: number | null,
  kind: string,
  from: string,
  to: string,
): number | null {
  if (value === null) return null;
  if (from === to) return value;
  if (kind === "temperature") {
    if (!["C", "F"].includes(from) || !["C", "F"].includes(to))
      throw new Error("Invalid temperature unit");
    return from === "C" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
  }
  if (kind === "wind" && from === "bft")
    throw new Error("Beaufort is categorical; request canonical wind units");
  const factor = factors[kind]?.[from];
  if (!factor) throw new Error("Invalid source unit");
  const base = value * factor;
  if (kind === "wind" && to === "bft") {
    const i = beaufort.findIndex((t) => base < t);
    return i < 0 ? 12 : i;
  }
  const target = factors[kind]?.[to];
  if (!target) throw new Error("Invalid target unit");
  return base / target;
}
/** Source wall-time without a fabricated timezone. HHMM strings and legacy hour=24 coexist. */
export function rowTime(value: unknown): string | null {
  const row = record(value),
    date = str(row.date).replaceAll("-", "");
  if (!/^\d{8}$/.test(date)) return null;
  const y = +date.slice(0, 4),
    m = +date.slice(4, 6),
    d = +date.slice(6, 8);
  let hour = Number(row.time ?? 0),
    minute = 0;
  if ((typeof row.time === "string" && row.time.length >= 3) || hour > 24) {
    minute = hour % 100;
    hour = Math.floor(hour / 100);
  }
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59 ||
    (hour === 24 && minute !== 0)
  )
    return null;
  const day = new Date(Date.UTC(y, m - 1, d));
  if (
    day.getUTCFullYear() !== y ||
    day.getUTCMonth() !== m - 1 ||
    day.getUTCDate() !== d
  )
    return null;
  day.setUTCHours(hour, minute);
  return day.toISOString().slice(0, 16);
}
export function sourceTime(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  if (/^\d{12}$/.test(s))
    return rowTime({ date: s.slice(0, 8), time: s.slice(8) });
  // KMA stnDateTime is YYYY.MM.DD.HH:MM; other KMA strings use a space.
  return s.replace(
    /^(\d{4})[.-](\d{2})[.-](\d{2})[. ](\d{2}:\d{2})/,
    "$1-$2-$3 $4",
  );
}
const clock = (v: unknown) =>
  str(v).match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1] ?? "";
type Role = "current" | "shortest" | "short" | "daily" | "hourly";
function point(
  value: unknown,
  source: Units,
  target: Units,
  isKma: boolean,
  period: 1 | 3 | 24,
  role: Role = period === 24 ? "daily" : period === 3 ? "hourly" : "current",
): Point | null {
  const r = record(value),
    at = rowTime(r);
  if (!at) return null;
  const temp = (v: unknown) => {
    const n = numberValue(v, true);
    return isKma && n === -50
      ? null
      : convertValue(
          n,
          "temperature",
          source.temperatureUnit,
          target.temperatureUnit,
        );
  };
  const unit = (v: unknown, kind: string, key: keyof Units) =>
    convertValue(numberValue(v), kind, source[key], target[key]);
  // D45: KMA r06/s06 are split or summed hourly categories, never shown as amounts.
  // rn1 is observed (current 1h, short 3h, daily accumulation) or a shortest
  // 1-hour category lower bound (approximate). Daily rows are limited to past
  // dates in normalizeWeather.
  const rain = isKma
    ? numberValue(r.rn1)
    : (numberValue(r.rn1) ?? numberValue(r.r06));
  const basis: Point["precipitationBasis"] =
    !isKma || rain === null
      ? null
      : role === "shortest"
        ? "approx"
        : "observed";
  const rainHours =
    rain === null || (isKma && role === "daily")
      ? null
      : isKma
        ? role === "short"
          ? 3
          : 1
        : period;
  const snow = isKma
    ? numberValue(r.sn1)
    : (numberValue(r.sn1) ?? numberValue(r.s1d) ?? numberValue(r.s06));
  const dspls = numberValue(r.dspls),
    ultrv = numberValue(r.ultrv);
  return {
    at,
    temperature: temp(r.t1h ?? r.t3h),
    low: temp(r.tmn ?? r.taMin),
    high: temp(r.tmx ?? r.taMax),
    humidity: numberValue(r.reh),
    wind: unit(r.wsd, "wind", "windSpeedUnit"),
    windDirection: str(r.wdd),
    pressure: unit(r.hPa ?? r.pressure, "pressure", "pressureUnit"),
    visibility: unit(r.visibility, "distance", "distanceUnit"),
    precipitation: convertValue(
      rain,
      "precipitation",
      source.precipitationUnit,
      target.precipitationUnit,
    ),
    precipitationHours: rainHours,
    precipitationBasis: basis,
    snowfall: convertValue(
      snow,
      "precipitation",
      source.precipitationUnit,
      target.precipitationUnit,
    ),
    snowfallHours:
      snow === null
        ? null
        : numberValue(r.sn1) !== null
          ? 1
          : numberValue(r.s1d) !== null
            ? 24
            : period,
    rainProbability: numberValue(r.pop),
    feelsLike: temp(r.sensorytem ?? r.sensible),
    icon: str(r.skyIcon ?? r.skyAm) || "cloud",
    iconPm: str(r.skyPm),
    description: str(r.weather),
    sunrise: clock(r.sunrise),
    sunset: clock(r.sunset),
    uv: str(r.ultrvStr)
      ? ultrv === null
        ? str(r.ultrvStr)
        : `${str(r.ultrvStr)} (${ultrv})`
      : str(r.uvIndex),
    discomfort:
      dspls !== null && dspls > 60
        ? str(r.dsplsStr)
          ? `${str(r.dsplsStr)} (${dspls})`
          : String(dspls)
        : "",
    foodPoisoning: str(r.fsnStr),
  };
}
/** Keep each metric's original accumulation duration when filling hourly gaps. */
function kmaForecast(
  short: unknown,
  shortest: unknown,
  source: Units,
  target: Units,
): Point[] {
  const timeline = new Map<string, Point>();
  for (const row of array(short)) {
    const p = point(row, source, target, true, 3, "short");
    if (p) timeline.set(p.at, p);
  }
  for (const row of array(shortest)) {
    const p = point(row, source, target, true, 1, "shortest");
    if (!p) continue;
    const previous = timeline.get(p.at);
    if (!previous) {
      timeline.set(p.at, p);
      continue;
    }
    // Missing hourly fields must not erase valid three-hour fields. Amounts and
    // durations are normalized together, so a retained 3h total stays labelled 3h.
    const valid = Object.fromEntries(
      Object.entries(p).filter(
        ([key, value]) =>
          value !== null &&
          value !== "" &&
          (key !== "icon" || !!str(record(row).skyIcon ?? record(row).skyAm)),
      ),
    );
    timeline.set(p.at, { ...previous, ...valid });
  }
  return [...timeline.values()].sort((a, b) => a.at.localeCompare(b.at));
}
export function normalizeAir(value: unknown): AirStation {
  const s = record(value),
    last = record(s.last ?? value),
    series = record(s.pollutants);
  const pollutants = {} as Record<Pollutant, AirMeasure>;
  const observed = sourceTime(last.dataTime ?? last.date);
  // Compare wall times as YYYY-MM-DD HH:MM regardless of T/space or seconds.
  const minuteKey = (v: string) => v.replace("T", " ").slice(0, 16);
  for (const code of POLLUTANTS) {
    const p = record(series[code]);
    pollutants[code] = {
      value: numberValue(last[`${code}Value`]),
      grade: numberValue(last[`${code}Grade`]),
      label: str(last[`${code}Str`]),
      guide: str(last[`${code}ActionGuide`]),
      station: str(last[`${code}StationName`]),
      hourly: array(p.hourly).map((v) => {
        const r = record(v);
        return {
          at: str(r.date),
          value: numberValue(r.val),
          grade: numberValue(r.grade),
          // AQI forecast rows carry no pubDate; like the mobile app, rows
          // after the latest observation are forecasts.
          forecast:
            !!str(r.pubDate) ||
            (!!observed && minuteKey(str(r.date)) > minuteKey(observed)),
        };
      }),
      daily: array(p.daily).map((v) => {
        const r = record(v);
        return {
          at: str(r.date),
          grade: numberValue(r.grade),
          label: str(r.str),
        };
      }),
    };
  }
  return {
    name: str(last.stationName) || str(last.sidoName) || "관측소 정보 없음",
    observedAt: observed,
    forecastSource: str(s.forecastSource).toLowerCase(),
    forecastPublishedAt: sourceTime(s.forecastPubDate),
    pollutants,
  };
}
export function normalizeWeather(
  value: unknown,
  options: {
    fetchedAt?: string;
    units?: Units;
    mode?: "live" | "demo";
    location?: Place;
  } = {},
): Weather {
  const raw = record(value),
    kma = raw.source === "KMA";
  const dsf =
    raw.source === "DSF" ||
    (!raw.source && record(raw.pubDate).DSF !== undefined);
  if (
    (!kma && !dsf) ||
    raw.error ||
    (raw.code !== undefined && Number(raw.code) >= 400)
  )
    throw new Error("Unsupported weather response");
  const source = parseUnits(raw.units),
    target = parseUnits(options.units ?? source);
  if (source.airUnit !== target.airUnit)
    throw new Error("Air standard mismatch");
  const currentRaw = kma ? record(raw.current) : record(array(raw.thisTime)[1]);
  const current = point(currentRaw, source, target, kma, 1);
  if (!current) throw new Error("Missing current weather");
  const geo = record(raw.location),
    loc = coordinates(
      geo.lat ?? options.location?.lat,
      geo.long ?? geo.lon ?? options.location?.lon,
    );
  const location: Place = {
    id: options.location?.id ?? placeId(loc.lat, loc.lon),
    name: str(raw.name) || options.location?.name || "선택한 지역",
    address: str(raw.address) || options.location?.address || "",
    country: str(raw.country) || options.location?.country || "",
    ...loc,
  };
  const points = (rows: unknown, period: 1 | 3 | 24) =>
    array(rows)
      .map((v) => point(v, source, target, kma, period))
      .filter((p): p is Point => p !== null)
      .sort((a, b) => a.at.localeCompare(b.at));
  // DSF hourly rows sum three provider hours (server _makeHourlyDataFromDSF).
  // The observed three-hour slot that ends after the current observation is
  // still accumulating (D45): label it partial, not a complete 3-hour total.
  const hourly = kma
      ? kmaForecast(raw.short, raw.shortest, source, target).map((p) =>
          p.precipitationBasis === "observed" &&
          p.precipitationHours === 3 &&
          p.at > current.at
            ? {
                ...p,
                precipitationBasis: "partial" as const,
                precipitationHours: null,
              }
            : p,
        )
      : points(raw.hourly, 3),
    daily = points(kma ? record(raw.midData).dailyData : raw.daily, 24);
  // Keep station emptiness authoritative; never carry an old station into a new result.
  const airRaw = Array.isArray(raw.airInfoList)
    ? raw.airInfoList
    : raw.airInfo
      ? [raw.airInfo]
      : currentRaw.arpltn
        ? [currentRaw.arpltn]
        : [];
  const air = airRaw.map(normalizeAir),
    yesterday = point(
      kma ? currentRaw.yesterday : array(raw.thisTime)[0],
      source,
      target,
      kma,
      1,
    );
  const notices: string[] = [];
  if (yesterday?.temperature === null)
    notices.push("어제 같은 시각의 기온을 제공하지 않습니다.");
  if (!air.length)
    notices.push("이 지역의 대기질 관측 자료를 제공하지 않습니다.");
  const today = current.at.slice(0, 10),
    before = new Date(today + "T00:00:00Z");
  before.setUTCDate(before.getUTCDate() - 1);
  const yesterdayDate = before.toISOString().slice(0, 10);
  // Keep yesterday for comparison; older rows are history outside this view.
  const recentDaily = daily
    .filter((p) => p.at.slice(0, 10) >= yesterdayDate)
    .map((p) =>
      kma && p.at.slice(0, 10) >= today
        ? { ...p, precipitation: null, precipitationBasis: null }
        : p,
    );
  return {
    schemaVersion: 1,
    source: kma ? "KMA" : "DSF",
    mode: options.mode ?? "live",
    location,
    units: target,
    observedAt: sourceTime(currentRaw.stnDateTime) ?? current.at,
    publishedAt: sourceTime(kma ? raw.currentPubDate : record(raw.pubDate).DSF),
    forecastPublishedAt: kma ? sourceTime(raw.shortPubDate) : null,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    current,
    yesterday,
    hourly,
    daily: recentDaily,
    air,
    ...(typeof currentRaw.summaryAir === "string" &&
    currentRaw.summaryAir.trim()
      ? { airSummary: str(currentRaw.summaryAir).trim().slice(0, 500) }
      : {}),
    availability: {
      weather: current.temperature === null ? "partial" : "available",
      air: air.length ? "available" : "unavailable",
    },
    notices,
  };
}
export function normalizeNation(
  value: unknown,
  options: { units: Units; mode: "demo" | "live" },
): Nation {
  const raw = record(value);
  if (!Array.isArray(raw.weather) || !Array.isArray(raw.air))
    throw new Error("Invalid nationwide response");
  // The BFF always requests canonical physical units; air standard comes from the query.
  const source = { ...DEFAULT_UNITS, airUnit: options.units.airUnit };
  return {
    mode: options.mode,
    units: options.units,
    fetchedAt: new Date().toISOString(),
    weather: raw.weather.flatMap((v) => {
      const r = record(v),
        current = point(r.current, source, options.units, true, 1);
      return current
        ? [{ name: str(r.cityName) || str(r.regionName), current }]
        : [];
    }),
    air: raw.air.map((v) => {
      const r = record(v);
      return {
        name: str(r.sidoName) || str(r.sidocityName),
        station: normalizeAir(r),
      };
    }),
  };
}
function warningImage(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["weather.go.kr", "www.weather.go.kr"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    url.protocol = "https:";
    return url.href;
  } catch {
    return;
  }
}
export function normalizeWarnings(value: unknown): WarningBulletin[] {
  if (!Array.isArray(value)) throw new Error("Invalid warning response");
  return value.map((v, i) => {
    const r = record(v);
    const type =
      typeof r.type === "number" && Number.isInteger(r.type) ? r.type : null;
    return {
      id: String(i),
      type,
      note: type === 1 || type === 2,
      name: str(r.name) || "기상 특보",
      announcement: str(r.announcement),
      comment: str(r.comment),
      sections: array(r.situationList).map((x) => {
        const s = record(x);
        return {
          title: [str(s.weatherStr), str(s.levelStr)]
            .filter(Boolean)
            .join(" · "),
          details: array(s.info).map((y) => {
            const d = record(y);
            return [
              str(d.timeStr),
              Array.isArray(d.location)
                ? d.location.map(str).join(", ")
                : str(d.location),
            ]
              .filter(Boolean)
              .join(" ");
          }),
        };
      }),
      ...(warningImage(r.imageUrl)
        ? { imageUrl: warningImage(r.imageUrl) }
        : {}),
    };
  });
}
export const PLACES: Place[] = [
  ["seoul", "서울", "서울특별시 중구", "KR", 37.567, 126.978],
  ["busan", "부산", "부산광역시 중구", "KR", 35.179, 129.076],
  ["incheon", "인천", "인천광역시 남동구", "KR", 37.456, 126.705],
  ["daegu", "대구", "대구광역시 중구", "KR", 35.871, 128.601],
  ["daejeon", "대전", "대전광역시 서구", "KR", 36.35, 127.385],
  ["gwangju", "광주", "광주광역시 서구", "KR", 35.16, 126.852],
  ["ulsan", "울산", "울산광역시 남구", "KR", 35.539, 129.311],
  ["jeju", "제주", "제주특별자치도 제주시", "KR", 33.499, 126.531],
  ["gangneung", "강릉", "강원특별자치도 강릉시", "KR", 37.752, 128.876],
  ["suwon", "수원", "경기도 수원시", "KR", 37.263, 127.029],
  ["chuncheon", "춘천", "강원특별자치도 춘천시", "KR", 37.881, 127.73],
  ["cheongju", "청주", "충청북도 청주시", "KR", 36.642, 127.489],
  ["jeonju", "전주", "전북특별자치도 전주시", "KR", 35.824, 127.148],
  ["pohang", "포항", "경상북도 포항시", "KR", 36.019, 129.343],
  ["mokpo", "목포", "전라남도 목포시", "KR", 34.811, 126.392],
  ["yeosu", "여수", "전라남도 여수시", "KR", 34.761, 127.662],
  ["andong", "안동", "경상북도 안동시", "KR", 36.569, 128.729],
  ["tokyo", "도쿄", "Tokyo, Japan", "JP", 35.69, 139.692],
  ["london", "런던", "London, United Kingdom", "GB", 51.507, -0.128],
  ["new-york", "뉴욕", "New York, United States", "US", 40.713, -74.006],
  ["berlin", "베를린", "Berlin, Germany", "DE", 52.52, 13.405],
  ["singapore", "싱가포르", "Singapore", "SG", 1.352, 103.82],
].map(([id, name, address, country, lat, lon]) => ({
  id: String(id),
  name: String(name),
  address: String(address),
  country: String(country),
  lat: Number(lat),
  lon: Number(lon),
}));
const shortSido = (t: string) =>
  t.replace(/(특별시|광역시|특별자치시)$/, "시").replace(/특별자치도$/, "도");
/** Mobile getShortenAddress token rules; parts joined by a space. */
export function shortenAddress(address: string): string {
  const t = str(address).split(" ");
  const parts =
    t.length === 2
      ? [shortSido(t[1])]
      : t.length === 3
        ? [shortSido(t[1]), t[2]]
        : t.length === 4
          ? [shortSido(t[1].endsWith("도") ? t[2] : t[1]), t[3]]
          : t.length === 5
            ? [shortSido(t[2]), t[4]]
            : [];
  return parts.filter(Boolean).join(" ");
}
export function formatValue(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(
        v,
      );
}
