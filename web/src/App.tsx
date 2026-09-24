import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Routes,
  Route,
  NavLink,
  Link,
  Navigate,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sun,
  Search,
  MapPin,
  Plus,
  LocateFixed,
  ArrowRight,
  CloudSun,
  Wind,
  Map,
  Bell,
  Settings as SettingsIcon,
  HelpCircle,
  Download,
  ChevronRight,
  Trash2,
  Upload,
  ArrowUpRight,
  Check,
  Menu,
  X,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import {
  PLACES,
  UNIT_OPTIONS,
  POLLUTANTS,
  formatValue,
  type Place,
  type Nation,
  type WarningBulletin,
  type Units,
} from "@todayweather/core";
import { AppContext, useApp } from "./context";
import { api, unitQuery, type Capabilities } from "./api";
import {
  defaultState,
  restoreState,
  saveState,
  addPlace,
  removePlace,
  STATE_KEY,
  type SavedState,
} from "./state";
import {
  PageTitle,
  SectionHead,
  WeatherIcon,
  Empty,
  Loading,
  ErrorState,
  Stamp,
  ExternalWeather,
  isOld,
} from "./components";
import WeatherPage, { gradeClass, gradeLabel } from "./Weather";
import Notifications from "./Notifications";
type InstallEvent = Event & { prompt: () => Promise<void> };
function routeFor(state: SavedState, id: string) {
  return state.settings.startup === "locations"
    ? "/locations"
    : state.settings.startup === "air"
      ? `/air/${id}`
      : `/weather/${id}/${state.settings.startup}`;
}
export default function App() {
  const [state, setState] = useState(() => {
      try {
        return restoreState(localStorage);
      } catch {
        return defaultState();
      }
    }),
    [storageOk, setStorageOk] = useState(true),
    [toast, setToast] = useState(""),
    [menuOpen, setMenuOpen] = useState(false),
    [installPrompt, setInstallPrompt] = useState<InstallEvent>(),
    [updateReady, setUpdateReady] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const latestState = useRef(state);
  latestState.current = state;
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const navigate = useNavigate(),
    location = useLocation();
  const caps = useQuery({
    queryKey: ["capabilities"],
    queryFn: ({ signal }) => api<Capabilities>("/capabilities", signal),
    staleTime: 60000,
  });
  useEffect(() => {
    try {
      setStorageOk(saveState(state, localStorage));
    } catch {
      setStorageOk(false);
    }
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state]);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: Event) => {
        e.preventDefault();
        setInstallPrompt(e as InstallEvent);
      },
      online = () => setOffline(!navigator.onLine);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (disposed) return;
        registration.current = reg;
        if (reg.waiting) setUpdateReady(true);
        reg.addEventListener("updatefound", () =>
          reg.installing?.addEventListener("statechange", () => {
            if (reg.waiting && navigator.serviceWorker.controller)
              setUpdateReady(true);
          }),
        );
      })
      .catch(() =>
        setToast(
          "오프라인 기능을 준비하지 못했습니다. 온라인 조회는 계속 이용할 수 있습니다.",
        ),
      );
    const changed = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
    };
  }, []);
  const select = (place: Place) => {
    try {
      const next = addPlace(latestState.current, place);
      latestState.current = next;
      setState(next);
      navigate(routeFor(next, next.selectedId!));
    } catch (error) {
      setToast((error as Error).message);
    }
  };
  const selected = state.places.find((p) => p.id === state.selectedId);
  const navWeather = selected
    ? routeFor(
        { ...state, settings: { ...state.settings, startup: "hourly" } },
        selected.id,
      )
    : "/start";
  return (
    <AppContext.Provider
      value={{
        state,
        setState,
        select,
        notify: setToast,
        capabilities: caps.data,
        storageOk,
        installPrompt,
        updateReady,
        applyUpdate: () =>
          registration.current?.waiting?.postMessage({ type: "SKIP_WAITING" }),
      }}
    >
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <div className="app-shell">
        <aside
          className={`sidebar ${menuOpen ? "open" : ""}`}
          aria-label="주 메뉴"
        >
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Sun size={27} />
            </span>
            <div>
              오늘날씨<small>TODAY WEATHER</small>
            </div>
          </Link>
          <button
            className="mobile-close icon-button"
            aria-label="메뉴 닫기"
            onClick={() => setMenuOpen(false)}
          >
            <X />
          </button>
          <div className="sidebar-label">나의 날씨</div>
          <nav>
            <NavLink
              to={navWeather}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <CloudSun size={19} /> 날씨
            </NavLink>
            <NavLink
              to={selected ? "/air/" + selected.id : "/start"}
              className="nav-item"
            >
              <Wind size={19} /> 미세먼지
            </NavLink>
            <NavLink to="/locations" className="nav-item">
              <MapPin size={19} /> 관심지역
            </NavLink>
            <NavLink to="/nation/weather" className="nav-item">
              <Map size={19} /> 전국 날씨
            </NavLink>
            <NavLink to="/nation/air" className="nav-item">
              <Wind size={19} /> 전국 미세먼지
            </NavLink>
            <NavLink to="/warnings" className="nav-item">
              <Bell size={19} /> 기상 특보
            </NavLink>
          </nav>
          <div className="sidebar-section-title">
            <span className="sidebar-label">저장한 지역</span>
            <Link to="/locations" aria-label="지역 추가">
              <Plus size={16} />
            </Link>
          </div>
          <div className="saved-city-list">
            {state.places.length ? (
              state.places.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  className={selected?.id === p.id ? "active" : ""}
                  onClick={() => select(p)}
                >
                  <span className="city-dot" />
                  {p.name}
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <p>
                자주 찾는 지역을
                <br />
                추가해 보세요.
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <NavLink className="nav-item" to="/settings">
              <SettingsIcon size={19} /> 설정
            </NavLink>
            <NavLink className="nav-item" to="/help">
              <HelpCircle size={19} /> 이용 안내
            </NavLink>
            <div className="install-card">
              <Download size={20} />
              <strong>앱처럼, 더 편하게</strong>
              <p>
                홈 화면에 오늘날씨를
                <br />
                추가해 보세요.
              </p>
              <button
                onClick={() =>
                  installPrompt
                    ? void installPrompt.prompt()
                    : navigate("/help#install")
                }
              >
                설치 안내 <ArrowUpRight size={13} />
              </button>
            </div>
            <span className="version">TodayWeather Web · 0.1</span>
          </div>
        </aside>
        {menuOpen && (
          <button
            className="sidebar-backdrop"
            aria-label="메뉴 닫기"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar">
            <div>
              <button
                className="icon-button mobile-menu"
                aria-label="메뉴 열기"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span className="topbar-label">하루를 준비하는 작은 습관</span>
            </div>
            <Link to="/locations" className="search-link">
              <Search size={17} />
              <span>다른 지역 검색</span>
              <kbd>지역 찾기</kbd>
            </Link>
            <Link
              className="icon-button topbar-settings"
              aria-label="설정"
              to="/settings"
            >
              <SettingsIcon size={18} />
            </Link>
          </header>
          <main id="main-content" tabIndex={-1}>
            {offline && (
              <div className="notice warning" role="status">
                오프라인입니다. 저장된 자료는 최신 정보가 아닐 수 있습니다.
              </div>
            )}
            {!storageOk && (
              <div className="notice warning">
                브라우저 저장소를 사용할 수 없어 이번 접속 동안만 설정이
                유지됩니다.
              </div>
            )}
            {updateReady && (
              <div className="notice update">
                <span>
                  새 버전이 준비됐습니다. 작성 중인 알림 설정을 저장한 뒤
                  업데이트하세요.
                </span>
                <button
                  onClick={() =>
                    registration.current?.waiting?.postMessage({
                      type: "SKIP_WAITING",
                    })
                  }
                >
                  업데이트
                </button>
              </div>
            )}
            <Routes>
              <Route
                path="/"
                element={
                  selected ? (
                    <Navigate replace to={routeFor(state, selected.id)} />
                  ) : (
                    <Welcome />
                  )
                }
              />
              <Route path="/start" element={<Welcome />} />
              <Route path="/locations" element={<Locations />} />
              <Route
                path="/weather/:locationId/:view"
                element={<WeatherPage />}
              />
              <Route
                path="/air/:locationId"
                element={<WeatherPage view="air" />}
              />
              <Route path="/place/:publicId" element={<PublicPlace />} />
              <Route path="/nation/:kind" element={<NationPage />} />
              <Route path="/warnings" element={<Warnings />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route
                path="/notifications/:locationId"
                element={<Notifications />}
              />
              <Route path="/help" element={<Help />} />
              <Route path="/membership" element={<Membership />} />
              <Route
                path="*"
                element={
                  <Empty title="페이지를 찾을 수 없습니다">
                    <Link to="/">처음으로 돌아가기</Link>
                  </Empty>
                }
              />
            </Routes>
          </main>
          <footer className="site-footer">
            <span>오늘을 이해하고, 내일을 준비하세요.</span>
            <span>
              TodayWeather <span aria-hidden="true">↗</span>
            </span>
          </footer>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </AppContext.Provider>
  );
}
function PublicPlace() {
  const { publicId } = useParams();
  const { select } = useApp();
  const p = PLACES.find((p) => p.id === publicId);
  return p ? (
    <>
      <PageTitle
        eyebrow="공유한 지역"
        title={`${p.name}의 날씨`}
        description={p.address}
      />
      <section className="panel">
        <p>관심지역으로 저장하고 시간별 날씨와 미세먼지를 확인하세요.</p>
        <button className="button primary" onClick={() => select(p)}>
          이 지역 날씨 보기 <ArrowRight size={16} />
        </button>
      </section>
    </>
  ) : (
    <Empty title="공유한 지역을 찾을 수 없습니다" />
  );
}
function Welcome() {
  return (
    <>
      <div className="welcome-hero">
        <div className="welcome-kicker">
          <Sun size={16} /> 오늘을 위한 날씨
        </div>
        <h1>
          어제보다 따뜻할까요?
          <br />
          <span>오늘날씨에서 확인하세요.</span>
        </h1>
        <p>
          날씨부터 미세먼지까지, 하루에 필요한 정보를 한곳에서.
          <br />
          자주 찾는 지역을 선택하고 나만의 날씨를 시작하세요.
        </p>
      </div>
      <Locations embedded />
      <div className="welcome-features">
        {[
          [CloudSun, "어제와 비교하는 날씨", "어제보다 얼마나 따뜻한지 한눈에"],
          [Wind, "세심하게 보는 대기질", "미세먼지와 관측소별 정보"],
          [Monitor, "어디서나 편리하게", "모바일과 데스크톱, 같은 경험"],
        ].map(([I, title, body]) => {
          const Icon = I as typeof Sun;
          return (
            <div key={String(title)}>
              <Icon size={26} />
              <h3>{String(title)}</h3>
              <p>{String(body)}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
function Locations({ embedded = false }: { embedded?: boolean }) {
  const { state, setState, select, notify, capabilities } = useApp();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [locating, setLocating] = useState(false),
    [resolving, setResolving] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["places", query],
    queryFn: ({ signal }) =>
      api<{ items: Place[]; canResolve: boolean }>(
        "/locations/search?q=" + encodeURIComponent(query),
        signal,
      ),
    staleTime: 60000,
  });
  async function locate() {
    if (!navigator.geolocation) {
      notify(
        "이 브라우저에서는 위치를 확인할 수 없습니다. 지역을 검색해 주세요.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const p = await api<Place>(
            `/locations/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
          );
          select({ ...p, current: true });
        } catch (e) {
          notify((e as Error).message);
        } finally {
          setLocating(false);
        }
      },
      (e) => {
        setLocating(false);
        notify(
          e.code === 1
            ? "위치 권한이 거부됐습니다. 지역 검색은 계속 이용할 수 있습니다."
            : "위치를 찾지 못했습니다. 지역을 직접 검색해 주세요.",
        );
      },
      { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false },
    );
  }
  async function deletePlace(p: Place) {
    try {
      if (capabilities?.notifications.enabled) {
        const session = await api<{ csrf: string }>(
          "/installations",
          undefined,
          { method: "POST" },
        );
        const rules = await api<{ items: { id: string; place: Place }[] }>(
          "/notification-rules",
        );
        for (const r of rules.items.filter((r) => r.place.id === p.id))
          await api("/notification-rules/" + r.id, undefined, {
            method: "DELETE",
            headers: { "X-CSRF-Token": session.csrf },
          });
      }
      setState((s) => removePlace(s, p.id));
      notify(`${p.name}을 관심지역에서 삭제했습니다.`);
    } catch {
      notify(
        "알림 해제 상태를 확인하지 못했습니다. 연결 후 다시 삭제해 주세요.",
      );
    }
  }
  async function resolve() {
    setResolving(true);
    try {
      select(
        await api<Place>(
          "/locations/resolve?q=" + encodeURIComponent(search.trim()),
        ),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setResolving(false);
    }
  }
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="나의 날씨"
          title="관심지역"
          description="자주 찾는 지역을 저장하고 빠르게 확인하세요."
        />
      )}
      <section className="panel location-search">
        <SectionHead title="어느 지역의 날씨가 궁금하세요?" />
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const term = search.trim().toLocaleLowerCase();
            if (!term) return;
            const match = PLACES.find((p) =>
              `${p.name} ${p.address} ${p.id}`
                .toLocaleLowerCase()
                .includes(term),
            );
            if (match) select(match);
            else if (capabilities?.search.geocode && term.length >= 2)
              void resolve();
            else
              notify(
                "일치하는 추천 지역이 없습니다. 다른 지역명을 입력해 주세요.",
              );
          }}
        >
          <div className="search-field">
            <Search size={20} />
            <input
              aria-label="지역 검색"
              placeholder="도시나 지역 이름을 입력하세요"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                className="icon-button"
                aria-label="검색 지우기"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            className="button location-button"
            type="button"
            disabled={locating}
            onClick={() => void locate()}
          >
            <LocateFixed size={17} />
            {locating ? "위치 확인 중" : "현재 위치"}
          </button>
        </form>
        <div className="city-chips">
          {(results.data?.items ?? PLACES)
            .slice(0, embedded ? 8 : 20)
            .map((p) => (
              <button key={p.id} onClick={() => select(p)}>
                <MapPin size={14} />
                {p.name}
                <Plus size={14} />
              </button>
            ))}
        </div>
        {results.isError && (
          <p role="alert" className="warning-text">
            추천 지역 목록에 연결하지 못했습니다. 아래 기본 지역은 선택할 수
            있습니다.
          </p>
        )}
        {query && results.data?.items.length === 0 && (
          <div className="resolve-search">
            <p>추천 목록에 없는 지역입니다.</p>
            {results.data.canResolve ? (
              <button
                className="button"
                disabled={resolving}
                onClick={() => void resolve()}
              >
                {resolving ? "지역 확인 중…" : `“${search}” 주소 검색`}
              </button>
            ) : (
              <p>예제 모드에서는 추천 지역을 이용해 주세요.</p>
            )}
          </div>
        )}
        <p className="hint">
          위치 정보는 현재 위치 버튼을 누를 때만 요청합니다.
        </p>
      </section>
      {!embedded && (
        <>
          <SectionHead title={`저장한 지역 ${state.places.length}`} />
          <div className="location-grid">
            {state.places.map((p) => (
              <article className="panel location-card" key={p.id}>
                <button
                  className="location-card-main"
                  onClick={() => select(p)}
                >
                  <MapPin size={23} />
                  <h3>{p.name}</h3>
                  <p>
                    {p.current
                      ? "현재 위치로 저장한 지역 · 자동 추적 안 함"
                      : p.address}
                  </p>
                  <span>
                    날씨 보기 <ArrowRight size={15} />
                  </span>
                </button>
                <div className="location-card-actions">
                  <Link
                    aria-label={`${p.name} 알림 설정`}
                    to={"/notifications/" + p.id}
                  >
                    <Bell size={17} />
                  </Link>
                  <button
                    className="icon-button"
                    aria-label={`${p.name} 삭제`}
                    onClick={() => void deletePlace(p)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!state.places.length && (
            <Empty title="저장한 지역이 없습니다">
              위에서 도시를 선택하면 이곳에 저장됩니다.
            </Empty>
          )}
        </>
      )}
    </>
  );
}
const mapPositions: Record<string, [number, number]> = {
  서울: [155, 145],
  인천: [104, 164],
  수원: [178, 194],
  춘천: [242, 116],
  강릉: [336, 174],
  대전: [203, 285],
  청주: [245, 236],
  전주: [172, 371],
  광주: [141, 455],
  대구: [321, 341],
  포항: [400, 296],
  울산: [395, 397],
  부산: [343, 451],
  목포: [80, 502],
  여수: [220, 485],
  안동: [315, 255],
  제주: [88, 604],
  강원: [278, 146],
  경기: [174, 189],
  충북: [254, 242],
  충남: [135, 285],
  경북: [344, 287],
  경남: [285, 448],
  전북: [143, 371],
  전남: [124, 478],
  세종: [180, 248],
};
function NationPage() {
  const { kind } = useParams(),
    air = kind === "air";
  const { state, select } = useApp();
  const [mode, setMode] = useState("temperature"),
    [pollutant, setPollutant] = useState("pm25");
  const q = useQuery({
    queryKey: ["nation", unitQuery(state.settings.units)],
    queryFn: ({ signal }) =>
      api<Nation>("/nation/KR?" + unitQuery(state.settings.units), signal),
    staleTime: 600000,
  });
  const data = q.data;
  const rows = data
    ? air
      ? data.air.map((p) => {
          const m =
            p.station.pollutants[
              pollutant as keyof typeof p.station.pollutants
            ];
          return {
            name: p.name,
            value: formatValue(
              m?.value,
              ["pm25", "pm10"].includes(pollutant) ? 0 : 3,
            ),
            label: m?.label || gradeLabel(m?.grade),
            grade: m?.grade,
            at: p.station.observedAt,
            icon: "",
          };
        })
      : data.weather.map((p) => ({
          name: p.name,
          value:
            mode === "temperature"
              ? `${formatValue(p.current.temperature)}°`
              : mode === "rain"
                ? `${formatValue(p.current.precipitation, 1)} ${data.units.precipitationUnit}`
                : `${formatValue(p.current.wind, 1)} ${data.units.windSpeedUnit}`,
          label: p.current.description,
          at: p.current.at,
          grade: null,
          icon: p.current.icon,
        }))
    : [];
  return (
    <>
      <PageTitle
        eyebrow="대한민국"
        title={air ? "전국 미세먼지" : "전국 날씨"}
        description="지역별 관측 정보를 비교해 보세요."
      />
      <div className="view-tabs">
        {(air
          ? [
              ["pm25", "초미세먼지"],
              ["pm10", "미세먼지"],
              ["o3", "오존"],
              ["no2", "NO₂"],
              ["so2", "SO₂"],
              ["co", "CO"],
            ]
          : [
              ["temperature", "기온"],
              ["rain", "강수"],
              ["wind", "바람"],
            ]
        ).map(([id, label]) => (
          <button
            key={id}
            className={(air ? pollutant : mode) === id ? "active" : ""}
            onClick={() => (air ? setPollutant(id) : setMode(id))}
          >
            {label}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          {data?.mode === "demo" && (
            <div className="notice demo">
              예제 데이터 · 실제 관측 정보가 아닙니다.
            </div>
          )}
          {rows.some((r) => isOld(r.at)) && (
            <div className="notice warning">
              오래된 관측 자료가 포함되어 있습니다. 각 지역의 관측 시각을
              확인하세요.
            </div>
          )}
          <div className="nation-grid">
            <section className="panel map-panel">
              <div className="map-canvas">
                <svg viewBox="0 0 500 670" aria-label="대한민국 지역별 배치도">
                  <path
                    d="M250 40L281 80 297 123 342 156 365 205 397 243 399 293 420 350 400 417 362 457 309 488 272 504 228 482 188 505 169 477 125 515 91 489 112 447 88 408 118 375 99 338 135 304 132 266 107 225 135 188 124 154 163 128 190 88Z"
                    fill="var(--map-fill)"
                    stroke="var(--line)"
                    strokeWidth="2"
                  />
                  <path
                    d="M56 595Q96 566 138 591Q138 619 66 626Z"
                    fill="var(--map-fill)"
                    stroke="var(--line)"
                  />
                  {rows.map((r, i) => {
                    const pos =
                      mapPositions[r.name] ??
                      Object.entries(mapPositions).find(([key]) =>
                        r.name.startsWith(key),
                      )?.[1];
                    return pos ? (
                      <g
                        key={r.name + i}
                        transform={`translate(${pos[0]},${pos[1]})`}
                      >
                        <rect
                          x="-32"
                          y="-21"
                          width="68"
                          height="44"
                          rx="11"
                          fill="var(--panel)"
                          stroke="var(--line)"
                        />
                        <text textAnchor="middle" y="-4" className="map-name">
                          {r.name.slice(0, 3)}
                        </text>
                        <text textAnchor="middle" y="13" className="map-value">
                          {r.value}
                        </text>
                      </g>
                    ) : null;
                  })}
                </svg>
              </div>
              <p className="hint">
                지역 배치도 · 실제 축척이 아닙니다. 전체 수치는 목록에서
                확인하세요.
              </p>
            </section>
            <section className="panel region-list">
              <SectionHead title="지역별 관측" />
              {rows.map((r, i) => (
                <div className="region-row" key={r.name + i}>
                  <div>
                    <strong>{r.name}</strong>
                    <Stamp at={r.at} />
                  </div>
                  {air ? (
                    <span className={"grade " + gradeClass(r.grade)}>
                      {r.label}
                    </span>
                  ) : (
                    <WeatherIcon icon={r.icon} size={24} />
                  )}
                  <b>{r.value}</b>
                  <button
                    aria-label={`${r.name} 날씨 보기`}
                    className="icon-button"
                    onClick={() => {
                      const p = PLACES.find(
                        (p) => p.name === r.name || r.name.startsWith(p.name),
                      );
                      if (p) select(p);
                    }}
                    disabled={
                      !PLACES.some(
                        (p) => p.name === r.name || r.name.startsWith(p.name),
                      )
                    }
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}
function Warnings() {
  const q = useQuery({
    queryKey: ["warnings"],
    queryFn: ({ signal }) =>
      api<{ mode: string; items: WarningBulletin[] }>("/warnings/KR", signal),
    staleTime: 180000,
  });
  return (
    <>
      <PageTitle
        eyebrow="안전한 하루"
        title="기상 특보"
        description="기상청 발표 내용과 발표 시각을 확인하세요."
        action={<ExternalWeather />}
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          {q.data.mode === "demo" && (
            <div className="notice demo">
              예시 특보 · 실제 재난·안전 정보가 아닙니다.
            </div>
          )}
          {q.data.items.length ? (
            q.data.items.map((b) => (
              <article className="panel bulletin" key={b.id}>
                <h2>{b.name}</h2>
                <Stamp at={b.announcement} label="발표" />
                {isOld(b.announcement, 24) && (
                  <p className="warning-text">
                    발표일이 지난 자료입니다. 현재 특보 여부는 기상청에서
                    확인하세요.
                  </p>
                )}
                {b.sections.map((s, i) => (
                  <section key={i}>
                    <h3>{s.title}</h3>
                    {s.details.map((d, j) => (
                      <p key={j}>{d}</p>
                    ))}
                  </section>
                ))}
                <p className="bulletin-text">{b.comment}</p>
                {b.imageUrl && (
                  <a
                    className="text-link"
                    href={b.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    발표 자료 이미지 열기 <ArrowUpRight size={15} />
                  </a>
                )}
              </article>
            ))
          ) : (
            <Empty title="제공된 특보가 없습니다">
              이 화면만으로 현재의 안전을 판단하지 마세요. 최신 발표를 확인해
              주세요.
            </Empty>
          )}
        </>
      )}
    </>
  );
}
const unitLabels: Record<keyof Units, string> = {
  temperatureUnit: "기온",
  windSpeedUnit: "풍속",
  pressureUnit: "기압",
  distanceUnit: "거리",
  precipitationUnit: "강수량",
  airUnit: "대기질 기준",
};
const unitNames: Record<string, string> = {
  airkorea: "한국 대기환경 기준",
  airnow: "미국 EPA",
  aqicn: "중국 기준",
  airkorea_who: "WHO 권고 기준",
  bft: "보퍼트",
  kt: "노트",
};
function SettingsPage() {
  const { state, setState, notify, capabilities } = useApp();
  const upload = useRef<HTMLInputElement>(null);
  const settings = state.settings;
  function exportData() {
    const safe = {
      ...state,
      places: state.places.filter((p) => !p.current),
      selectedId: null,
    };
    const blob = new Blob([JSON.stringify(safe, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "todayweather-locations.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importData(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100000) throw Error("파일이 너무 큽니다.");
      const raw = await file.text(),
        parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.places))
        throw Error("오늘날씨 웹 내보내기 파일을 선택해 주세요.");
      const imported = restoreState({ getItem: () => raw });
      setState(imported);
      notify("관심지역과 설정을 가져왔습니다.");
    } catch (e) {
      notify((e as Error).message);
    }
    if (upload.current) upload.current.value = "";
  }
  return (
    <>
      <PageTitle
        eyebrow="나에게 맞게"
        title="설정"
        description="변경한 설정은 이 브라우저에 바로 저장됩니다."
      />
      <div className="settings-grid">
        <section className="panel">
          <SectionHead title="단위와 대기질 기준" />
          {Object.keys(UNIT_OPTIONS).map((k) => {
            const key = k as keyof Units;
            return (
              <label className="setting-row" key={key}>
                <span>{unitLabels[key]}</span>
                <select
                  value={settings.units[key]}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        units: { ...s.settings.units, [key]: e.target.value },
                      },
                    }))
                  }
                >
                  {UNIT_OPTIONS[key].map((v) => (
                    <option
                      key={v}
                      value={v}
                      disabled={
                        key === "airUnit" &&
                        capabilities?.mode === "demo" &&
                        v !== "airkorea"
                      }
                    >
                      {unitNames[v] ?? v}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {capabilities?.mode === "demo" && (
            <p className="hint">
              예제 자료의 대기질 기준은 한국 기준으로 고정됩니다.
            </p>
          )}
        </section>
        <div>
          <section className="panel">
            <SectionHead title="화면과 업데이트" />
            <label className="setting-row">
              <span>화면 테마</span>
              <select
                value={settings.theme}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    settings: {
                      ...s.settings,
                      theme: e.target.value as typeof settings.theme,
                    },
                  }))
                }
              >
                <option value="light">라이트</option>
                <option value="dark">다크</option>
                <option value="photo">하늘</option>
                <option value="classic">클래식</option>
              </select>
            </label>
            <label className="setting-row">
              <span>시작 화면</span>
              <select
                value={settings.startup}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    settings: {
                      ...s.settings,
                      startup: e.target.value as typeof settings.startup,
                    },
                  }))
                }
              >
                <option value="hourly">시간별 날씨</option>
                <option value="daily">일별 날씨</option>
                <option value="air">미세먼지</option>
                <option value="overview">날씨 한눈에</option>
                <option value="locations">관심지역</option>
              </select>
            </label>
            <label className="setting-row">
              <span>자동 새로고침</span>
              <select
                value={settings.refreshMinutes}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    settings: {
                      ...s.settings,
                      refreshMinutes: +e.target.value,
                    },
                  }))
                }
              >
                {[0, 30, 60, 180, 360, 720].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "수동" : m < 60 ? `${m}분` : `${m / 60}시간`}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              열려 있는 화면에서만 자동 갱신합니다. 돌아왔을 때도 자료의 최신
              여부를 확인합니다.
            </p>
          </section>
          <section className="panel">
            <SectionHead title="관심지역 백업" />
            <p className="muted-text">
              현재 위치와 알림 구독 정보는 내보내기에 포함되지 않습니다.
            </p>
            <div className="button-row">
              <button className="button" onClick={exportData}>
                <Download size={16} /> 내보내기
              </button>
              <button
                className="button"
                onClick={() => upload.current?.click()}
              >
                <Upload size={16} /> 가져오기
              </button>
              <input
                ref={upload}
                type="file"
                hidden
                accept="application/json"
                onChange={(e) => void importData(e.target.files?.[0])}
              />
            </div>
          </section>
        </div>
      </div>
      <section className="panel">
        <SectionHead title="서비스 안내" />
        <div className="button-row">
          <Link className="text-link" to="/help">
            개인정보·데이터 안내 <ChevronRight size={15} />
          </Link>
          <Link className="text-link" to="/membership">
            이용 요금·기존 앱 구매 안내 <ChevronRight size={15} />
          </Link>
          <a
            className="text-link"
            href="https://github.com/WizardFactory/TodayWeather/issues"
            target="_blank"
            rel="noreferrer"
          >
            문제 제보 <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
    </>
  );
}
function Help() {
  return (
    <>
      <PageTitle
        eyebrow="도움이 필요하신가요?"
        title="오늘날씨 이용 안내"
        description="설치 없이 둘러보고, 홈 화면에 추가해 더 편하게 이용하세요."
      />
      <section className="panel prose" id="install">
        <h2>홈 화면에 추가하기</h2>
        <p>
          iPhone과 iPad에서는 브라우저의 공유 메뉴에서 ‘홈 화면에 추가’를
          선택하세요. Android와 데스크톱에서는 브라우저 메뉴의 설치 기능을
          이용할 수 있습니다. 설치 기능이 없는 브라우저에서도 날씨 조회는
          가능합니다.
        </p>
        <h2>현재 위치와 개인정보</h2>
        <p>
          현재 위치 버튼을 눌렀을 때만 위치 권한을 요청합니다. 날씨 조회를 위해
          좌표가 서버에 전달됩니다. 위치 권한을 허용하지 않아도 지역 검색을
          이용할 수 있습니다. 관심지역과 설정은 이 브라우저에 저장되며, 브라우저
          데이터를 지우면 함께 삭제됩니다.
        </p>
        <h2>관측 시각과 오프라인</h2>
        <p>
          화면을 새로고침한 시각과 기상 관측 시각은 다릅니다. 각 항목에 표시한
          관측 시각을 확인하세요. 연결이 끊기면 최대 24시간 이내에 저장한 화면
          자료를 표시할 수 있지만, 현재 날씨나 특보를 보장하지 않습니다.
        </p>
        <h2>알림과 기존 모바일 앱</h2>
        <p>
          웹 알림은 지원 브라우저의 설치·권한 허용과 웹 알림 서버 설정이
          필요합니다. 기기의 절전·네트워크 설정에 따라 늦게 도착할 수 있습니다.
          현재 위치 알림도 마지막으로 저장한 지역을 기준으로 하며 이동을 자동
          추적하지 않습니다.
        </p>
        <p>
          네이티브 위젯·Apple Watch·앱 구매 복원은 기존 모바일 앱에서 이용해
          주세요. 웹 브라우저에서 모바일 앱의 관심지역이나 구매 내역을 자동으로
          읽을 수는 없습니다.
        </p>
        <h2>하늘 테마</h2>
        <p>
          웹의 하늘 테마는 네트워크 사진 서비스에 의존하지 않는 색상 테마입니다.
          기존 앱의 사진 배경과는 다릅니다.
        </p>
        <h2>정보 출처</h2>
        <p>
          국내 날씨는 기존 기상청 연동 서비스, 해외 날씨와 대기질은 기존
          TodayWeather 제공 경로를 사용합니다. 예제 모드는 항상 별도로
          표시합니다. 제공되지 않는 값은 0 대신 ‘—’로 표시합니다.
        </p>
        <ExternalWeather />
        <h2>접근성과 외부 지도</h2>
        <p>
          시간별 그래프 아래 상세 표와 전국 화면의 지역별 목록으로 동일한 수치를
          확인할 수 있습니다. 외부 바람 지도는 별도 서비스입니다.
        </p>
        <a
          href="https://earth.nullschool.net/"
          target="_blank"
          rel="noreferrer"
          className="text-link"
        >
          외부 바람 지도 열기 <ArrowUpRight size={15} />
        </a>
      </section>
    </>
  );
}
function Membership() {
  return (
    <>
      <PageTitle
        title="이용 요금과 구매 안내"
        description="현재 웹 버전은 결제 없이 이용할 수 있습니다."
      />
      <section className="panel prose">
        <ShieldCheck size={36} />
        <h2>웹 결제는 아직 제공하지 않습니다</h2>
        <p>
          기존 iOS·Android 앱의 구매 내역은 이 브라우저에 자동으로 이전되지
          않습니다. 구매 복원과 유료 기능은 구매한 모바일 앱에서 확인해 주세요.
        </p>
        <p>
          웹 유료 상품이나 계정 연동이 도입되면 요금과 제공 범위를 먼저
          안내하겠습니다.
        </p>
      </section>
    </>
  );
}
