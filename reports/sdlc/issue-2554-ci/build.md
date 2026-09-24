# CI implementation

Added a standalone push/PR workflow using pinned official actions, Node22 and UTC. Executes dependency-free regression checks before installing four smoke-only packages under RUNNER_TEMP and running all full-response cases. Least-privilege read token; credentials are not persisted. Legacy Travis, server package definitions and runtime source are unchanged. README documents CI and operator-confirmed UTC. No architectural flow change.
