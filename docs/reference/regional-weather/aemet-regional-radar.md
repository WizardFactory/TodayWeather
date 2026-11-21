# AEMET regional radar source qualification

The Madrid, Almería and Barcelona OpenData products returned regional reflectivity GIFs. Each image had a visible observation label and issuer credit. The endpoints provide no verified machine-readable observation time or exact GIF footprint. Keep all three products in source qualification for live delivery. [AEMET radar product guide](https://www.aemet.es/es/eltiempo/observacion/radar/ayuda)

## Observations on November 21, 2026

The three request sets ran at 11:05:36, 11:07:28 and 11:11:42 UTC. Each regional OpenData endpoint returned HTTP 200 and provider `estado:200`. Each `datos` download returned HTTP 200, `image/gif`, a valid GIF signature and a 480 × 530 frame. Each `metadatos` download returned HTTP 200 with a generic text description. Neither download carried `Last-Modified`. The labels below preserve the hours and minutes visible on the imagery. Interpret those labels as UTC only once the convention is confirmed for this product.

| Station | Product | Visible capture times | Coverage | Decision for live delivery |
| --- | --- | --- | --- | --- |
| Madrid | `ma` | 11:00 in all three samples | Station-centered 240 km nominal radius. The image depicts central Spain. Exact GIF bounds and terrain gaps need verification. | Retrieval passed. Observation time is available as pixels. Update interval and georeferencing remain open. |
| Almería | `am` | 10:50, 11:00, 11:00 | Station-centered 240 km nominal radius. Image includes the southern coast and nearby sea. Exact GIF bounds and terrain gaps need verification. | Retrieval passed. A 10-minute frame step was observed. A timestamp contract and reliable cadence remain open. |
| Barcelona | `ba` | 10:50, 11:00, 11:00 | Station-centered 240 km nominal radius. Image includes Catalonia and nearby Mediterranean waters. Exact GIF bounds and terrain gaps need verification. | Retrieval passed. A 10-minute frame step was observed. A timestamp contract and reliable cadence remain open. |
| National | `nacional` | — | — | Each request returned HTTP 200 with provider `estado:404`. No usable image reference was returned. Classify the product as unavailable for the observed checks. |

The 240 km circle is the documented nominal footprint for regional radar. Terrain blockage, beam elevation and outages can reduce effective coverage. Preserve the issuer's depiction of areas without coverage and avoid interpreting them as having no precipitation. The website lists georeferenced EPSG:4326 GeoTIFF downloads for the three latest frames. Verify the exact product timestamp, geotransform and effective coverage on that source before using it in any map or point delivery. [Radar interpretation and downloads](https://www.aemet.es/es/eltiempo/observacion/radar/ayuda)

## Delivery conditions

1. Verify a machine-readable observation timestamp and its zone against the product. HTTP retrieval time does not represent acquisition time. The samples establish a frame step for two stations. They do not establish an update service level.
2. Verify the product footprint and effective coverage against station and image metadata. Keep per-station freshness and geometry independent.
3. Enforce an image size limit before decode, validate the media type and GIF signature, and classify missing, corrupt or over-age data as unavailable. An initial qualification probe used a 1 MB download cap. Choose a release age from documented cadence and measured delivery lag.
4. Show AEMET credit and the observation date when qualified. Preserve existing logos, metadata and source meaning. Check product-specific terms and the applicable map credit before republishing a frame or derived image. [AEMET reuse terms](https://www.aemet.es/es/nota_legal)

This source study has no runtime dependency on the AEMET CAP route. Use the regional product rules for radar access and retention. [OpenData API specification](https://opendata.aemet.es/AEMET_OpenData_specification.json) · [Sanitized sample record](aemet-radar-samples.json) · [Issue #3104](https://github.com/WizardFactory/TodayWeather/issues/3104)
