import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
import { fetchWeather } from "./api";
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
} from "./components";
const pollutantLabels: Record<Pollutant, string> = {
  aqi: "통합대기지수",
  pm25: "초미세먼지",
  pm10: "미세먼지",
  o3: "오존",
  no2: "이산화질소",
  so2: "아황산가스",
  co: "일산화탄소",
};
export function gradeLabel(grade: number | null) {
  return grade === 1
    ? "좋음"
    : grade === 2
      ? "보통"
      : grade === 3
        ? "나쁨"
        : grade !== null && grade >= 4
          ? "매우 나쁨"
          : "정보 없음";
}
export function gradeClass(grade: number | null) {
  return grade === 1
    ? "good"
    : grade === 2
      ? "moderate"
      : grade === 3
        ? "poor"
        : grade !== null && grade >= 4
          ? "bad"
          : "unknown";
}
export default function WeatherPage({ view: fixedView }: { view?: string }) {
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
  const query = useQuery({
    queryKey: ["weather", place ? weatherKey(place, units) : "none"],
    queryFn: ({ signal }) => fetchWeather(place!, units, signal),
    enabled: !!place,
    staleTime: 600000,
    refetchOnWindowFocus: true,
    refetchInterval: state.settings.refreshMinutes
      ? state.settings.refreshMinutes * 60000
      : false,
    refetchIntervalInBackground: false,
  });
  if (!place)
    return (
      <Empty title="먼저 지역을 선택해 주세요">
        <Link to="/locations">관심지역 관리로 이동</Link>
      </Empty>
    );
  const data = query.data?.weather;
  async function share() {
    const publicPlace = PLACES.find(
      (p) =>
        p.id === place!.id ||
        (Math.abs(p.lat - place!.lat) < 0.04 &&
          Math.abs(p.lon - place!.lon) < 0.04),
    );
    if (!publicPlace) {
      notify("정확한 현재 위치 대신 추천 도시를 선택한 뒤 공유해 주세요.");
      return;
    }
    const url = new URL("/place/" + publicPlace.id, location.origin).href;
    try {
      if (navigator.share)
        await navigator.share({ title: `${publicPlace.name} · 오늘날씨`, url });
      else {
        await navigator.clipboard.writeText(url);
        notify("지역 링크를 복사했습니다.");
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError")
        notify("주소창의 지역 링크를 복사해 주세요.");
    }
  }
  return (
    <>
      <div className="weather-page-head">
        <div>
          <div className="eyebrow">
            <MapPin size={13} />{" "}
            {place.country === "KR" ? "대한민국" : place.country} ·{" "}
            {place.address}
          </div>
          <h1>
            {data?.location.name || place.name}
            <span className="live-dot" />
          </h1>
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            aria-label="날씨 새로고침"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={18} className={query.isFetching ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            aria-label="지역 공유"
            onClick={share}
          >
            <Share2 size={18} />
          </button>
          <Link
            className="icon-button"
            aria-label="지역 알림 설정"
            to={"/notifications/" + place.id}
          >
            <Bell size={18} />
          </Link>
        </div>
      </div>
      <nav className="view-tabs" aria-label="날씨 화면">
        {[
          ["hourly", "시간별"],
          ["daily", "일별"],
          ["air", "미세먼지"],
          ["overview", "한눈에"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() =>
              navigate(
                id === "air"
                  ? `/air/${place.id}`
                  : `/weather/${place.id}/${id}`,
              )
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {query.isPending ? (
        <Loading />
      ) : query.isError && !data ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : data ? (
        <>
          <DataNotice weather={data} snapshot={query.data!.snapshot} />
          {view === "air" ? (
            <AirDetails weather={data} />
          ) : (
            <WeatherDetails weather={data} view={view} />
          )}
          <footer className="data-footer">
            <span>
              제공 {data.source === "KMA" ? "기상청 (KMA)" : "해외 날씨 (DSF)"}{" "}
              · 요청 단위 °{data.units.temperatureUnit}
            </span>
            <Stamp at={data.observedAt} />
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
  const t = w.current,
    delta =
      t.temperature !== null &&
      w.yesterday?.temperature !== null &&
      w.yesterday?.temperature !== undefined
        ? t.temperature - w.yesterday.temperature
        : null;
  const today = w.daily.find((p) => p.at.slice(0, 10) === t.at.slice(0, 10));
  const hourly = w.hourly.filter((p) => p.at >= t.at).slice(0, 16);
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
  return (
    <>
      <div className="overview-grid">
        <section className="hero-card">
          <div className="hero-top">
            <span className="pill">현재 날씨</span>
            <span>
              {dayLabel(t.at)} · {t.at.slice(11)}
            </span>
          </div>
          <div className="hero-weather">
            <div>
              <div className="temperature">
                {formatValue(t.temperature)}
                <span>°{w.units.temperatureUnit}</span>
              </div>
              <h2>{t.description || "현재 기상 관측"}</h2>
            </div>
            <WeatherIcon icon={t.icon} size={110} />
          </div>
          <div className="hero-bottom">
            <span>
              {delta === null
                ? "어제 비교 자료 없음"
                : delta > 0
                  ? `어제보다 ${formatValue(delta, 1)}° 높아요`
                  : delta < 0
                    ? `어제보다 ${formatValue(-delta, 1)}° 낮아요`
                    : "어제와 기온이 같아요"}
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
            title="지금 대기질"
            aside={
              <Link aria-label="대기질 자세히" to={"/air/" + w.location.id}>
                <ArrowUpRight size={18} />
              </Link>
            }
          />
          {air ? (
            <>
              <div
                className={`air-orb ${gradeClass(air.pollutants.aqi.grade)}`}
              >
                <strong>{formatValue(air.pollutants.aqi.value)}</strong>
                <span>
                  {air.pollutants.aqi.label ||
                    gradeLabel(air.pollutants.aqi.grade)}
                </span>
              </div>
              <div className="air-small-values">
                <span>
                  미세먼지 <b>{formatValue(air.pollutants.pm10.value)}</b>
                </span>
                <span>
                  초미세먼지 <b>{formatValue(air.pollutants.pm25.value)}</b>
                </span>
              </div>
              <Stamp at={air.observedAt} />
              {isOld(air.observedAt) && (
                <p className="warning-text">오래된 관측 자료</p>
              )}
            </>
          ) : (
            <Empty title="관측 자료 없음">
              기온 정보는 계속 확인할 수 있어요.
            </Empty>
          )}
        </section>
      </div>
      <div className="metrics-grid">
        {[
          [Droplets, "습도", `${formatValue(t.humidity)}%`],
          [Wind, "바람", `${formatValue(t.wind, 1)} ${w.units.windSpeedUnit}`],
          [Thermometer, "체감기온", `${formatValue(t.feelsLike)}°`],
          [
            CloudRainIcon,
            "강수량",
            `${formatValue(t.precipitation, 1)} ${w.units.precipitationUnit}`,
          ],
        ].map(([Icon, label, value]) => {
          const I = Icon as typeof Droplets;
          return (
            <div className="metric panel" key={String(label)}>
              <I size={20} />
              <div>
                <span>
                  {String(label)}
                  {label === "강수량" ? ` · ${t.precipitationHours}시간` : ""}
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
            title="시간별 예보"
            aside={
              <div className="chart-legend">
                <span>
                  <i />
                  예보
                </span>
                <span>
                  <i className="muted" />
                  어제
                </span>
              </div>
            }
          />
          <TemperatureChart
            points={hourly}
            yesterday={previous}
            unit={w.units.temperatureUnit}
          />
        </section>
      )}
      {(view === "daily" || view === "overview") && (
        <DailyForecast weather={w} />
      )}
      <section className="panel details-panel">
        <SectionHead title="날씨 자세히" />
        <div className="detail-grid">
          {[
            [
              Gauge,
              "기압",
              `${formatValue(t.pressure, 1)} ${w.units.pressureUnit}`,
            ],
            [
              Eye,
              "가시거리",
              `${formatValue(t.visibility, 1)} ${w.units.distanceUnit}`,
            ],
            [Sun, "일출", today?.sunrise || t.sunrise || "정보 없음"],
            [MoonIcon, "일몰", today?.sunset || t.sunset || "정보 없음"],
          ].map(([Icon, label, value]) => {
            const I = Icon as typeof Gauge;
            return (
              <div key={String(label)}>
                <I size={18} />
                <span>{String(label)}</span>
                <b>{String(value)}</b>
              </div>
            );
          })}
        </div>
      </section>
      {w.notices.length > 0 && (
        <div className="source-notes">
          {w.notices.map((n) => (
            <p key={n}>{n}</p>
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
        title="일별 예보"
        aside={<span className="muted-text">최저 / 최고 기온</span>}
      />
      {!w.daily.length ? (
        <Empty title="일별 예보가 없습니다" />
      ) : (
        <div className="daily-list">
          {w.daily.slice(0, 14).map((p) => (
            <div className="daily-row" key={p.at}>
              <span>{dayLabel(p.at)}</span>
              <div className="daily-icons">
                <WeatherIcon icon={p.icon} size={27} />
                <WeatherIcon icon={p.iconPm || p.icon} size={27} />
              </div>
              <span className="rain-label">
                {formatValue(p.rainProbability)}%
              </span>
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
function AirDetails({ weather: w }: { weather: Weather }) {
  const [stationIndex, setStationIndex] = useState(0),
    [code, setCode] = useState<Pollutant>("aqi");
  const station = w.air[stationIndex] ?? w.air[0];
  if (!station)
    return (
      <section className="panel">
        <Empty title="대기질 관측 자료가 없습니다">
          이 지역에 대한 관측 자료가 도착하면 표시됩니다. 날씨 탭에서 기상
          예보를 확인해 주세요.
        </Empty>
      </section>
    );
  const p = station.pollutants[code],
    max = Math.max(1, ...p.hourly.map((v) => v.value ?? 0));
  return (
    <>
      <section className="panel air-detail">
        <div className="section-head">
          <h2>대기질 관측</h2>
          <label className="station-select">
            관측소{" "}
            <select
              value={stationIndex}
              onChange={(e) => setStationIndex(Number(e.target.value))}
            >
              {w.air.map((s, i) => (
                <option key={i} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="air-detail-main">
          <div className={`air-orb large ${gradeClass(p.grade)}`}>
            <span>{pollutantLabels[code]}</span>
            <strong>
              {formatValue(
                p.value,
                code === "aqi" || code === "pm25" || code === "pm10" ? 0 : 3,
              )}
            </strong>
            <span>{p.label || gradeLabel(p.grade)}</span>
          </div>
          <div>
            <span className="eyebrow">{w.units.airUnit} 기준</span>
            <h2>{p.label || gradeLabel(p.grade)}</h2>
            <p>
              {p.guide ||
                "관측 자료와 기상청·환경부 안내를 함께 확인해 주세요."}
            </p>
            <Stamp at={station.observedAt} />
            {isOld(station.observedAt) && (
              <p className="warning-text">최신 관측 자료가 아닙니다.</p>
            )}
          </div>
        </div>
        <div className="pollutant-grid">
          {POLLUTANTS.map((c) => (
            <button
              key={c}
              className={code === c ? "selected" : ""}
              onClick={() => setCode(c)}
            >
              <span>{pollutantLabels[c]}</span>
              <strong>
                {formatValue(
                  station.pollutants[c].value,
                  ["aqi", "pm25", "pm10"].includes(c) ? 0 : 3,
                )}
              </strong>
              <small
                className={"grade " + gradeClass(station.pollutants[c].grade)}
              >
                {station.pollutants[c].label ||
                  gradeLabel(station.pollutants[c].grade)}
              </small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <SectionHead title={`${pollutantLabels[code]} 시간별 변화`} />
        {p.hourly.length ? (
          <div className="bar-chart">
            {p.hourly.slice(0, 24).map((v, i) => (
              <div key={i} title={`${v.at} ${formatValue(v.value, 2)}`}>
                <span>{formatValue(v.value, 1)}</span>
                <i
                  className={gradeClass(v.grade)}
                  style={{ height: Math.max(3, ((v.value ?? 0) / max) * 120) }}
                />
                <small>{v.at.slice(-5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="시간별 대기질 자료가 없습니다" />
        )}
        {p.daily.length > 0 && (
          <div className="daily-air">
            {p.daily.map((v, i) => (
              <div key={i}>
                <span>{v.at}</span>
                <strong>{v.label || gradeLabel(v.grade)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
