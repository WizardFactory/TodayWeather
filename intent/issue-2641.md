# Remove Cordova purchase functionality
Owner: /root. Source: #2641; AK explicitly requested implementation through pre-merge on 2026-09-29. HOTL: PROCEED within this scope.
Remove the advertising-removal menu and billing flows from TodayWeather. Preserve ordinary advertising. AK clarified there are no existing paid users and all payment functionality must be removed; no entitlement compatibility remains. Users must reach ordinary settings/weather/guide screens without billing services.
AC1: No purchase/restore/renewal/premium purchase entry or purchase route remains in maintained client screens.
AC2: Startup/navigation works without billing modules/plugins and initiates no billing or validation calls.
AC3: Maintained build inputs cannot reinstall billing plugins or restore purchase controllers; no dangling references.
AC4: Ordinary advertising works independently of any stale paid-app flag, purchaseInfo or twAdsInfo; no account-level or entitlement logic remains.
Allowed: implementation, tests/smoke, documentation, commit/push, PR/issue updates, CI reads, corrections and independent Claude verification/review using configured accounts. GitHub ak-ongyeol; implementation OpenAI host session; reviewer configured Paseo Claude/Anthropic host account. Only scoped code/tests/evidence may be transferred.
Excluded: merge, auto-merge, queue, deployment, account/permission changes, secrets transfer, store operations. AK explicitly limits implementation to the app; server receipt-validation retirement is a separate issue. Historical native bundles are not maintained build inputs.
Risk: removing Purchase affects ad gating and startup injection. Restore/renewal and entitlement compatibility are deliberately removed. No production action is authorized.
