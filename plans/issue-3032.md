# Bundled town search implementation

Baseline: dc90829466702b929858b443771c41c879f1d9d5. [Intent](../intent/issue-3032.md) and [contract](../specs/issue-3032.md) govern one PR against master. The coordinating agent owns the shared loader, tests and simulator.

1. Establish the old path with a hosted Start search probe and retain baseline Release samples.
2. Add typed fixture decoding in TWDomain. Keep TownSearch pagination and selection unchanged. AppLaunch owns a lazy loader whose state is main-actor isolated. A detached task reads and decodes. An ordinary main-actor Task would inherit isolation and cannot replace the detached operation. Consumers get a shared pending task or completed value. Clear in-flight state after both outcomes and cache a successful result, including an empty list.
3. In PlaceQuery, keep Google and local work independently cancellable. Cancel each request on edit or reset. Retain synchronous filtering for a warm immutable cache. Check cancellation before publishing a loaded page. Clear obsolete queries at visit boundaries. Update existing hosted fixtures and retain explicit tests for suspension, shared loading, retry and parity.
4. Run package and hosted regression tests, plus the existing search/select flows as functional smoke. Run the paired Release probe with the real Start view and assert that the current result becomes visible. Retain the raw results and boundaries. Review the exact pushed revision and CI.

The observations cover a Start visitor with and without Google, a Saved Places visitor who cancels during a paused load, and a developer measuring a cold local query. The flows cover AC1 through AC3 in the scenario record. Roll back by reverting the PR. No persistent state or resource migration is required.
