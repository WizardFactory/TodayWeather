import { useState, useEffect, useRef } from "react";
import { dateText, hourText } from "./locale";
import {
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
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
  SectionHead,
  isOld,
  percent,
} from "./components";
import {
  airCredit,
  airWindow,
  forecastDescription,
  gradeClass,
  gradeLabel,
  pollutantUnit,
  standardName,
} from "./air";
import {
  amount,
  precipitationAmount,
  forecastAmount,
  weatherStaleTime,
  windText,
} from "./format";
import { coreText, t, useLanguage } from "./i18n";
import { placeArea, placeName } from "./places";
import { HourlyChart, DailyChart } from "./Charts";
import { iconKind } from "./format";
const pollutantLabel = (code: Pollutant) => t(`pollutant.${code}`);
/** Rain text that labels observed, approximate and server-forecast amounts. */
function rainText(p: Point, unit: string): string {
  if (p.precipitation === null)
    return p.rainProbability === null
      ? t("rain.none")
      : t("rain.probability", { value: percent(p.rainProbability) });
  const value = precipitationAmount(p, unit);
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
  if (source === "KMA" && (p.snowfallBasis === "forecast" || hours !== 1))
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
  const { state, setState, notify, contentInert } = useApp();
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
  const live = query.data;
  const showStored = !live && query.isPending && !!stored.data;
  const data = live?.weather ?? (showStored ? stored.data! : undefined);
  const route = useLocation();
  // Stored and live data can differ between an empty section and a chart.
  const hasChartRows = Boolean(
    view === "daily" ? data?.daily.length : data?.hourly.length,
  );
  const pendingContentFocus = useRef(false);
  useEffect(() => {
    pendingContentFocus.current = view === "hourly" || view === "daily";
  }, [
    route.key,
    view,
    !!data,
    data?.location.id,
    hasChartRows,
    query.isPending,
  ]);
  useEffect(() => {
    if (contentInert || !pendingContentFocus.current) return;
    // The shell's non-inert commit, not frame timing, owns menu-close readiness.
    const frame = requestAnimationFrame(() => {
      pendingContentFocus.current = false;
      const section = document.querySelector<HTMLElement>(
        `[data-weather-section="${view}"]`,
      );
      // Loading and terminal failures have no chart section. Keep the route's
      // content focus there until data supplies the selected chart or empty state.
      if (!section) {
        const main = document.getElementById("main-content");
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ block: "start", behavior: "instant" });
        return;
      }
      const target =
        section.querySelector<HTMLElement>('.chart-scroll[role="group"]') ??
        section;
      target.focus({ preventScroll: true });
      section.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    route.key,
    contentInert,
    view,
    !!data,
    data?.location.id,
    hasChartRows,
    query.isPending,
  ]);
  if (!place)
    return (
      <Empty title={t("weather.selectFirst")}>
        <Link to="/locations">{t("weather.manageLocations")}</Link>
      </Empty>
    );
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
  const hourly = w.hourly;
  const snowLabel = t(
    w.source === "KMA" ? "metric.snowDepth" : "metric.snowfall",
  );
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
  const pollen = today || now;
  const pollenText = (grade: number) =>
    [
      t("pollen.low"),
      t("pollen.moderate"),
      t("pollen.high"),
      t("pollen.veryHigh"),
    ][grade];
  if (pollen.pollenOak !== undefined)
    details.push([Sun, t("detail.pollenOak"), pollenText(pollen.pollenOak)]);
  if (pollen.pollenPine !== undefined)
    details.push([Sun, t("detail.pollenPine"), pollenText(pollen.pollenPine)]);
  if (pollen.pollenWeeds !== undefined)
    details.push([
      Sun,
      t("detail.pollenWeeds"),
      pollenText(pollen.pollenWeeds),
    ]);
  if (now.discomfort)
    details.push([Thermometer, t("detail.discomfort"), now.discomfort]);
  return (
    <>
      <div className="overview-grid">
        <section
          className="hero-card"
          data-weather-section="hero"
          data-sky={skyKind(now.icon, now.at)}
        >
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
      </div>
      <section
        className="panel chart-panel"
        data-weather-section="hourly"
        tabIndex={-1}
      >
        <SectionHead
          title={t("weather.hourly.title")}
          aside={
            <div className="chart-legend">
              <span>
                <i />
                {t("weather.legend.forecast")}
              </span>
              {(w.yesterday ||
                w.hourly.some(
                  (p) => p.at.slice(0, 10) < w.current.at.slice(0, 10),
                )) && (
                <span>
                  <i className="muted" />
                  {t("weather.legend.yesterday")}
                </span>
              )}
            </div>
          }
        />
        <HourlyChart weather={w} />
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
      <DailyChart weather={w} />
      <section className="panel air-summary" data-weather-section="air">
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
        {(air || w.airSummary) && airCredit(w.source, air).length > 0 && (
          <div className="source-credit">
            {airCredit(w.source, air).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </section>
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
            precipitationAmount(now, unit),
            rainSuffix(now),
          ],
          ...(now.snowfall !== null && now.snowfall > 0
            ? [
                [
                  CloudRainIcon,
                  snowLabel,
                  forecastAmount(now.snowfall, unit, now.snowfallApprox),
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
                  {snowLabel}{" "}
                  {forecastAmount(p.snowfall, unit, p.snowfallApprox)}
                  {snowSuffix(p, w.source)}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="panel details-panel" data-weather-section="details">
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
  const credit = airCredit(w.source, station);
  const source = station?.forecastSource ?? "";
  if (!credit.length && !source) return null;
  return (
    <div className="air-attribution">
      {credit.map((line) => (
        <p key={line}>{line}</p>
      ))}
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
          {/* Modeled providers (#2628) have no station: no picker then. */}
          {(w.air.length > 1 || station.name !== "관측소 정보 없음") && (
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
          )}
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
        <div
          className="pollutant-grid"
          role="radiogroup"
          aria-label={t("air.title")}
          onKeyDown={(event) => {
            const index = POLLUTANTS.indexOf(code),
              step = ["ArrowRight", "ArrowDown"].includes(event.key)
                ? 1
                : ["ArrowLeft", "ArrowUp"].includes(event.key)
                  ? -1
                  : 0;
            if (!step) return;
            event.preventDefault();
            const next = (index + step + POLLUTANTS.length) % POLLUTANTS.length;
            setCode(POLLUTANTS[next]);
            (
              event.currentTarget.querySelectorAll("button")[
                next
              ] as HTMLButtonElement
            ).focus();
          }}
        >
          {POLLUTANTS.map((c) => (
            <button
              key={c}
              className={code === c ? "selected" : ""}
              role="radio"
              aria-checked={code === c}
              tabIndex={code === c ? 0 : -1}
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
          <div
            className="bar-chart"
            role="group"
            tabIndex={0}
            aria-label={t("air.hourlyTitle", {
              pollutant: pollutantLabel(code),
            })}
          >
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
        {slots.some(Boolean) && (
          <details className="data-table">
            <summary>{t("display.table")}</summary>
            <div className="table-scroll">
              <table>
                <caption>
                  {t("air.hourlyTitle", { pollutant: pollutantLabel(code) })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("chart.col.time")}</th>
                    <th scope="col">
                      {pollutantLabel(code)} {pollutantUnit(code)}
                    </th>
                    <th scope="col">
                      {t("air.legend.observed")} / {t("air.legend.forecast")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slots
                    .filter((v) => v !== null)
                    .map(
                      (v) =>
                        v && (
                          <tr key={v.at}>
                            <th scope="row">
                              {dayLabel(v.at, w.current.at)} {hourText(v.at)}
                            </th>
                            <td>{formatValue(v.value, 1)}</td>
                            <td>
                              {t(
                                v.forecast
                                  ? "air.legend.forecast"
                                  : "air.legend.observed",
                              )}
                            </td>
                          </tr>
                        ),
                    )}
                </tbody>
              </table>
            </div>
          </details>
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

function skyKind(icon: string, at: string) {
  const kind = iconKind(icon);
  if (kind === "lightning") return "thunder";
  if (kind === "rainsnow" || kind === "rain") return "rain";
  if (kind === "snow") return "snow";
  if (kind === "fog" || kind === "dust") return "fog";
  if (kind === "cloud" || kind === "cloud-moon" || kind === "cloud-sun")
    return "cloudy";
  const hour = Number(at.slice(11, 13));
  return kind === "moon" || hour < 6 || hour >= 19
    ? "clear-night"
    : "clear-day";
}
