# Station observations after a restart

AK requires that a request waits at most 3 s and answers from what was gathered by then. The EC2 restart comparison of #2866 showed that the first weather request after a restart misses the minute observations and the past days. The restart read restored every stored AWS hourly and city page of the 8-day window one day after another and parsed each page again: about 1.0 to 1.4 s per day on a t3.small, plus 4 to 5 s of sequential GETs. The minute pages came last, and every page call read the descriptor of every group in the day's minute catalog. The request stopped waiting at 2.5 s with neither. On 2026-11-07 AK chose the day product design ("A로 진행").

## Outcomes

- **MINUTE:** a restart lists the day's minute catalog once and restores only the newest acquisition of each minute within the readers' 40 minutes. The newest four come before the first answer and the rest follow.
- **PRODUCT:** any process that folds the station pages stores one product per KST day holding the parsed inputs of the hourly fold, the newest page of each kind and hour, at most once per ten minutes per day and only when what the day is made of changed. No request waits for it.
- **RESTART:** a restarted process reads each day's newest product and compares it with the day catalogs (S3 is truth). It restores only the pages the product lacks, parses only those, and answers past days and minute rows from its first request. Today and yesterday are compared before the answer, the other days after it.
- **ACCOUNTED:** a repaired group completes its day after a restart, a station that joins the city set after the products has its AWS rows read in full again, and a minute whose newest acquisition is not complete is read from the next one, each as a raw read gives it.
- **FALLBACK:** an unreadable product, an older schema or parse revision, or a city set that grew is replaced by the raw pages of that day, and the day's product is stored again. A page the catalog does not list is dropped.
- **S16:** legacy answers, the station page input identities and the response-first durability set are unchanged. A day stays partial when its product's read had a group S06 excluded or a newer group is not complete, and answers stay unsettled until the rest of the read ends.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions for AK

This adds a stored object that other processes trust as a starting point, so it is not merged without AK:

- Products are written to S3 under `kma-web` / `station-pages` beside the pages they are made of, never deleted, at most one per day and ten minutes per process. They are excluded from the disk cache, like the image forecast product.
- A day product records every listed group of its day: the pages, the other complete groups and the S06-excluded ones. Each read checks the excluded groups and any group published since, so a restart counts a day complete exactly when a raw read would, as long as no complete raw object is ever deleted. While a group stays excluded, every read of its day spends one catalog read and the group's descriptor and raw GETs on it.
- The first answer after a start is never complete for S16: the days past yesterday are compared after it, so a later request records the daily summaries. A fold that recomputes the hourly part also holds summaries back until its product comparison ends.
- A process at hour H stores products only for days whose every hour is in the window. Right after the first deployment, the oldest day of the window therefore has no product and is read from its raw pages after the first answer.

## Exclusions

Not in this change: a real EC2 measurement of the new path, a product for the minute pages, the station ASOS state, and the collector's restart probing (KMA-SR-06 of #2862).
