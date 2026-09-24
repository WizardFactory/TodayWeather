# Self-verification
Candidate: see candidate.txt and change-record.json.
- Red: expected mode mismatch reproduced at the first New Relic import.
- Green: all 12 targeted environment startup checks passed.
- Post-refactor: 235 total regression checks (12 environment + 223 existing) and the existing gather functional smoke passed. No production dependency tree installed.
- Additional real smoke: actual uploaded file -> actual dotenv/bootstrap -> actual config. All 31 settings loaded, gather/DB2.0/port and JSON arrays/mappings confirmed without importing app or touching providers/DB.
- git check-ignore confirms .env, server/.env, server/.env.production excluded and example retained. File is byte-identical with mode 0600. git diff --check and local Markdown links passed.
- Diagram: Archify deliver 9/9 showcase, zero errors/warnings. Browser pass at 1440x900, 1600x1000, 1920x1080, 2048x1320 with no scrolling; both themes captured. Inspected actual 1440x900 light and 2048x1320 dark screenshots: labels/routes/cards readable, no clipping/overlap, new startup note contained. Visual review passed; correction rounds 0. Artifact digests in diagram-delivery.json, browser evidence in diagram-browser.json.
Limitations: actual Node10 runtime not executed (package declares >=10; source uses compatible syntax). No full legacy npm test, real app listener/startup, live provider/DB, deployed restart, or hosted CI. Missing normal/cert credentials remain unchanged. npm start regression intercepts New Relic and exits before side effects; it is not a full application smoke.
