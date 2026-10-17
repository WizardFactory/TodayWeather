# S20d plan and scenarios

1. Preserve the accepted widget endpoint and record actual legacy contract with isolated dependencies.
2. Add failing body-parity checks before native changes; share world acquisition, add raw-assembly branch and bounded native wire handler, wire it only for selected dsf.
3. Run parity/regression, then release owned-peer cold/warm/S3 restore smoke. Update inventory/manual/diagram and inspect rendered PDF.
4. Integrate reviewed S20c parent, pin final head/base/candidate, independent required medium and optional high reviews, full CI and reviewed main integration.

User scenarios: existing widget requests its gcode URL with recorded coordinates; cold native path returns byte-equivalent raw weather and no geocoder/legacy call (WIDGET,PARITY,NATIVE). Repeated request and process restart with providers down restore identical logical weather from S3 (RESTORE,NATIVE). Missing gcode returns400 without acquisition; provider exhaustion preserves503 with retryAt and no-store (PARITY). Conditional ETag request yields304 and HEAD has no body (PARITY). Operator includes WW outside historical19 and keeps cutover blocked without operational qualification (NATIVE).

Pinned owner: root; existing .planning/2026-10-13-server2-next-sequence-after-s10 notebook remains canonical. All changed paths declared in S20d.json before implementation.
