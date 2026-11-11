# iOS first-launch weather checks

Use this procedure before an iOS release or navigation-review handoff. It does not
establish AdMob policy clearance or ad fill. The focused investigation is
[#2937](https://github.com/WizardFactory/TodayWeather/issues/2937); policy clearance,
app-ads.txt authorization and revenue remain in
[#2871](https://github.com/WizardFactory/TodayWeather/issues/2871).

## Check the public dependency before changing the app

Check `GET /health`, then versioned weather requests for a domestic and overseas
preset against the API base in the **actual bundled** `client.config.js`. Do not use
`/gather/*` as health probes. Retain the sanitized path, HTTP status, elapsed time,
response source and timestamp; avoid logging credentials or a user's coordinates.
A direct-origin success does not prove the public path works.

If the public request times out, inspect the **current** CloudFront origins and path
behaviors, authoritative DNS and EC2 address association using the credentials and
access procedure in [EC2 access](../architecture/ec2-access.md). Do not assume a
historical API Gateway mapping still applies. On 2026-11-12, both `weather/*` and
`geocode/*` targeted `tw-svc-spot.wizardfactory.net`. Its DNS address was allocated
but unassociated. The running service answered the same request successfully when
explicitly addressed. AK authorized restoring the existing EIP association; public
health and domestic/overseas weather then returned 200. See the
[dated evidence](../evidence/tasks/issue-2937/README.md).

An address repair changes production traffic. Prepare exact source/target IDs,
current association, healthy-origin evidence and expected effects for approval.
Do not steal an address already associated elsewhere. Recheck immediately before
an approved association, disable reassociation and read back the exact result.
Attaching an EIP replaces an automatically assigned public address; that ephemeral
address is not guaranteed recoverable. Do not promise a rollback to its exact value.
A source rollback cannot undo an EC2 address change.

## Keep the release artifact and user state distinguishable

Record IPA/archive identity, source revision, version/build, executable identity,
device/OS, locale, signing changes and every test-only modification. A custom
WKWebView, simulator rebuild or re-signed isolated copy is not the unmodified
submitted binary. Use test ads and preserve consent gates.

Preserve the existing installed app, shared preferences, keychain and device
settings. An isolated copy needs a separate bundle ID and preferences domain, with
no original app-group access. Record any resulting entitlement/plugin differences.
Use stable USB data transport for device radio-off tests. A wireless XCTest session
can disconnect before its restoration code or app checks finish; verify radio
states with a separate connected-session check and do not count that as a product
failure or successful offline coverage. An empty `system_profiler` USB inventory
is not conclusive: check IORegistry and paired legacy-device tools when CoreDevice
does not support the OS. Use an OS-compatible UI driver and verify the original
Wi-Fi/cellular/airplane states independently after restoration. Reset only task-owned
state. Change language through app-scoped launch arguments
when supported; do not reset device-wide privacy or language settings.

## Required user journeys

The client supports `ja`, `ko`, `en`, `de`, `zh-CN` and `zh-TW`. Start each preset
case with no saved favorite cities. Japanese is the primary reproduction locale;
Korean/English are controls, with the other supported languages checked explicitly.
The picker exposes 6, 11, 17 or 26 presets according to screen height. Record which
were actually displayed and tapped. A screen-height override checks handlers, not
tablet layout or physical touch access.

Trace selection -> geocoding when needed -> versioned weather request -> response
conversion -> forecast transition. Presets already carry coordinates and bypass
address geocoding. Separately exercise actual typed autocomplete/result selection,
current location allowed and denied, offline and timeout settlement, and same-city
retry or alternate-city recovery. A fixture or forced-origin path must be labeled;
it cannot replace the public-path or native-plugin check.

When a failure occurs, distinguish provider/HTTP status, locale/encoding, conversion
and transition stages. Capture the visible error and whether loading settles. An
error screenshot without city, artifact or request identity does not establish a
particular release's cause. Update the evidence matrix with passed, failed, blocked
or not-run outcomes; do not turn a missing native run into a passing mock result.
