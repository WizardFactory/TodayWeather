import { PLACES, type Place } from "@todayweather/core";
import { coreText, t, type MessageKey } from "./i18n";

const CATALOG = new Set(PLACES.map((p) => p.id));
/** Catalog cities are shown in the UI language; other names as received. */
export function placeName(place: Pick<Place, "id" | "name" | "current">) {
  return !place.current && CATALOG.has(place.id)
    ? t(`city.${place.id}` as MessageKey)
    : coreText(place.name);
}
export function placeArea(place: Pick<Place, "id" | "address" | "current">) {
  return !place.current && CATALOG.has(place.id)
    ? t(`cityArea.${place.id}` as MessageKey)
    : place.address;
}
/** Search text for a catalog city: localized, Korean and id names. */
export const placeSearchText = (place: Place) =>
  `${placeName(place)} ${placeArea(place)} ${place.name} ${place.address} ${place.id}`.toLocaleLowerCase();
