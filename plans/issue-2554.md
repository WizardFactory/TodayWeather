# Execution plan
Owner /root; notebook .planning/2026-09-24-issue-2554; canonical intent/spec share this ID.
1. Update collection Archify source to describe collector and guarded RSS response contract; validate/deliver/browser/visual check.
2. Add offline regressions for parser, actual V1/V2 projection/read and getShortRss. Record intended failures before source edits.
3. Fix two production files, with a small shared per-slot source validation helper inside controllerTown.js; repair first-future scan and tmx source guard covered by tests.
4. Run green/post-refactor and independent additional local response functional smoke (real controller/formatting, isolated storage/provider boundaries), across three grids/units and DB formats where applicable.
5. Update weather-collection/mobile-api docs; independent verifier challenges code and runs own checks; record local completion and limitations.
Blast radius: all older routes sharing ControllerTown RSS fallback. Riskiest: direction versus label-code confusion and sentinel/zero handling. Reject simple field rename (wd is not degrees), overwriting absent sources, and deriving components (new semantics).
No dependencies/configuration migration. Rollback is reverting the two controller edits; no DB rewrite. No production or remote actions. Tests require only Node for isolated harness; any temporary smoke dependencies stay outside repository.
