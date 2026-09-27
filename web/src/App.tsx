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
  useNavigationType,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { api, readStoredWeather, unitQuery, type Capabilities } from "./api";
import {
  defaultState,
  restoreState,
  saveState,
  addPlace,
  removePlace,
  clearLocalData,
  deleteSnapshotsFor,
  pruneSnapshots,
  weatherKey,
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
  Lines,
  isOld,
  kstTime,
} from "./components";
import WeatherPage from "./Weather";
import {
  airDisclaimer,
  airSource,
  forecastDescription,
  gradeClass,
  gradeLabel,
  pollutantUnit,
  standardName,
} from "./air";
import { amount, matchPlace, windText } from "./format";
import Notifications from "./Notifications";
import {
  detectLanguage,
  isLanguage,
  language,
  LANGUAGE_NAMES,
  LANGUAGES,
  setLanguage,
  coreText,
  t,
  useLanguage,
  type MessageKey,
} from "./i18n";
import { placeArea, placeName } from "./places";
type InstallEvent = Event & { prompt: () => Promise<void> };
const UPDATE_REQUESTED = "tw.web.v1.update-requested";
// Matches web/public/theme.js and the --bg of each theme in style.css.
const THEME_COLORS: Record<SavedState["settings"]["theme"], string> = {
  light: "#f5f7fb",
  dark: "#111c2b",
  photo: "#edf4fb",
  classic: "#f3f7f5",
};
/** Start-screen route for `/`; `locations` applies only there. */
function routeFor(state: SavedState, id: string) {
  return state.settings.startup === "locations"
    ? "/locations"
    : weatherRoute(state, id);
}
/** Selecting a place always opens its weather in the preferred view. */
function weatherRoute(state: SavedState, id: string) {
  const view = state.settings.startup;
  return view === "air"
    ? `/air/${id}`
    : `/weather/${id}/${view === "locations" ? "hourly" : view}`;
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
    [updateApplied, setUpdateApplied] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const latestState = useRef(state);
  latestState.current = state;
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  // Narrow layouts show the sidebar as an off-canvas menu.
  const [compact, setCompact] = useState(
    () => window.matchMedia?.("(max-width: 680px)").matches ?? false,
  );
  const sidebarRef = useRef<HTMLElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    mainRef = useRef<HTMLElement>(null),
    firstRoute = useRef(true),
    returnFocus = useRef(false),
    focusMain = useRef(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 680px)");
    if (!query) return;
    const update = () => {
      setCompact(query.matches);
      // Leaving the narrow layout closes the off-canvas menu.
      if (!query.matches) setMenuOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      returnFocus.current = true;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => {
    // Return focus only after the render that removed `inert` from the page.
    if (!menuOpen && returnFocus.current) {
      returnFocus.current = false;
      menuButton.current?.focus();
    }
  }, [menuOpen]);
  const navigate = useNavigate(),
    location = useLocation(),
    navigationType = useNavigationType();
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
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[state.settings.theme]);
  }, [state]);
  // The chosen language (or the browser's) drives every text and request.
  useLanguage();
  const wantedLanguage =
    state.settings.language ?? detectLanguage(navigator.languages ?? []);
  useEffect(() => {
    if (wantedLanguage !== language())
      // A language chunk that cannot load (offline before it was cached)
      // keeps the current language.
      setLanguage(wantedLanguage).catch(() => setToast(t("error.connect")));
  }, [wantedLanguage]);
  useEffect(() => {
    // Another tab changed favorites or settings: adopt the stored state.
    const changed = (e: StorageEvent) => {
      if (e.key !== STATE_KEY && e.key !== null) return;
      try {
        setState(restoreState(localStorage));
      } catch {
        /* Keep the in-memory state. */
      }
    };
    window.addEventListener("storage", changed);
    void pruneSnapshots();
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
    // Move focus to the new page so screen readers announce it, except for
    // in-page tab switches that keep focus on the pressed tab. History
    // restores that state on Back/Forward, where the page must be announced.
    const keep =
      navigationType !== "POP" &&
      (location.state as { keepFocus?: boolean } | null)?.keepFocus;
    if (firstRoute.current) firstRoute.current = false;
    else if (!keep) focusMain.current = true;
  }, [location.pathname]);
  useEffect(() => {
    // Wait for the render that removed `inert` after closing the menu.
    if (focusMain.current && !menuOpen) {
      focusMain.current = false;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [location.pathname, menuOpen]);
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
      online = () => {
        setOffline(!navigator.onLine);
        // A page loaded offline thinks it is online already, so reconnecting
        // does not refetch by itself: refresh anything shown from a snapshot,
        // except responses still waiting out a rate limit.
        if (navigator.onLine)
          void queryClient.refetchQueries({
            type: "active",
            predicate: (q) => {
              const data = q.state.data as
                { snapshot?: boolean; retryAt?: number } | undefined;
              return data?.snapshot === true && !(data.retryAt! > Date.now());
            },
          });
      };
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
    try {
      // A request from before this page load must not reload it later.
      sessionStorage.removeItem(UPDATE_REQUESTED);
    } catch {
      /* Unavailable storage never holds a request. */
    }
    let disposed = false,
      updateTimer: ReturnType<typeof setInterval> | undefined,
      onVisible: (() => void) | undefined;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (disposed) return;
        registration.current = reg;
        if (reg.waiting) setUpdateReady(true);
        // Long-open tabs look for new releases hourly and when shown again.
        const check = () => void reg.update().catch(() => undefined);
        updateTimer = setInterval(check, 3600000);
        onVisible = () => {
          if (document.visibilityState === "visible") check();
        };
        document.addEventListener("visibilitychange", onVisible);
        reg.addEventListener("updatefound", () =>
          reg.installing?.addEventListener("statechange", () => {
            if (reg.waiting && navigator.serviceWorker.controller)
              setUpdateReady(true);
          }),
        );
      })
      .catch(() => setToast(t("toast.offlineSetupFailed")));
    let controlled = navigator.serviceWorker.controller !== null;
    const changed = () => {
      // Only the tab that pressed "업데이트" reloads; others are told. The
      // request is consumed even by a page that had no controller yet.
      let requested = false;
      try {
        requested = !!sessionStorage.getItem(UPDATE_REQUESTED);
        sessionStorage.removeItem(UPDATE_REQUESTED);
      } catch {
        /* Unavailable storage: treat as another tab. */
      }
      if (requested) {
        window.location.reload();
        return;
      }
      // The offered worker is now active; only a newer one is still waiting.
      setUpdateReady(!!registration.current?.waiting);
      if (controlled) setUpdateApplied(true);
      controlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () => {
      disposed = true;
      clearInterval(updateTimer);
      if (onVisible)
        document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
    };
  }, []);
  const applyUpdate = () => {
    const waiting = registration.current?.waiting;
    if (!waiting) {
      // Another tab already applied it; nothing is left to activate here.
      setUpdateReady(false);
      return;
    }
    try {
      sessionStorage.setItem(UPDATE_REQUESTED, "1");
    } catch {
      /* Without sessionStorage this tab simply shows the applied notice. */
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
  const select = (place: Place) => {
    const before = latestState.current;
    try {
      const next = addPlace(before, place);
      latestState.current = next;
      setState(next);
      // A replaced current-location entry must not leave its weather behind.
      for (const old of before.places)
        if (!next.places.some((p) => p.id === old.id))
          void deleteSnapshotsFor(old.id);
      navigate(weatherRoute(next, next.selectedId!));
    } catch {
      // Full list: show the place without saving it.
      navigate(weatherRoute(before, place.id));
      setToast(t("toast.listFull"));
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
        applyUpdate,
      }}
    >
      <a className="skip-link" href="#main-content">
        {t("shell.skipToContent")}
      </a>
      <div className="app-shell">
        <aside
          ref={sidebarRef}
          className={`sidebar ${menuOpen ? "open" : ""}`}
          inert={compact && !menuOpen ? true : undefined}
          aria-label={t("shell.mainMenu")}
        >
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Sun size={27} />
            </span>
            <div>
              {t("app.name")}
              <small>TODAY WEATHER</small>
            </div>
          </Link>
          <button
            className="mobile-close icon-button"
            aria-label={t("shell.closeMenu")}
            onClick={() => {
              returnFocus.current = true;
              setMenuOpen(false);
            }}
          >
            <X />
          </button>
          <div className="sidebar-label">{t("shell.myWeather")}</div>
          <nav>
            <NavLink
              to={navWeather}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <CloudSun size={19} /> {t("nav.weather")}
            </NavLink>
            <NavLink
              to={selected ? "/air/" + selected.id : "/start"}
              className="nav-item"
            >
              <Wind size={19} /> {t("nav.air")}
            </NavLink>
            <NavLink to="/locations" className="nav-item">
              <MapPin size={19} /> {t("nav.locations")}
            </NavLink>
            <NavLink to="/nation/weather" className="nav-item">
              <Map size={19} /> {t("nav.nationWeather")}
            </NavLink>
            <NavLink to="/nation/air" className="nav-item">
              <Wind size={19} /> {t("nav.nationAir")}
            </NavLink>
            <NavLink to="/warnings" className="nav-item">
              <Bell size={19} /> {t("nav.warnings")}
            </NavLink>
          </nav>
          <div className="sidebar-section-title">
            <span className="sidebar-label">{t("sidebar.saved")}</span>
            <Link to="/locations" aria-label={t("sidebar.addPlace")}>
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
                  {placeName(p)}
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <p>
                <Lines text={t("sidebar.empty")} />
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <NavLink className="nav-item" to="/settings">
              <SettingsIcon size={19} /> {t("nav.settings")}
            </NavLink>
            <NavLink className="nav-item" to="/help">
              <HelpCircle size={19} /> {t("nav.help")}
            </NavLink>
            <div className="install-card">
              <Download size={20} />
              <strong>{t("install.title")}</strong>
              <p>
                <Lines text={t("install.body")} />
              </p>
              <button
                onClick={() =>
                  installPrompt
                    ? void installPrompt.prompt()
                    : navigate("/help#install")
                }
              >
                {t("install.button")} <ArrowUpRight size={13} />
              </button>
            </div>
            <span className="version">TodayWeather Web · 0.1</span>
          </div>
        </aside>
        {menuOpen && (
          <button
            className="sidebar-backdrop"
            aria-label={t("shell.closeMenu")}
            onClick={() => {
              returnFocus.current = true;
              setMenuOpen(false);
            }}
          />
        )}
        <div
          className="workspace"
          inert={compact && menuOpen ? true : undefined}
        >
          <header className="topbar">
            <div>
              <button
                ref={menuButton}
                className="icon-button mobile-menu"
                aria-label={t("shell.openMenu")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span className="topbar-label">{t("topbar.tagline")}</span>
            </div>
            <Link to="/locations" className="search-link">
              <Search size={17} />
              <span>{t("topbar.search")}</span>
              <kbd>{t("topbar.searchKey")}</kbd>
            </Link>
            <Link
              className="icon-button topbar-settings"
              aria-label={t("nav.settings")}
              to="/settings"
            >
              <SettingsIcon size={18} />
            </Link>
          </header>
          <main id="main-content" tabIndex={-1} ref={mainRef}>
            {offline && (
              <div className="notice warning" role="status">
                {t("status.offline")}
              </div>
            )}
            {!storageOk && (
              <div className="notice warning">
                {t("status.storageUnavailable")}
              </div>
            )}
            {updateReady && (
              <div className="notice update">
                <span>{t("update.ready")}</span>
                <button onClick={applyUpdate}>{t("update.apply")}</button>
              </div>
            )}
            {updateApplied && (
              <div className="notice update">
                <span>{t("update.applied")}</span>
                <button onClick={() => window.location.reload()}>
                  {t("update.reload")}
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
                  <Empty title={t("notFound.title")}>
                    <Link to="/">{t("notFound.home")}</Link>
                  </Empty>
                }
              />
            </Routes>
          </main>
          <footer className="site-footer">
            <span>{t("footer.tagline")}</span>
            <span>
              TodayWeather <span aria-hidden="true">↗</span>
            </span>
          </footer>
        </div>
      </div>
      {/* A persistent live region is announced reliably; its content changes. */}
      <div id="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <Check size={16} />
            {toast}
          </div>
        )}
      </div>
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
        eyebrow={t("public.eyebrow")}
        title={t("public.title", { name: placeName(p) })}
        description={placeArea(p)}
      />
      <section className="panel">
        <p>{t("public.body")}</p>
        <button className="button primary" onClick={() => select(p)}>
          {t("public.open")} <ArrowRight size={16} />
        </button>
      </section>
    </>
  ) : (
    <Empty title={t("public.notFound")} />
  );
}
function Welcome() {
  return (
    <>
      <div className="welcome-hero">
        <div className="welcome-kicker">
          <Sun size={16} /> {t("welcome.kicker")}
        </div>
        <h1>
          {t("welcome.headline")}
          <br />
          <span>{t("welcome.headlineAccent")}</span>
        </h1>
        <p>
          {t("welcome.intro")}
          <br />
          {t("welcome.introStart")}
        </p>
      </div>
      <Locations embedded />
      <div className="welcome-features">
        {(
          [
            [CloudSun, "compare"],
            [Wind, "air"],
            [Monitor, "anywhere"],
          ] as const
        ).map(([Icon, id]) => (
          <div key={id}>
            <Icon size={26} />
            <h3>{t(`welcome.feature.${id}.title`)}</h3>
            <p>{t(`welcome.feature.${id}.body`)}</p>
          </div>
        ))}
      </div>
    </>
  );
}
function Locations({ embedded = false }: { embedded?: boolean }) {
  const { state, setState, select, notify, capabilities } = useApp();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [locating, setLocating] = useState(false),
    [resolving, setResolving] = useState(false),
    [permissionDenied, setPermissionDenied] = useState(false);
  // Only the newest location request may navigate; unmount cancels it.
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => () => lookup.current?.abort(), []);
  const begin = () => {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    return controller;
  };
  const current = (c: AbortController) =>
    lookup.current === c && !c.signal.aborted;
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["places", query, language()],
    queryFn: ({ signal }) =>
      api<{ items: Place[]; canResolve: boolean }>(
        "/locations/search?q=" + encodeURIComponent(query),
        signal,
      ),
    staleTime: 60000,
  });
  async function locate() {
    if (!navigator.geolocation) {
      notify(t("locations.locateUnsupported"));
      return;
    }
    const controller = begin();
    setLocating(true);
    setPermissionDenied(false);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const p = await api<Place>(
            `/locations/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
            controller.signal,
          );
          if (current(controller)) select({ ...p, current: true });
        } catch (e) {
          if (current(controller)) notify((e as Error).message);
        } finally {
          if (current(controller)) setLocating(false);
        }
      },
      (e) => {
        if (!current(controller)) return;
        setLocating(false);
        if (e.code === 1) setPermissionDenied(true);
        else notify(t("locations.locateFailed"));
      },
      { timeout: 15000, maximumAge: 0, enableHighAccuracy: false },
    );
  }
  function deletePlace(p: Place) {
    setState((s) => removePlace(s, p.id));
    void deleteSnapshotsFor(p.id);
    notify(t("locations.deleted", { name: placeName(p) }));
  }
  async function resolve() {
    const controller = begin();
    setResolving(true);
    try {
      const place = await api<Place>(
        "/locations/resolve?q=" + encodeURIComponent(search.trim()),
        controller.signal,
      );
      if (current(controller)) select(place);
    } catch (e) {
      if (current(controller)) notify((e as Error).message);
    } finally {
      if (current(controller)) setResolving(false);
    }
  }
  const choose = (p: Place) => {
    lookup.current?.abort();
    setLocating(false);
    setResolving(false);
    select(p);
  };
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow={t("shell.myWeather")}
          title={t("nav.locations")}
          description={t("locations.description")}
        />
      )}
      <section className="panel location-search">
        <SectionHead title={t("locations.search.title")} />
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const term = search.trim().toLocaleLowerCase();
            if (!term) return;
            const match = matchPlace(term, PLACES);
            if (match) choose(match);
            else if (capabilities?.search.geocode && term.length >= 2)
              void resolve();
            else notify(t("locations.search.noMatch"));
          }}
        >
          <div className="search-field">
            <Search size={20} />
            <input
              aria-label={t("locations.search.label")}
              placeholder={t("locations.search.placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                className="icon-button"
                aria-label={t("locations.search.clear")}
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
            {locating ? t("locations.locating") : t("locations.locate")}
          </button>
        </form>
        <div className="city-chips">
          {(results.data?.items ?? PLACES)
            .slice(0, embedded ? 8 : 20)
            .map((p) => (
              <button key={p.id} onClick={() => choose(p)}>
                <MapPin size={14} />
                {placeName(p)}
                <Plus size={14} />
              </button>
            ))}
        </div>
        {results.isError && (
          <p role="alert" className="warning-text">
            {t("locations.search.failed")}
          </p>
        )}
        {query && results.data?.items.length === 0 && (
          <div className="resolve-search">
            <p>{t("locations.search.notListed")}</p>
            {results.data.canResolve ? (
              <button
                className="button"
                disabled={resolving}
                onClick={() => void resolve()}
              >
                {resolving
                  ? t("locations.search.resolving")
                  : t("locations.search.resolve", { query: search })}
              </button>
            ) : (
              <p>{t("locations.search.demo")}</p>
            )}
          </div>
        )}
        <p className="hint">{t("locations.locateHint")}</p>
        {permissionDenied && (
          <div className="permission-help" role="alert">
            <p>{t("locations.permissionDenied")}</p>
            <button className="button" onClick={() => void locate()}>
              <LocateFixed size={16} /> {t("common.retry")}
            </button>
          </div>
        )}
      </section>
      {!embedded && (
        <>
          <SectionHead
            title={t("locations.savedCount", { count: state.places.length })}
          />
          <div className="location-grid">
            {state.places.map((p) => (
              <article className="panel location-card" key={p.id}>
                <button
                  className="location-card-main"
                  onClick={() => choose(p)}
                >
                  <MapPin size={23} />
                  <h3>{placeName(p)}</h3>
                  <p>
                    {p.current ? t("locations.currentPlace") : placeArea(p)}
                  </p>
                  <PlacePreview place={p} />
                  <span>
                    {t("common.viewWeather")} <ArrowRight size={15} />
                  </span>
                </button>
                <div className="location-card-actions">
                  <Link
                    aria-label={t("locations.notificationsFor", {
                      name: placeName(p),
                    })}
                    to={"/notifications/" + p.id}
                  >
                    <Bell size={17} />
                  </Link>
                  <button
                    className="icon-button"
                    aria-label={t("locations.delete", { name: placeName(p) })}
                    onClick={() => void deletePlace(p)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!state.places.length && (
            <Empty title={t("locations.empty.title")}>
              {t("locations.empty.body")}
            </Empty>
          )}
        </>
      )}
    </>
  );
}
/** Preview from the stored snapshot only; never triggers a network request. */
function PlacePreview({ place }: { place: Place }) {
  const { state } = useApp();
  const key = weatherKey(place, state.settings.units);
  const stored = useQuery({
    queryKey: ["stored-weather", key],
    queryFn: () => readStoredWeather(key),
    staleTime: 60000,
  });
  const w = stored.data;
  if (!w) return null;
  const aqi = w.air[0]?.pollutants.aqi;
  return (
    <span className="location-preview">
      <WeatherIcon icon={w.current.icon} size={24} />
      <strong>
        {formatValue(w.current.temperature)}°{w.units.temperatureUnit}
      </strong>
      {aqi && (
        <b className={"grade " + gradeClass(w.units.airUnit, aqi.grade)}>
          {aqi.label || gradeLabel(w.units.airUnit, aqi.grade)}
        </b>
      )}
      <small>
        {t("locations.previewSaved", { time: kstTime(w.fetchedAt) })}
      </small>
    </span>
  );
}
// Marker centres in the 500x670 map. Markers are 68x44 (weather adds an icon
// above-right); the cities of one view and the provinces of the other must
// not overlap.
// Region label keys for the map markers (server names are Korean).
const regionKeys: Record<string, MessageKey> = {
  서울: "city.seoul",
  인천: "city.incheon",
  수원: "city.suwon",
  춘천: "city.chuncheon",
  강릉: "city.gangneung",
  대전: "city.daejeon",
  청주: "city.cheongju",
  전주: "city.jeonju",
  광주: "city.gwangju",
  대구: "city.daegu",
  포항: "city.pohang",
  울산: "city.ulsan",
  부산: "city.busan",
  목포: "city.mokpo",
  여수: "city.yeosu",
  안동: "city.andong",
  제주: "city.jeju",
  강원: "region.gangwon",
  경기: "region.gyeonggi",
  충북: "region.chungbuk",
  충남: "region.chungnam",
  경북: "region.gyeongbuk",
  경남: "region.gyeongnam",
  전북: "region.jeonbuk",
  전남: "region.jeonnam",
  세종: "region.sejong",
};
const mapPositions: Record<string, [number, number]> = {
  서울: [150, 138],
  인천: [70, 182],
  수원: [178, 194],
  춘천: [242, 116],
  강릉: [336, 174],
  대전: [210, 318],
  청주: [245, 236],
  전주: [160, 384],
  광주: [150, 446],
  대구: [321, 341],
  포항: [400, 296],
  울산: [398, 400],
  부산: [350, 470],
  목포: [72, 506],
  여수: [222, 494],
  안동: [322, 262],
  제주: [88, 604],
  강원: [278, 146],
  경기: [176, 196],
  충북: [262, 236],
  충남: [100, 290],
  경북: [344, 287],
  경남: [270, 452],
  전북: [143, 371],
  전남: [112, 506],
  세종: [178, 262],
};
function NationPage() {
  const { kind } = useParams(),
    air = kind === "air";
  const { state, select } = useApp();
  const [mode, setMode] = useState("temperature"),
    [pollutant, setPollutant] = useState("pm25");
  const q = useQuery({
    queryKey: ["nation", unitQuery(state.settings.units), language()],
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
            value: [
              formatValue(
                m?.value,
                ["pm25", "pm10"].includes(pollutant) ? 0 : 3,
              ),
              m?.value === null || m?.value === undefined
                ? ""
                : pollutantUnit(pollutant),
            ]
              .filter(Boolean)
              .join(" "),
            label: m?.label || gradeLabel(data.units.airUnit, m?.grade ?? null),
            grade: m?.grade,
            at: p.station.observedAt,
            icon: "",
          };
        })
      : data.weather.map((p) => ({
          name: p.name,
          value:
            mode === "temperature"
              ? p.current.temperature === null
                ? "—"
                : `${formatValue(p.current.temperature)}°`
              : mode === "rain"
                ? p.current.precipitation === null
                  ? "—"
                  : `${amount(p.current.precipitation, data.units.precipitationUnit)} ${data.units.precipitationUnit}`
                : p.current.wind === null
                  ? "—"
                  : [
                      windText(p.current.windDirection),
                      `${formatValue(p.current.wind, 1)} ${data.units.windSpeedUnit}`,
                    ]
                      .filter(Boolean)
                      .join(" "),
          label: p.current.description,
          at: p.current.at,
          grade: null,
          icon: p.current.icon,
        }))
    : [];
  return (
    <>
      <PageTitle
        eyebrow={t("country.KR")}
        title={t(air ? "nav.nationAir" : "nav.nationWeather")}
        description={t("nation.description")}
      />
      <div className="view-tabs">
        {(air
          ? [
              ["pm25", t("pollutant.pm25")],
              ["pm10", t("pollutant.pm10")],
              ["o3", t("pollutant.o3")],
              ["no2", "NO₂"],
              ["so2", "SO₂"],
              ["co", "CO"],
            ]
          : [
              ["temperature", t("nation.tab.temperature")],
              ["rain", t("nation.tab.rain")],
              ["wind", t("nation.tab.wind")],
            ]
        ).map(([id, label]) => (
          <button
            key={id}
            className={(air ? pollutant : mode) === id ? "active" : ""}
            aria-pressed={(air ? pollutant : mode) === id}
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
            <div className="notice demo">{t("nation.demo")}</div>
          )}
          {rows.some((r) => isOld(r.at)) && (
            <div className="notice warning">{t("nation.stale")}</div>
          )}
          <div className="nation-grid">
            <section className="panel map-panel">
              <div className="map-canvas">
                <svg viewBox="0 0 500 670" aria-label={t("nation.mapLabel")}>
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
                    // Short names ("서울특별시" -> "서울") fit the marker.
                    const key =
                      r.name in mapPositions
                        ? r.name
                        : Object.keys(mapPositions).find((k) =>
                            r.name.startsWith(k),
                          );
                    const pos = key ? mapPositions[key] : undefined;
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
                          className={
                            air
                              ? "map-grade " +
                                gradeClass(data!.units.airUnit, r.grade ?? null)
                              : undefined
                          }
                        />
                        {!air && r.icon && (
                          <g transform="translate(22,-34)">
                            <WeatherIcon icon={r.icon} size={20} />
                          </g>
                        )}
                        <text textAnchor="middle" y="-4" className="map-name">
                          {key && t(regionKeys[key])}
                        </text>
                        <text textAnchor="middle" y="13" className="map-value">
                          {r.value}
                        </text>
                      </g>
                    ) : null;
                  })}
                </svg>
              </div>
              <p className="hint">{t("nation.mapHint")}</p>
            </section>
            <section className="panel region-list">
              <SectionHead title={t("nation.listTitle")} />
              {!air && mode === "rain" && (
                <p className="hint">{t("nation.rainHint")}</p>
              )}
              {rows.map((r, i) => (
                <div className="region-row" key={r.name + i}>
                  <div>
                    <strong>{r.name}</strong>
                    <Stamp at={r.at} zone="KST" />
                  </div>
                  {air ? (
                    <span
                      className={
                        "grade " +
                        gradeClass(data!.units.airUnit, r.grade ?? null)
                      }
                    >
                      {r.label}
                    </span>
                  ) : (
                    <WeatherIcon icon={r.icon} size={24} />
                  )}
                  <b>{r.value}</b>
                  <button
                    aria-label={t("nation.viewWeather", { name: r.name })}
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
    queryKey: ["warnings", language()],
    queryFn: ({ signal }) =>
      api<{ mode: string; items: WarningBulletin[] }>("/warnings/KR", signal),
    staleTime: 180000,
  });
  return (
    <>
      <PageTitle
        eyebrow={t("warnings.eyebrow")}
        title={t("nav.warnings")}
        description={t("warnings.description")}
        action={<ExternalWeather />}
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          {q.data.mode === "demo" && (
            <div className="notice demo">{t("warnings.demo")}</div>
          )}
          {q.data.items.length ? (
            q.data.items.map((b) => (
              <article className="panel bulletin" key={b.id}>
                <h2>{coreText(b.name)}</h2>
                <Stamp
                  at={b.announcement}
                  label={t("warnings.announced")}
                  timeZone="Asia/Seoul"
                />
                {isOld(b.announcement, 24) && (
                  <p className="warning-text">{t("warnings.stale")}</p>
                )}
                {b.sections.map((s, i) => (
                  <section key={i}>
                    <h3>{s.title}</h3>
                    {s.details.map((d, j) => (
                      <p key={j}>{d}</p>
                    ))}
                  </section>
                ))}
                {b.note && (
                  <p className="bulletin-note">{t("warnings.note")}</p>
                )}
                <p className="bulletin-text">{b.comment}</p>
                {b.imageUrl && (
                  <a
                    className="text-link"
                    href={b.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("warnings.image")} <ArrowUpRight size={15} />
                  </a>
                )}
              </article>
            ))
          ) : (
            <Empty title={t("warnings.empty.title")}>
              {t("warnings.empty.body")}
            </Empty>
          )}
        </>
      )}
    </>
  );
}
const unitLabel = (key: keyof Units) => t(`settings.unit.${key}`);
// Option values without a translated name (e.g. "hPa") are shown as is.
const unitNames: Record<string, MessageKey> = {
  bft: "settings.unitName.bft",
  kt: "settings.unitName.kt",
};
const unitName = (value: string) =>
  value in unitNames ? t(unitNames[value]) : standardName(value);
function SettingsPage() {
  const { state, setState, notify, capabilities } = useApp();
  const upload = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  async function clearData() {
    if (!window.confirm(t("settings.data.confirm"))) return;
    await clearLocalData(localStorage);
    queryClient.removeQueries({ queryKey: ["stored-weather"] });
    setState(defaultState());
    notify(t("settings.data.cleared"));
  }
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
      if (file.size > 100000) throw Error(t("settings.import.tooLarge"));
      const raw = await file.text(),
        parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.places))
        throw Error(t("settings.import.invalid"));
      const imported = restoreState({ getItem: () => raw });
      if (
        !window.confirm(
          t("settings.import.confirm", {
            current: state.places.length,
            imported: imported.places.length,
          }),
        )
      ) {
        notify(t("settings.import.cancelled"));
      } else {
        // Places dropped by the import must not leave stored weather behind.
        for (const old of state.places)
          if (!imported.places.some((p) => p.id === old.id))
            void deleteSnapshotsFor(old.id);
        setState(imported);
        notify(t("settings.import.done"));
      }
    } catch (e) {
      notify((e as Error).message);
    }
    if (upload.current) upload.current.value = "";
  }
  return (
    <>
      <PageTitle
        eyebrow={t("settings.eyebrow")}
        title={t("settings.title")}
        description={t("settings.description")}
      />
      <div className="settings-grid">
        <section className="panel">
          <SectionHead title={t("settings.units.title")} />
          {Object.keys(UNIT_OPTIONS).map((k) => {
            const key = k as keyof Units;
            return (
              <label className="setting-row" key={key}>
                <span>{unitLabel(key)}</span>
                <select
                  value={settings.units[key]}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        units: { ...s.settings.units, [key]: e.target.value },
                        // An explicit choice is never replaced by a default.
                        userUnits: [
                          ...s.settings.userUnits.filter((k) => k !== key),
                          key,
                        ],
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
                      {unitName(v)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {capabilities?.mode === "demo" && (
            <p className="hint">{t("settings.units.demo")}</p>
          )}
        </section>
        <div>
          <section className="panel">
            <SectionHead title={t("settings.display.title")} />
            <label className="setting-row">
              <span>{t("settings.language")}</span>
              <select
                value={settings.language ?? ""}
                onChange={(e) => {
                  const language = isLanguage(e.target.value)
                    ? e.target.value
                    : null;
                  setState((s) => ({
                    ...s,
                    settings: { ...s.settings, language },
                  }));
                }}
              >
                <option value="">
                  {t("settings.languageAuto", {
                    language:
                      LANGUAGE_NAMES[detectLanguage(navigator.languages ?? [])],
                  })}
                </option>
                {LANGUAGES.map((code) => (
                  <option key={code} value={code} lang={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{t("settings.languageHint")}</p>
            <label className="setting-row">
              <span>{t("settings.theme.label")}</span>
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
                {(["light", "dark", "photo", "classic"] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.theme.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>{t("settings.startup.label")}</span>
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
                {(
                  ["hourly", "daily", "air", "overview", "locations"] as const
                ).map((v) => (
                  <option key={v} value={v}>
                    {t(`settings.startup.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span>{t("settings.refresh.label")}</span>
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
                    {m === 0
                      ? t("settings.refresh.manual")
                      : m < 60
                        ? t("settings.refresh.minutes", { minutes: m })
                        : t("settings.refresh.hours", { hours: m / 60 })}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{t("settings.refresh.hint")}</p>
          </section>
          <section className="panel">
            <SectionHead title={t("settings.backup.title")} />
            <p className="muted-text">{t("settings.backup.hint")}</p>
            <div className="button-row">
              <button className="button" onClick={exportData}>
                <Download size={16} /> {t("settings.backup.export")}
              </button>
              <button
                className="button"
                onClick={() => upload.current?.click()}
              >
                <Upload size={16} /> {t("settings.backup.import")}
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
          <section className="panel">
            <SectionHead title={t("settings.data.title")} />
            <p className="muted-text">{t("settings.data.hint")}</p>
            <button className="button" onClick={() => void clearData()}>
              <Trash2 size={16} /> {t("settings.data.clear")}
            </button>
          </section>
        </div>
      </div>
      <section className="panel">
        <SectionHead title={t("settings.service.title")} />
        <div className="button-row">
          <Link className="text-link" to="/help">
            {t("settings.service.privacy")} <ChevronRight size={15} />
          </Link>
          <Link className="text-link" to="/membership">
            {t("settings.service.pricing")} <ChevronRight size={15} />
          </Link>
          <a
            className="text-link"
            href="https://github.com/WizardFactory/TodayWeather/issues"
            target="_blank"
            rel="noreferrer"
          >
            {t("settings.service.report")} <ArrowUpRight size={15} />
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
        eyebrow={t("help.eyebrow")}
        title={t("help.title")}
        description={t("help.description")}
      />
      <section className="panel prose" id="install">
        <h2>{t("help.install.title")}</h2>
        <p>{t("help.install.body")}</p>
        <h2>{t("help.privacy.title")}</h2>
        <p>{t("help.privacy.body")}</p>
        <h2>{t("help.offline.title")}</h2>
        <p>{t("help.offline.body")}</p>
        <h2>{t("help.notifications.title")}</h2>
        <p>{t("help.notifications.body")}</p>
        <p>{t("help.notifications.app")}</p>
        <h2>{t("help.skyTheme.title")}</h2>
        <p>{t("help.skyTheme.body")}</p>
        <h2 id="units">{t("help.units.title")}</h2>
        <p>{t("help.units.body")}</p>
        <h2>{t("help.sources.title")}</h2>
        <p>
          {t("help.sources.body", {
            source: airSource(),
            disclaimer: airDisclaimer(),
          })}
        </p>
        <p>{forecastDescription("kaq")}</p>
        <p>{t("help.sources.precipitation")}</p>
        <ExternalWeather />
        <h2>{t("help.accessibility.title")}</h2>
        <p>{t("help.accessibility.body")}</p>
        <a
          href="https://earth.nullschool.net/"
          target="_blank"
          rel="noreferrer"
          className="text-link"
        >
          {t("help.windMap")} <ArrowUpRight size={15} />
        </a>
      </section>
    </>
  );
}
function Membership() {
  return (
    <>
      <PageTitle
        title={t("membership.title")}
        description={t("membership.description")}
      />
      <section className="panel prose">
        <ShieldCheck size={36} />
        <h2>{t("membership.heading")}</h2>
        <p>{t("membership.body")}</p>
        <p>{t("membership.future")}</p>
      </section>
    </>
  );
}
