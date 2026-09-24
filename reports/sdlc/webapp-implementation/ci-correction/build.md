# CI mobile deletion synchronization

Remote run 35999300336 on bb23a734 passed typecheck, all 39 unit/API tests and build, then failed one of 12 browser cases. The mobile case clicked delete and immediately reloaded without waiting for its asynchronous capability check and local removal. The CI trace starts reload about 33 ms after the click starts; the post-reload list still has two favorites. The other 11 cases, including the corrected dialogs, first claim, cache update and deletion error handling, passed.

The one-line test correction asserts that only one favorite remains before reload, then retains the original post-reload persistence assertion. It awaits observable application completion, with no arbitrary delay or weakened assertion. Application/runtime code, dependencies, configuration, diagrams and all other tests are byte-identical to QA-3. No rebuild is necessary; existing production bundles and 39-test/typecheck evidence remain applicable to their unchanged inputs. New browser checks and an independent focused verification bind this candidate.

Actual failed remote execution is retained as ci-red.txt and selected trace events as trace-extract.json. Raw downloaded CI traces stay under /tmp. Final published head/CI will be recorded in PR #2562; no merge/deployment is authorized.
