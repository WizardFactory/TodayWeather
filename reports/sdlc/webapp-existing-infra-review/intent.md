# Intent

Determine how the webapp can use current operating infrastructure without an additional persistent Node process or host. Inspect existing documentation and implementation, verify relevant read-only facts where available, and give a concrete migration recommendation with limitations.

Acceptance criteria:
- AC1: map every web read operation to an existing endpoint or browser-local function.
- AC2: distinguish historical topology from current configuration and observable browser CORS behavior.
- AC3: assess Web Push separately; preserve the user's mobile feature-parity requirement rather than silently excluding it.
- AC4: identify scoped changes, alternatives, required checks and residual release gaps without changing runtime or deployed resources.

No external mutation is authorized by this review. Read-only AWS control-plane queries and a bounded set of public GET requests support the assessment. Credentials and full response payloads are excluded from durable evidence. Risks include stale deployment documents, missing CORS on error paths, double unit conversion, lost adapter safeguards and incompatible native notification identities.
