# Investigation
Confirmed local parser repeats wfEn assignment instead of setting wdEn. Both RSS models store ws and numeric wd; service incorrectly reads wsd/vec and overwrites absent wav/uuu/vvv.
KMA primary documentation: https://www.kma.go.kr/w/resources/pdf/dongnaeforecast_rss.pdf (2021-03-04, retrieved 2026-09-24), pp.1-2: numeric wd 0..7 clockwise from north; distinct English code mapping E=1,N=2,NE=3,NW=4,S=5,SE=6,SW=7,W=8. Do not conflate them.
getShortRss skips older publications, fills equal, overwrites newer, before downstream current/shortest/unit middleware. Backward scan skips index zero when all RSS slots are future; one future row never merges. Include boundary regression and minimal scan repair.
Additional same-block defect: 15:00 tmx gate checks tmn instead of tmx; protect actual source field when making source validation uniform.
Both DB formats project rssString. V2 uses UTC Date publication and per-slot documents; V1 uses string publication and shortData array. No schema change needed.
No live provider or production read in this task. Three-grid observations in issue remain historical evidence; tests use explicitly synthetic fixtures.
