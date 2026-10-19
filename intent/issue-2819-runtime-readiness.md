# Private runtime readiness

Continue [#2819 E3](https://github.com/WizardFactory/TodayWeather/issues/2819) before
seven-day shadow. Operators need a private readiness result when push restoration or its
writer is unavailable, the process is stopping, or configured S3/credentials cannot serve
a bounded read. Public `/health` remains liveness. Reuse canonical service references and
the existing process shutdown signal; no second writer, monitor or scheduling owner.

The selected design must provide fixed bounded nonsecret response statuses and explicit
health limits. A read-only probe must not write objects, contact providers/FCM, retry sends,
add modes or imply all API parity/Get/Put/IAM/host/production readiness. S3 missing-object
403/404 measurement is E4; #2724 remains deferred. Complete environment-only configuration
without `.env` remains supported under AK's E2 decision; missing mandatory config fails.

Exact intended paths are declared before edits in
`server2/config/tasks/RuntimeReadiness2819.json`. New implementation/tests/config remain
under server2; outside paths are maintained documents, selected evidence and diagrams.
The endpoint is a new operator API: deliver actual owned workflow screenshots, editable
manual and visually checked PDF, in addition to final-source diagram and normal checks.

Authorized endpoint is pre-merge: scoped code/test/smoke/commit/push/PR/independent review/CI.
No merge, auto-merge, queue, cloud mutation/deploy, live provider/device or seven-day shadow
is authorized here. Parent PR2835 remains unmerged; parent/current CI gate completion.


2026-10-19 continuation: AK requests next steps1–4. Implementation baseline is integrated master `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`; original source-at-intake remains historical. This task remains the private readiness pre-merge slice. No seven-day shadow, deployment or live provider/device activity.
