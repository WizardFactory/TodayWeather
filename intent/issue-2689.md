# S04 Rust foundation intent

Implement #2689 under `server2/` before later server2 assets. One Tokio multithread
API process shares bounded volatile state; a separate loopback metrics listener
never mounts on the public router. No providers, S3, weather ports or collectors.

AK accepted O-2/O-4/O-12 and demand/S3 decisions in
[#2614](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640).
The [path declaration](https://github.com/WizardFactory/TodayWeather/issues/2689#issuecomment-6009173855)
precedes edits. Complete at an unmerged PR against `feat/2614-server2` with independent
review and CI; no deployment, resource provisioning, live notifications or merge.

AC1: release binary serves legacy GET /health 200 OK with CORS, isolates metrics,
and enforces validated finite runtime/admission/CPU/cache limits without providers.
AC2: the local/CI placement gate catches undeclared changes, rename escapes, root
Cargo, legacy imports/resources/dependencies/symlinks, including unchanged tracked assets.
AC3: CI, reproducible isolated smoke, and actual usage manual document verified
behavior and foundation-only limitations.
