import { useParams, Link } from "react-router-dom";
import { BellOff } from "lucide-react";
import { useApp } from "./context";
import { resolvePlace } from "./state";
import { PageTitle, Empty } from "./components";
export default function Notifications() {
  const { locationId } = useParams();
  const { state } = useApp();
  const place = resolvePlace(state, locationId);
  if (!place)
    return (
      <Empty title="지역을 찾을 수 없습니다">
        <Link to="/locations">관심지역 보기</Link>
      </Empty>
    );
  return (
    <>
      <PageTitle
        title={`${place.name} 알림`}
        description="날씨 알림은 기존 모바일 앱에서 이용해 주세요."
      />
      <section className="panel notification-status">
        <BellOff size={28} aria-hidden="true" />
        <div>
          <h2>웹 알림을 아직 사용할 수 없습니다</h2>
          <p>
            현재 웹앱에서는 알림을 예약하거나 구독할 수 없습니다. 날씨와
            관심지역은 계속 이용할 수 있습니다.
          </p>
          <Link className="button" to={`/weather/${place.id}/hourly`}>
            날씨 보기
          </Link>
        </div>
      </section>
    </>
  );
}
