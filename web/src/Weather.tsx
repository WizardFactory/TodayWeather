import { useState, useEffect } from "react";
import { dateText, hourText } from "./locale";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Share2,
  RefreshCw,
  MapPin,
  ArrowUpRight,
  Droplets,
  Wind,
  Gauge,
  Eye,
  Sun,
  Thermometer,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import {
  formatValue,
  PLACES,
  POLLUTANTS,
  type AirStation,
  type Pollutant,
  type Weather,
  type Point,
} from "@todayweather/core";
import { useApp } from "./context";
import { fetchWeather, readStoredWeather } from "./api";
import { weatherKey, resolvePlace } from "./state";
import {
  WeatherIcon,
  Stamp,
  Loading,
  ErrorState,
  Empty,
  DataNotice,
  dayLabel,
  TemperatureChart,
  SectionHead,
  isOld,
  percent,
} from "./components";
import {
  airDisclaimer,
  airSource,
  airWindow,
  forecastDescription,
  gradeClass,
  gradeLabel,
  pollutantUnit,
  standardName,
} from "./air";
import { amount, approxAmount, weatherStaleTime, windText } from "./format";
import { coreText, t, useLanguage } from "./i18n";
import { placeArea, placeName } from "./places";
const pollutantLabel = (code: Pollutant) => t(`pollutant.${code}`);
/** Rain text that labels observed, approximate and server-forecast amounts. */
function rainText(p: Point, unit: string): string {
  if (p.precipitation === null)
    return p.rainProbability === null
      ? t("rain.none")
      : t("rain.probability", { value: percent(p.rainProbability) });
  const value =
    p.precipitationBasis === "approx"
      ? approxAmount(p.precipitation, unit)
      : `${amount(p.precipitation, unit)} ${unit}`;
  return t("rain.amount", { value, suffix: rainSuffix(p) });
}
function rainSuffix(p: Point): string {
  if (p.precipitation === null) return "";
  const hours = p.precipitationHours;
  if (p.precipitationBasis === "approx") return " · " + t("rain.suffix.approx");
  if (p.precipitationBasis === "partial")
    return " · " + t("rain.suffix.partial");
  if (p.precipitationBasis === "forecast")
    return (
      " · " +
      (hours === null
        ? t("rain.suffix.forecast")
        : t("rain.suffix.forecastHours", { hours }))
    );
  if (p.precipitationBasis === "observed")
    return (
      " · " +
      (hours === null
        ? t("rain.suffix.observed")
        : t("rain.suffix.observedHours", { hours }))
    );
  return hours === null ? "" : " · " + t("rain.suffix.hours", { hours });
}
/** KMA short/daily snow (s06) is the server's forecast; current sn1 is 1 hour. */
function snowSuffix(p: Point, source: Weather["source"]): string {
  if (p.snowfall === null) return "";
  const hours = p.snowfallHours;
  if (source === "KMA" && hours !== 1)
    return (
      " · " +
      (hours === null
        ? t("rain.suffix.forecast")
        : t("rain.suffix.forecastHours", { hours }))
    );
  return hours === null ? "" : " · " + t("rain.suffix.hours", { hours });
}
function airValue(value: number | null, code: string) {
  const unit = pollutantUnit(code);
  const text = formatValue(
    value,
    code === "aqi" || code === "pm25" || code === "pm10" ? 0 : 3,
  );
  return value === null || !unit ? text : `${text} ${unit}`;
}
export default function WeatherPage({ view: fixedView }: { view?: string }) {
  useLanguage();
  const [search] = useSearchParams();
  const linkedPollutant = POLLUTANTS.find((c) => c === search.get("pollutant"));
  const { locationId, view: paramView } = useParams(),
    view = fixedView ?? paramView ?? "hourly";
  const { state, setState, notify } = useApp();
  const navigate = useNavigate();
  const place = resolvePlace(state, locationId);
  useEffect(() => {
    if (
      place &&
      state.places.some((p) => p.id === place.id) &&
      state.selectedId !== place.id
    )
      setState((s) => ({ ...s, selectedId: place.id }));
  }, [place?.id]);
  const units = state.settings.units;
  const key = place ? weatherKey(place, units) : "none";
  // Render a valid stored snapshot immediately while the network request runs.
  const stored = useQuery({
    queryKey: ["stored-weather", key],
    queryFn: () => readStoredWeather(key),
    enabled: !!place,
    staleTime: Infinity,
  });
  const query = useQuery({
    queryKey: ["weather", key],
    queryFn: ({ signal }) => fetchWeather(place!, units, signal),
    enabled: !!place,
    staleTime: (q) => weatherStaleTime(q.state.data, q.state.dataUpdatedAt),
    refetchOnWindowFocus: true,
    refetchInterval: state.settings.refreshMinutes
      ? state.settings.refreshMinutes * 60000
      : false,
    refetchIntervalInBackground: false,
  });
  if (!place)
    return (
      <Empty title={t("weather.selectFirst")}>
        <Link to="/locations">{t("weather.manageLocations")}</Link>
      </Empty>
    );
  const live = query.data;
  const showStored = !live && query.isPending && !!stored.data;
  const data = live?.weather ?? (showStored ? stored.data! : undefined);
  async function share() {
    const publicPlace = PLACES.find(
      (p) =>
        p.id === place!.id ||
        (Math.abs(p.lat - place!.lat) < 0.04 &&
          Math.abs(p.lon - place!.lon) < 0.04),
    );
    if (!publicPlace) {
      notify(t("weather.share.pickCity"));
      return;
    }
    const url = new URL("/place/" + publicPlace.id, location.origin).href;
    try {
      if (navigator.share)
        await navigator.share({
          title: t("weather.share.title", { name: placeName(publicPlace) }),
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        notify(t("weather.share.copied"));
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError")
        notify(t("weather.share.copyManually"));
    }
  }
  return (
    <>
      <div className="weather-page-head">
        <div>
          <div className="eyebrow">
            <MapPin size={13} />{" "}
            {place.country === "KR" ? t("country.KR") : place.country} ·{" "}
            {placeArea(place)}
          </div>
          <h1>
            {(() => {
              const title = placeName({
                ...place,
                name: data?.location.name || place.name,
              });
              // Server place names can be long: ellipsis, full name on hover.
              return (
                <span className="place-title" title={title}>
                  {title}
                </span>
              );
            })()}
            <span className="live-dot" />
          </h1>
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            aria-label={t("weather.refresh")}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={18} className={query.isFetching ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            aria-label={t("weather.share")}
            onClick={share}
          >
            <Share2 size={18} />
          </button>
          <Link
            className="icon-button"
            aria-label={t("weather.notifications")}
            to={"/notifications/" + place.id}
          >
            <Bell size={18} />
          </Link>
        </div>
      </div>
      <nav className="view-tabs" aria-label={t("weather.tabs")}>
        {(["hourly", "daily", "air", "overview"] as const).map((id) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            aria-pressed={view === id}
            onClick={() =>
              navigate(
                id === "air"
                  ? `/air/${place.id}`
                  : `/weather/${place.id}/${id}`,
                { state: { keepFocus: true } },
              )
            }
          >
            {t(`weather.tab.${id}`)}
          </button>
        ))}
      </nav>
      {!data && query.isPending ? (
        <Loading />
      ) : query.isError && !data ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <>
          <DataNotice
            weather={data}
            snapshot={live?.snapshot ?? false}
            notice={live?.notice}
            refreshing={showStored}
            refreshFailed={query.isError && !!live}
          />
          {view === "air" ? (
            <AirDetails
              key={data.location.id}
              weather={data}
              initialCode={linkedPollutant}
            />
          ) : (
            <WeatherDetails weather={data} view={view} />
          )}
          <footer className="data-footer">
            <span>
              {t("weather.footer", {
                source: t(
                  data.source === "KMA"
                    ? "weather.source.kma"
                    : "weather.source.vc",
                ),
                unit: data.units.temperatureUnit,
              })}
            </span>
            {data.source === "VC" && (
              <a
                className="text-link powered-by"
                href="https://www.visualcrossing.com/"
                target="_blank"
                rel="noreferrer"
              >
                Weather Data Provided by Visual Crossing
              </a>
            )}
            <Stamp
              at={data.observedAt}
              zone={data.source === "KMA" ? "KST" : "local"}
            />
          </footer>
        </>
      ) : null}
    </>
  );
}
function WeatherDetails({
  weather: w,
  view,
}: {
  weather: Weather;
  view: string;
}) {
  const zone = w.source === "KMA" ? ("KST" as const) : ("local" as const);
  const now = w.current,
    unit = w.units.precipitationUnit,
    standard = w.units.airUnit,
    delta =
      now.temperature !== null &&
      w.yesterday?.temperature !== null &&
      w.yesterday?.temperature !== undefined
        ? now.temperature - w.yesterday.temperature
        : null;
  // Mobile rounds the yesterday difference in °F and keeps one decimal in °C.
  const deltaDigits = w.units.temperatureUnit === "F" ? 0 : 1;
  const today = w.daily.find((p) => p.at.slice(0, 10) === now.at.slice(0, 10));
  const hourly = w.hourly.filter((p) => p.at >= now.at).slice(0, 16);
  const snowLabel = t(
    w.source === "KMA" ? "metric.snowDepth" : "metric.snowfall",
  );
  const previous = hourly.map((p) => {
    const date = new Date(p.at.slice(0, 10) + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - 1);
    return (
      w.hourly.find(
        (y) => y.at === date.toISOString().slice(0, 10) + p.at.slice(10),
      ) ?? { ...p, temperature: null }
    );
  });
  const air = w.air[0];
  const aqiForecast = air
    ? air.pollutants.aqi.hourly
        .filter(
          (h) =>
            h.forecast &&
            (!air.observedAt ||
              h.at.replace("T", " ") >= air.observedAt.replace("T", " ")),
        )
        .slice(0, 4)
    : [];
  const wind = [
    windText(now.windDirection),
    `${formatValue(now.wind, 1)} ${w.units.windSpeedUnit}`,
  ]
    .filter(Boolean)
    .join(" ");
  const details: [typeof Gauge, string, string][] = [
    [
      Gauge,
      t("detail.pressure"),
      `${formatValue(now.pressure, 1)} ${w.units.pressureUnit}`,
    ],
    [
      Eye,
      t("detail.visibility"),
      `${formatValue(now.visibility, 1)} ${w.units.distanceUnit}`,
    ],
    [
      Sun,
      t("detail.sunrise"),
      today?.sunrise || now.sunrise || t("common.noInfo"),
    ],
    [
      MoonIcon,
      t("detail.sunset"),
      today?.sunset || now.sunset || t("common.noInfo"),
    ],
  ];
  const uv = today?.uv || now.uv;
  if (uv) details.push([Sun, t("detail.uv"), uv]);
  if (now.discomfort)
    details.push([Thermometer, t("detail.discomfort"), now.discomfort]);
  if (today?.foodPoisoning)
    details.push([Droplets, t("detail.foodPoisoning"), today.foodPoisoning]);
  return (
    <>
      <div className="overview-grid">
        <section className="hero-card">
          <div className="hero-top">
            <span className="pill">{t("weather.now")}</span>
            <span>
              {dayLabel(now.at, now.at)} · {hourText(now.at)}
            </span>
          </div>
          <div className="hero-weather">
            <div>
              <div className="temperature">
                {formatValue(now.temperature)}
                <span>°{w.units.temperatureUnit}</span>
              </div>
              <h2>{now.description || t("weather.nowFallback")}</h2>
            </div>
            <WeatherIcon icon={now.icon} size={110} />
          </div>
          <div className="hero-bottom">
            <span>
              {delta === null
                ? t("weather.yesterday.none")
                : Number(formatValue(Math.abs(delta), deltaDigits)) === 0
                  ? t("weather.yesterday.same")
                  : delta > 0
                    ? t("weather.yesterday.warmer", {
                        delta: formatValue(delta, deltaDigits),
                      })
                    : t("weather.yesterday.colder", {
                        delta: formatValue(-delta, deltaDigits),
                      })}
            </span>
            <span>
              <ArrowDown size={14} />
              {formatValue(today?.low)}° <ArrowUp size={14} />
              {formatValue(today?.high)}°
            </span>
          </div>
        </section>
        <section className="panel air-summary">
          <SectionHead
            title={t("weather.air.title")}
            aside={
              <Link
                aria-label={t("weather.air.more")}
                to={"/air/" + w.location.id}
              >
                <ArrowUpRight size={18} />
              </Link>
            }
          />
          {air ? (
            <>
              <div
                className={`air-orb ${gradeClass(standard, air.pollutants.aqi.grade)}`}
              >
                <strong>{formatValue(air.pollutants.aqi.value)}</strong>
                <span>
                  {air.pollutants.aqi.label ||
                    gradeLabel(standard, air.pollutants.aqi.grade)}
                </span>
              </div>
              <div className="air-small-values">
                <span>
                  {pollutantLabel("pm10")}{" "}
                  <b>{airValue(air.pollutants.pm10.value, "pm10")}</b>
                </span>
                <span>
                  {pollutantLabel("pm25")}{" "}
                  <b>{airValue(air.pollutants.pm25.value, "pm25")}</b>
                </span>
              </div>
              {aqiForecast.length > 0 && (
                <div
                  className="air-forecast"
                  aria-label={t("weather.air.aqiForecast")}
                >
                  {aqiForecast.map((h) => (
                    <span key={h.at}>
                      <small>{hourText(h.at)}</small>
                      <b className={"grade " + gradeClass(standard, h.grade)}>
                        {gradeLabel(standard, h.grade)}
                      </b>
                    </span>
                  ))}
                </div>
              )}
              <Stamp at={air.observedAt} zone={zone} />
              {isOld(air.observedAt, 3, Date.now(), zone) && (
                <p className="warning-text">{t("weather.air.stale")}</p>
              )}
            </>
          ) : (
            <>
              <Empty title={t("weather.air.none")}>
                {t("weather.air.noneBody")}
              </Empty>
              <ProviderAirSummary weather={w} />
            </>
          )}
          {w.source === "KMA" && (air || w.airSummary) && (
            <div className="source-credit">
              <p>{airSource()}</p>
              <p>{airDisclaimer()}</p>
            </div>
          )}
        </section>
      </div>
      <div className="metrics-grid">
        {[
          [Droplets, t("metric.humidity"), `${formatValue(now.humidity)}%`, ""],
          [Wind, t("metric.wind"), wind, ""],
          [
            Thermometer,
            t("metric.feelsLike"),
            `${formatValue(now.feelsLike)}°`,
            "",
          ],
          [
            CloudRainIcon,
            t("metric.precipitation"),
            now.precipitationBasis === "approx"
              ? approxAmount(now.precipitation, unit)
              : `${amount(now.precipitation, unit)} ${unit}`,
            rainSuffix(now),
          ],
          ...(now.snowfall !== null && now.snowfall > 0
            ? [
                [
                  CloudRainIcon,
                  snowLabel,
                  `${amount(now.snowfall, unit)} ${unit}`,
                  snowSuffix(now, w.source),
                ],
              ]
            : []),
        ].map(([Icon, label, value, suffix]) => {
          const I = Icon as typeof Droplets;
          return (
            <div className="metric panel" key={String(label)}>
              <I size={20} />
              <div>
                <span>
                  {String(label)}
                  {String(suffix)}
                </span>
                <strong>{String(value)}</strong>
              </div>
            </div>
          );
        })}
      </div>
      {view !== "daily" && (
        <section className="panel chart-panel">
          <SectionHead
            title={t("weather.hourly.title")}
            aside={
              <div className="chart-legend">
                <span>
                  <i />
                  {t("weather.legend.forecast")}
                </span>
                <span>
                  <i className="muted" />
                  {t("weather.legend.yesterday")}
                </span>
              </div>
            }
          />
          <TemperatureChart
            points={hourly}
            yesterday={previous}
            unit={w.units.temperatureUnit}
            reference={now.at}
          />
          {w.forecastPublishedAt && (
            <p className="muted-text">
              <Stamp
                at={w.forecastPublishedAt}
                label={t("weather.forecastPublished")}
                zone="KST"
              />
              {isOld(w.forecastPublishedAt, 24) && (
                <span className="warning-text">
                  {" "}
                  · {t("weather.forecastStale")}
                </span>
              )}
            </p>
          )}
        </section>
      )}
      {(view === "daily" || view === "overview") && (
        <DailyForecast weather={w} />
      )}
      <section className="panel">
        <SectionHead title={t("weather.precipitation.title")} />
        <div className="detail-grid">
          {(view === "daily" ? w.daily : hourly).slice(0, 8).map((p) => (
            <div key={p.at}>
              <span>
                {dayLabel(p.at, now.at)} {view !== "daily" && hourText(p.at)}
              </span>
              <span>{rainText(p, unit)}</span>
              {p.snowfall !== null && p.snowfall > 0 && (
                <span>
                  {snowLabel} {amount(p.snowfall, unit)} {unit}
                  {snowSuffix(p, w.source)}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel details-panel">
        <SectionHead title={t("weather.details.title")} />
        <div className="detail-grid">
          {details.map(([I, label, value]) => (
            <div key={label}>
              <I size={18} />
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </section>
      {w.notices.length > 0 && (
        <div className="source-notes">
          {w.notices.map((n) => (
            <p key={n}>{coreText(n)}</p>
          ))}
        </div>
      )}
    </>
  );
}
import { CloudRain as CloudRainIcon, Moon as MoonIcon } from "lucide-react";
function DailyForecast({ weather: w }: { weather: Weather }) {
  const vals = w.daily
      .flatMap((p) => [p.low, p.high])
      .filter((n): n is number => n !== null),
    min = Math.min(...vals),
    max = Math.max(...vals),
    range = max - min || 1;
  return (
    <section className="panel">
      <SectionHead
        title={t("daily.title")}
        aside={<span className="muted-text">{t("daily.legend")}</span>}
      />
      {!w.daily.length ? (
        <Empty title={t("daily.empty")} />
      ) : (
        <div className="daily-list">
          {w.daily.slice(0, 14).map((p) => (
            <div className="daily-row" key={p.at}>
              <span>{dayLabel(p.at, w.current.at)}</span>
              <div className="daily-icons">
                <WeatherIcon icon={p.icon} size={27} />
                <WeatherIcon icon={p.iconPm || p.icon} size={27} />
              </div>
              <span className="rain-label">{percent(p.rainProbability)}</span>
              <b className="low-temp">{formatValue(p.low)}°</b>
              <div className="temp-range">
                {p.low !== null && p.high !== null && (
                  <i
                    style={{
                      left: ((p.low - min) / range) * 75 + "%",
                      width: Math.max(5, ((p.high - p.low) / range) * 75) + "%",
                    }}
                  />
                )}
              </div>
              <b>{formatValue(p.high)}°</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function ProviderAirSummary({ weather: w }: { weather: Weather }) {
  if (!w.airSummary) return null;
  return (
    <div role="note" className="provider-air-summary">
      <h3>{t("air.provider.title")}</h3>
      <p>{w.airSummary}</p>
      <p className="warning-text">{t("air.provider.note")}</p>
    </div>
  );
}
function AirAttribution({
  weather: w,
  station,
}: {
  weather: Weather;
  station?: AirStation;
}) {
  if (w.source !== "KMA") return null;
  const source = station?.forecastSource ?? "";
  return (
    <div className="air-attribution">
      <p>{airSource()}</p>
      <p>{airDisclaimer()}</p>
      {source && (
        <p>
          {t("air.forecastSource", { source: source.toUpperCase() })}
          {forecastDescription(source) &&
            ` · ${forecastDescription(source)}`}{" "}
          {station?.forecastPublishedAt && (
            <Stamp
              at={station.forecastPublishedAt}
              label={t("weather.forecastPublished")}
              zone="KST"
            />
          )}
        </p>
      )}
    </div>
  );
}
function AirDetails({
  weather: w,
  initialCode,
}: {
  weather: Weather;
  initialCode?: Pollutant;
}) {
  const [stationIndex, setStationIndex] = useState(0),
    [code, setCode] = useState<Pollutant>(initialCode ?? "aqi");
  const standard = w.units.airUnit;
  const zone = w.source === "KMA" ? ("KST" as const) : ("local" as const);
  const station = w.air[stationIndex] ?? w.air[0];
  if (!station)
    return (
      <section className="panel">
        <Empty title={t("air.none.title")}>{t("air.none.body")}</Empty>
        <ProviderAirSummary weather={w} />
        {w.airSummary && <AirAttribution weather={w} />}
      </section>
    );
  const p = station.pollutants[code],
    slots = airWindow(p.hourly, station.observedAt),
    max = Math.max(1, ...slots.map((v) => v?.value ?? 0));
  const otherStation = (c: Pollutant) =>
    station.pollutants[c].station &&
    station.pollutants[c].station !== station.name
      ? station.pollutants[c].station
      : "";
  return (
    <>
      <section className="panel air-detail">
        <div className="section-head">
          <h2>{t("air.title")}</h2>
          <label className="station-select">
            {t("air.stationLabel")}{" "}
            <select
              value={stationIndex}
              onChange={(e) => setStationIndex(Number(e.target.value))}
            >
              {w.air.map((s, i) => (
                <option key={i} value={i}>
                  {coreText(s.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="air-detail-main">
          <div className={`air-orb large ${gradeClass(standard, p.grade)}`}>
            <span>{pollutantLabel(code)}</span>
            <strong>{airValue(p.value, code)}</strong>
            <span>{p.label || gradeLabel(standard, p.grade)}</span>
          </div>
          <div>
            <span className="eyebrow">{standardName(standard)}</span>
            <h2>{p.label || gradeLabel(standard, p.grade)}</h2>
            <p>{p.guide || t("air.guideFallback")}</p>
            {otherStation(code) && (
              <p className="muted-text">
                {t("air.otherStation", { name: otherStation(code) })}
              </p>
            )}
            <Stamp at={station.observedAt} zone={zone} />
            {isOld(station.observedAt, 3, Date.now(), zone) && (
              <p className="warning-text">{t("air.stale")}</p>
            )}
          </div>
        </div>
        <div className="pollutant-grid">
          {POLLUTANTS.map((c) => (
            <button
              key={c}
              className={code === c ? "selected" : ""}
              aria-pressed={code === c}
              onClick={() => setCode(c)}
            >
              <span>{pollutantLabel(c)}</span>
              <strong>{airValue(station.pollutants[c].value, c)}</strong>
              <small
                className={
                  "grade " + gradeClass(standard, station.pollutants[c].grade)
                }
              >
                {station.pollutants[c].label ||
                  gradeLabel(standard, station.pollutants[c].grade)}
              </small>
              {otherStation(c) && (
                <span className="pollutant-station">{otherStation(c)}</span>
              )}
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <SectionHead
          title={t("air.hourlyTitle", { pollutant: pollutantLabel(code) })}
          aside={
            <div className="air-legend">
              <span>
                <i />
                {t("air.legend.observed")}
              </span>
              <span>
                <i className="forecast" />
                {t("air.legend.forecast")}
              </span>
            </div>
          }
        />
        {slots.some(Boolean) ? (
          <div className="bar-chart">
            {slots.map((v, i) => {
              const prev = slots[i - 1];
              const showDate =
                !!v &&
                (!prev ||
                  prev.at.slice(0, 10) !== v.at.slice(0, 10) ||
                  i === 0);
              return v ? (
                <div
                  key={i}
                  title={`${v.at} ${formatValue(v.value, 2)} ${t(v.forecast ? "air.legend.forecast" : "air.legend.observed")}`}
                >
                  <span>{formatValue(v.value, 1)}</span>
                  <i
                    className={`${gradeClass(standard, v.grade)}${v.forecast ? " forecast" : ""}`}
                    style={{
                      height: Math.max(3, ((v.value ?? 0) / max) * 120),
                    }}
                  />
                  <small className={showDate ? "date" : ""}>
                    {showDate ? dateText(v.at) : hourText(v.at)}
                  </small>
                </div>
              ) : (
                <div key={i} className="empty" title="">
                  <span />
                  <i style={{ height: 3 }} />
                  <small />
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title={t("air.hourlyEmpty")} />
        )}
        {p.daily.length > 0 && (
          <div className="daily-air">
            {p.daily.map((v, i) => (
              <div key={i}>
                <span>{dayLabel(v.at, w.current.at)}</span>
                <strong>{v.label || gradeLabel(standard, v.grade)}</strong>
              </div>
            ))}
          </div>
        )}
        <AirAttribution weather={w} station={station} />
      </section>
    </>
  );
}
