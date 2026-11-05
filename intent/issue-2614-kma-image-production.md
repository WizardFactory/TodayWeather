# The AirKorea image forecast made on a schedule

On 2026-11-06 AK accepted the follow-up decisions of the request bound (#2863). Two of them are this change. A first response does not wait for the AirKorea forecast images, and AK asked for them to be made when they are published, independent of requests ("요청과 상관없이 정기적으로 발행될때 제작하는 방향으로 설계"). In the EC2 measurement of #2863 a cold request still decoded the stored GIFs, 1.2 to 1.4 s on the request path. AK also chose that `regionName` keeps the province name the request carried where the lookups use the town list's name.

## Outcomes

- **REGION:** under the observed source, a request naming `강원특별자치도`, `전북특별자치도` or `전남광주통합특별시` answers `regionName` with that name, including after a KR remap, while its lookups use the listed name.
- **PRODUCE:** the process acquires the expected announcement's images, decodes them and stores the hourly forecast as one product, at startup and then every ten minutes, without any request. A production with nothing new stores and decodes nothing, and a new process starts from the stored product.
- **READ:** under the observed source a request never acquires or decodes an image. It reads the newest product, removes the rows a day old by its instant, and gets the legacy answer for missing data until a product exists.
- **LEGACY:** the product read back answers the legacy oracle runs byte for byte, and the legacy-path source keeps its request-time fold and acquisition.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions for AK

This changes what a response carries and adds background work, so it is not merged without AK:

- Image acquisitions and the dust forecast documents that name them are fetched on the timer, whether or not anyone asks, as legacy's hourly `kecoForecast` did. Before, only demand started them.
- A request reads the product of the last production: a new announcement's rows appear after the next production stores them, at most ten minutes after the images are published, plus the time to fetch and decode them.

## Exclusions

Not in this change: a real EC2 measurement of the new path (it needs AK's go-ahead to create an instance), decoding fewer than every stored acquisition after a restart that finds the product stale, and the collector's restart probing (KMA-SR-06 of #2862).
