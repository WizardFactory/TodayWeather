# Restore historical observations — issue 2564
Revision 1, 2026-09-24. Owner /root. Authority: AK requested proceed after evidence-backed issue review. Endpoint local implementation and verification; production deployment/backfill and remote publication excluded.

AC1: Restore missing station hourly observations for seven complete KST dates ending yesterday; connect stored values to the existing hourly API/client subset and yesterday comparison without synthesizing hourly measurements.
AC2: Merge official daily observations by their own KST date, independent of hourly humidity. Preserve valid existing observations, current/future forecasts, DB1/DB2 and mounted client contracts/units.
AC3: Validate date/station/finite field/QC inputs, page completeness, uniqueness and missing-only recovery; wrong or unavailable data remains an explicit gap. Repeated/concurrent runs cannot duplicate or degrade records.
AC4: Bounded request retry/concurrency and regular configured recovery; provider calls stay out of weather request handlers; bounded CLI reports actual readback gaps and failures.
AC5: Local regression, integrated smoke, independent verification and updated architecture/diagram/operator instructions. Live ASOS, production records and native runtime claims require separate actual evidence.

Default scope retains existing 41-slot three-hour hourly template and client comparison offset; daily history D-7 through D-1. Optional display expansion question is pending. One station collection is shared by nearby mapped towns with recorded distance/method/provenance. Exact incident onset remains unknown.
