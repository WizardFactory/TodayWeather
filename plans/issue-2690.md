# S05 implementation plan

1. Validate immutable format and dependency APIs from primary documentation.
2. Expected tests before codec implementation: exact bytes/full identity/limits.
3. Implement codec plus async transport contract and SigV4 HTTP S3 client.
4. Scripted loopback transport tests exercise 412/ambiguous outcomes/concurrent writers/corruption/deadlines.
5. Separate executable local HTTP smoke publishes binary and collision records, repeats PUT and restores them from empty client memory. No live AWS.
6. fmt/clippy/tests/release/placement/artifact checks; operator source/PDF/actual screenshot; commit/push/PR and independent review via root.

Scenarios: S1 normal exact archive/restore (AC1); S2 collision and revisable identity (AC1); S3 existing/ambiguous PUT (AC2); S4 corrupt and oversized input (AC2); S5 placement and real wire smoke (AC3).
