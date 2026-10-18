# Forecast-zone retry contract

## Behavior

`S3Source::zones(now, deadline)` retains the public API. With forecast collection enabled and no successful process refresh, join the existing `forecast-zones` owned key with an immediate waiter bound. Only its creator may claim the existing `Attempts` five-minute monotonic memo. Failed admission performs no provider call. No timer, configuration flag, pre-collection or catch-up queue is added.

An admitted owner calls the existing `ForecastAcquire::Zones`. Error, None, panic and an empty or unreadable returned acquisition leave the process success flag false and retain the last-good memory. A complete readable published zone list invalidates memory and then marks success. Subsequent requests fold S3 normally and do not schedule another process refresh. The original ten-minute incremental S3 refresh, daily refold and historical field merge remain unchanged. Acquirer implementations retain the Published contract (Some means publication completed); the source additionally checks list readability before latching.

## Bounds and failure

Keep the same owned provider/publication lifetime, admission pool, three-second completed-flight retention and immediate request wait. A caller cancellation never cancels the owner. Existing bounded Attempts state is reused; capacity refusal fails closed until later demand can claim. Restart resets this process-local policy. No durable retry limit, live-provider availability, quota measurement or D2 performance is promised. If publication succeeds but returned data is unreadable, a later bounded retry is allowed; no S3 state is rewound.

## Acceptance

- AC1: error, None, panic, empty and malformed result recover after memo expiry; no panic reaches the caller.
- AC2: calls within the memo do not repeat; overlapping requests own one acquisition; success prevents another attempt even after expiry.
- AC3: stored fields and refresh semantics remain; waiter cancellation retains ownership; no funding or late-Short change.
- AC4: actual failing-before test, passing-after checks, an owned local S3/provider functional run across a real memo expiry, exact declared paths and independent reviewed CI-bound pre-merge candidate.
