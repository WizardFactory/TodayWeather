# D1: retry failed forecast-zone acquisition

Source: [#2819 D1](https://github.com/WizardFactory/TodayWeather/issues/2819). AK requested the ordered fixes before seven-day shadow and clarified to continue. Endpoint: pre-merge only, including tests, commit/push/PR, independent review and CI. No merge, cloud/production mutation, live provider or notification send is authorized.

At the recorded B3 parent, the first zone acquisition marks a process flag before its result. Failure permanently prevents another provider attempt. Weather callers can therefore lack mid-temperature zone metadata for the process lifetime. Make failed attempts eligible again after the existing five-minute retry bound; stop request-triggered acquisition after a complete readable published result. Preserve the existing last-good S3 fold and all response/deadline contracts.

Acceptance: AC1 failure/None/panic/unreadable result does not permanently latch; AC2 retries are demand-only, one owner, at most once per five-minute admission, and success stops collection; AC3 existing S3 memory/fold and cancellation/funding remain; AC4 exact path, meaningful Red/Green and isolated functional evidence, review/CI before readiness. D2 capacity and the retained whole-domestic three-second failure remain open. No global readiness, operating quota or seven-day shadow claim.
