# Build
Pinned dotenv 10.0.0 as runtime dependency; app requires config/env before New Relic. The bootstrap uses an absolute server-relative path, preserves existing environment, permits ENOENT, and sanitizes other read failures. Added 12 focused regression checks, offline runner and CI dependency wiring, ignore rules, sanitized example and configuration documentation. Uploaded environment remains local, mode 0600, byte-identical and ignored; no credential substitution.

Candidate file set and content digest are in change-record.json; actual diff is changes.patch. Private .env is excluded from all source receipts. Red observed local rather than gather before New Relic; green passed 12 checks.

Deviation: server/README.md is an existing symlink to root README.md. Preserved both originals and placed the planned server documentation in server/CONFIGURATION.md instead. No source contract changed from the spec. Existing diagram JSON adds only a checkout-startup note; deployed observations and original revision remain explicitly historical.
