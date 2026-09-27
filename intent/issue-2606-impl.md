# Intent: #2606 implementation (pre-merge)

Source: AK, 2026-09-27: "구현진행", then "Premerge까지, 다만 다른 provider 모델 리뷰는 skip". Design inputs: [intent/issue-2606.md](issue-2606.md), [specs/issue-2606.md](../specs/issue-2606.md) (revision 12), [test scenarios](../specs/issue-2606-test-scenarios.md), [plan](../plans/issue-2606.md), and issue [#2606](https://github.com/WizardFactory/TodayWeather/issues/2606) as updated on 2026-09-26 and 2026-09-27 (single Google key).

## Outcome

`server/` serves the public `weather/*` and `geocode/*` routes that had traffic, with Lambda-identical successful responses per version. The four internal callers use versioned geocode URLs. The change is delivered as a pull request that is ready to merge. It is not merged and not deployed.

## Acceptance criteria

- **AC1 Routes and versions:** R1–R5 and X1 behave as spec §2–§3.1. RT-1–RT-16 pass.
- **AC2 Geocoder:** the port matches the tw-backend-functions `a4c1deb` goldens, with timeouts and key rotation (spec §3.4–§3.5). U-1–U-10 and U-16–U-18 pass.
- **AC3 Cache:** the spec §3.6 rules hold. U-11–U-15 pass.
- **AC4 Internal callers:** the four URL changes are made and the existing tests are updated. IC-1–IC-3 pass, and `npm run test:offline` passes.
- **AC5 Local functional smoke:** LD-1 passes with real `bin/www` and mongod, or is reported as not run with the concrete missing prerequisite.
- **AC6 Operator tooling:** `scripts/gateway-parity.mjs` exists, makes no network call in its self-test, and its self-test passes.
- **AC7 Docs:** DOC-0 is done (`configuration-inventory.md` names). The spec, test scenarios, plan and intent are in the PR.
- **AC8 Pre-merge:** the PR is open against `master`, CI is green, the independent verification is recorded, Must Fix items are resolved, and a merge-ready receipt is recorded with `merge_authorized: false`. Per AK, there is no cross-provider model review.

## Exclusions

These are production steps under spec §5.1 A1–A4: provider keys, host deploys, the `AttachEIPToSpot` change, AMIs, the alarm, the CloudFront cutover and post-cutover docs (DOC-1). Merging is also excluded.
