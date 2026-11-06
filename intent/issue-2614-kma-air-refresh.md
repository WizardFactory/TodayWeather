# Late AirKorea stations are refreshed within ten minutes

The EC2 verification of 2026-11-07 showed current air one hour stale at some stations. The nationwide dataset for 02:00, acquired at 02:10, had 중구 and 연산동 at 02:00 but 둔산동 (Daejeon) and 월영동 (Masan) still at 01:00: AirKorea updates some stations after the hour's dataset is out. server2 acquires the current hour once, when it is not stored, so those stations answered 01:00 until the next hour's acquisition at 03:00, about 50 minutes. Legacy collected the real-time observations every 10 minutes (`controllerManager.js`, minutes 3, 13, ..., 53), so a late station was current within 10 minutes. AK approved the fix on 2026-11-07 ("진행").

## Outcomes

- **REFRESH:** while the newest stored dataset of the current hour has a station one hour behind, the process capture acquires the hour again at each 10-minute check. The capture reads the stored dataset itself, so it needs no request and no request waits for it.
- **STOP:** once every live station is current the hour is complete and the capture neither reads nor asks for it again; stations further behind (out of service) never cause a refresh.
- **UNCHANGED:** requests answer as before (the stored data, no new wait); a missing current hour is acquired as before.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Exclusions

Not in this change: the request path (requests never wait for a refresh), the AirKorea key quota, other datasets, and fixes 1, 2 and 4 of the EC2 report.
