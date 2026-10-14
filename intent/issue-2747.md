Task: issue-2747-s13d; owner: Claude builder (S13d worktree); revision/base: 05c06c67 (origin/master, S15b-1 merge); date: 2026-10-14.
Authority: AK decisions of 2026-10-14 relayed by the root coordinator: A-1 (provider timeouts and the request waiter, corrected the same day: no new 503), A-2 (pollen day+3), the national-key direction and the evidence rule (provider documentation, legacy collectors, tw_svc assembly, minimal live checks). Endpoint pre-merge.
Criteria: AC1-AC6 below, from the #2747 completion criteria.

# Intent

Legacy collected provider data in the background with long per-request timeouts. server2 answers
user requests and acquires on demand, so it must keep both properties: a request never waits long,
and a slow but working provider is still collected.

- AC1 (A-1, timeouts): every provider HTTP attempt uses the timeout of the legacy collector for that
  service: town forecast, mid forecast and forecast zone 10 s; UV/pollen life index, warnings and KMA
  web pages 30 s; AirKorea and KASI 5 s; Visual Crossing 8 s. The connect timeout stays bounded.
- AC2 (A-1, waiter): a request waits at most 3 s for an acquisition, or less when the remaining
  gateway attempt is shorter. It then answers with what is ready and omits any section whose
  acquisition has not finished, using legacy's absent-data output for that section. No new
  `EWEATHERUNAVAILABLE`/503 use is added; the existing legacy 503 cases stay.
- AC3 (A-1, owned work): the acquisition is an owned task. It survives every waiter, keeps the legacy
  provider timeout, is funded through S08 before HTTP, publishes its raw record through S06, and is
  never duplicated by later requests. The next request uses the stored record.
- AC4 (national keys): AirKorea, KMA scraper pages and ASOS answer the whole country per
  acquisition. Their owned acquisitions are keyed by dataset and publication time and shared by the
  requests of every cell; each request uses what is ready within its own bound.
- AC5 (A-2): pollen V3 validation accepts `twodaysaftertomorrow` (day+3), raw records keep the bytes,
  and the legacy client response does not change.
- AC6: placement matches `server2/config/tasks/S13d.json`; no runtime mode or verification flag.

Out of scope: request-time domestic acquisition and assembly (S15b-2/3/4 consume the primitive), a
derived pollen view (S15b-3), the geocoder contract (its own 3 s provider / 5 s lookup bound is
unchanged), `server/`, live production calls beyond the minimal timing/shape checks, AWS, merge and
`plans/issue-2614.md`.

Risks: an owned acquisition can now hold a resolver owner or capture slot for up to two legacy
timeouts plus publication (63 s for the life index). Owners stay bounded (four resolver owners by
default; sixteen running shared acquisitions), so a hanging provider reduces capacity instead of
growing work.
