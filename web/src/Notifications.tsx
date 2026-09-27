import { useParams, Link } from "react-router-dom";
import { BellOff } from "lucide-react";
import { useApp } from "./context";
import { resolvePlace } from "./state";
import { PageTitle, Empty } from "./components";
import { t, useLanguage } from "./i18n";
import { placeName } from "./places";
export default function Notifications() {
  useLanguage();
  const { locationId } = useParams();
  const { state } = useApp();
  const place = resolvePlace(state, locationId);
  if (!place)
    return (
      <Empty title={t("notifications.notFound")}>
        <Link to="/locations">{t("notifications.viewLocations")}</Link>
      </Empty>
    );
  return (
    <>
      <PageTitle
        title={t("notifications.title", { name: placeName(place) })}
        description={t("notifications.description")}
      />
      <section className="panel notification-status">
        <BellOff size={28} aria-hidden="true" />
        <div>
          <h2>{t("notifications.heading")}</h2>
          <p>{t("notifications.body")}</p>
          <Link className="button" to={`/weather/${place.id}/hourly`}>
            {t("common.viewWeather")}
          </Link>
        </div>
      </section>
    </>
  );
}
