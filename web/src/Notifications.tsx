import { useState, useEffect } from "react";
import { useParams, Link, useBlocker } from "react-router-dom";
import { Bell, BellOff, Check, Plus, Trash2, Info } from "lucide-react";
import { PLACES, type Place, type Units } from "@todayweather/core";
import { useApp } from "./context";
import { api } from "./api";
import { resolvePlace } from "./state";
import { PageTitle, Empty, Loading } from "./components";
type Rule = {
  id: string;
  place: Place;
  units: Units;
  timezone: string;
  days: number[];
  times: string[];
  enabled: boolean;
  alert: { enabled: boolean; start: string; end: string };
  revision: number;
};
function keyBytes(s: string) {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export default function Notifications() {
  const { locationId } = useParams();
  const { state, capabilities, notify } = useApp();
  const place = resolvePlace(state, locationId);
  const [csrf, setCsrf] = useState(""),
    [subscribed, setSubscribed] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [time, setTime] = useState("07:00"),
    [rule, setRule] = useState<Rule>(),
    [saved, setSaved] = useState<Rule>();
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  useEffect(() => {
    if (!place) return;
    setRule({
      id: crypto.randomUUID(),
      place,
      units: state.settings.units,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      days: [1, 2, 3, 4, 5],
      times: ["07:00"],
      enabled: true,
      alert: { enabled: false, start: "07:00", end: "22:00" },
      revision: 0,
    });
    setSaved(undefined);
    setDirty(false);
  }, [place?.id]);
  useEffect(() => {
    if (!capabilities?.notifications.enabled || !place) return;
    let live = true;
    setBusy(true);
    api<{ csrf: string; subscribed: boolean }>("/installations", undefined, {
      method: "POST",
    })
      .then(async (session) => {
        const data = await api<{ items: Rule[] }>("/notification-rules");
        if (!live) return;
        setCsrf(session.csrf);
        setSubscribed(session.subscribed);
        const existing = data.items.find((r) => r.place.id === place.id);
        if (existing) {
          setRule(existing);
          setSaved(existing);
        }
      })
      .catch((e) => {
        if (live) notify(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [capabilities?.notifications.enabled, place?.id]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (
        window.confirm(
          "저장하지 않은 알림 설정이 있습니다. 이 페이지를 나갈까요?",
        )
      )
        blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  const change = (patch: Partial<Rule>) => {
    setRule((r) => (r ? { ...r, ...patch } : r));
    setDirty(true);
  };
  const enabled = capabilities?.notifications.enabled && supported;
  async function subscribe() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw Error(
          "알림 권한이 허용되지 않았습니다. 브라우저 설정에서 변경할 수 있습니다.",
        );
      const registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(
            capabilities!.notifications.publicKey!,
          ),
        }));
      await api("/subscriptions/current", undefined, {
        method: "PUT",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify(subscription),
      });
      setSubscribed(true);
      notify("브라우저 알림을 등록했습니다. 아래 설정을 저장해 주세요.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!rule) return;
    setBusy(true);
    try {
      const result = await api<{ item: Rule }>(
        "/notification-rules/" + rule.id,
        undefined,
        {
          method: "PUT",
          headers: { "X-CSRF-Token": csrf },
          body: JSON.stringify({ ...rule, units: state.settings.units }),
        },
      );
      setRule(result.item);
      setSaved(result.item);
      setDirty(false);
      notify("알림 설정을 서버에 저장했습니다.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unsubscribe() {
    setBusy(true);
    try {
      await api("/subscriptions/current", undefined, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      });
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      setSubscribed(false);
      setSaved(undefined);
      setDirty(false);
      notify("이 브라우저의 모든 알림을 해제했습니다.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!place || !rule)
    return (
      <Empty title="알림을 받을 지역을 선택해 주세요">
        <Link to="/locations">관심지역으로 이동</Link>
      </Empty>
    );
  return (
    <>
      <PageTitle
        eyebrow="하루를 준비하는 알림"
        title={`${place.name} 알림`}
        description="마지막으로 저장한 이 지역의 날씨를 확인할 시간을 정하세요."
      />
      <section className="panel notification-status">
        <Bell size={30} />
        <div>
          <h2>
            {enabled
              ? subscribed
                ? "브라우저 알림이 등록되어 있습니다"
                : "브라우저 알림을 켜 주세요"
              : "웹 알림을 아직 사용할 수 없습니다"}
          </h2>
          <p>
            {!supported
              ? "이 브라우저에서는 알림을 지원하지 않거나 홈 화면 설치가 필요합니다."
              : (capabilities?.notifications.reason ??
                "알림 서버 설정을 확인하는 중입니다.")}
          </p>
          <Link to="/help#install" className="text-link">
            설치·권한 안내
          </Link>
        </div>
        {enabled && !subscribed && (
          <button
            className="button primary"
            disabled={busy || !csrf}
            onClick={() => void subscribe()}
          >
            알림 켜기
          </button>
        )}
      </section>
      {!enabled && (
        <div className="notice warning">
          <Info size={18} />
          <span>
            설정 내용을 서버에 저장하거나 알림을 발송할 수 없습니다. 기존 모바일
            앱의 알림을 이용해 주세요.
          </span>
        </div>
      )}
      <section className="panel">
        <div className="section-head">
          <h2>정시 알림</h2>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => change({ enabled: e.target.checked })}
            />
            사용
          </label>
        </div>
        <p className="muted-text">
          선택한 요일과 시간에 날씨를 확인할 수 있는 알림을 보냅니다.
        </p>
        <div className="weekday-picker">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <button
              key={d}
              aria-pressed={rule.days.includes(i)}
              onClick={() =>
                change({
                  days: rule.days.includes(i)
                    ? rule.days.filter((v) => v !== i)
                    : [...rule.days, i],
                })
              }
            >
              {d}
            </button>
          ))}
        </div>
        <div className="alarm-times">
          {rule.times.map((t) => (
            <div key={t}>
              <Bell size={17} />
              <strong>{t}</strong>
              <button
                className="icon-button"
                aria-label={`${t} 알림 삭제`}
                onClick={() =>
                  change({ times: rule.times.filter((x) => x !== t) })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="button-row">
          <input
            type="time"
            aria-label="추가할 알림 시각"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <button
            className="button"
            disabled={rule.times.length >= 6}
            onClick={() => {
              if (time && !rule.times.includes(time))
                change({ times: [...rule.times, time].sort() });
            }}
          >
            <Plus size={16} />
            시간 추가
          </button>
        </div>
        <label className="setting-row">
          <span>시간대</span>
          <input
            aria-label="알림 시간대"
            value={rule.timezone}
            onChange={(e) => change({ timezone: e.target.value })}
          />
        </label>
        <p className="hint">
          현재 위치가 바뀌어도 자동으로 지역을 추적하지 않습니다. 기기와
          네트워크 상태에 따라 알림이 지연될 수 있습니다.
        </p>
      </section>
      <section className="panel">
        <SectionHeadLocal />
        <p className="muted-text">
          비·눈·미세먼지 조건별 알림은 기존 규칙과 최신 관측 자료의 검증이
          필요해 아직 활성화하지 않았습니다.
        </p>
      </section>
      <div className="form-actions">
        <button
          className="button"
          onClick={() => {
            if (saved) setRule(saved);
            else
              setRule({
                ...rule,
                days: [1, 2, 3, 4, 5],
                times: ["07:00"],
                enabled: true,
              });
            setDirty(false);
          }}
        >
          변경 취소
        </button>
        <button
          className="button primary"
          disabled={!enabled || !subscribed || busy || !csrf}
          onClick={() => void save()}
        >
          <Check size={16} />
          설정 저장
        </button>
      </div>
      {subscribed && (
        <div className="button-row">
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              try {
                await api("/notifications/test", undefined, {
                  method: "POST",
                  headers: { "X-CSRF-Token": csrf },
                });
                notify(
                  "알림 제공 서비스가 요청을 받았습니다. 기기에서 실제 수신 여부를 확인해 주세요.",
                );
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            시험 알림 보내기
          </button>
          <button
            className="text-button danger"
            onClick={() => void unsubscribe()}
          >
            <BellOff size={16} />이 브라우저 알림 모두 해제
          </button>
        </div>
      )}
      {dirty && (
        <p className="hint" role="status">
          아직 저장하지 않은 변경사항이 있습니다.
        </p>
      )}
    </>
  );
}
function SectionHeadLocal() {
  return (
    <div className="section-head">
      <h2>날씨 변화 알림</h2>
      <span className="pill neutral">준비 중</span>
    </div>
  );
}
