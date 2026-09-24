# QA-4 focused verification

Task webapp-implementation; independent-verification iteration 4 of maximum 10 (six remain afterward). Builder /root, independent verifier /root/webapp_qa. Endpoint: existing authorized PR #2562 correction update; no merge/deployment/remote publication or further delegation by QA.

Frozen candidate sha256:581c30a167923fe326d94e33be92c72ff50511b7e6037f6388833707d73977e1, base 01eb787b10cc2694ea52642b8b24ad8c5426503e, prior head bb23a7345d93f3435ff21669667f6f82ef09ebf2. This is a single additional assertion in web/e2e/web.spec.ts: await one remaining favorite before reload, retaining after-reload persistence assertion. Confirm all other 64 manifest files and runtime bundles remain equal to QA-3.

Read ci-correction candidate/build/changes.patch/ci-red/trace-extract/self-verification/test-results and existing upstream contracts. Assess whether the correction fixes actual asynchronous test sequencing without concealing a product defect. Independently execute the affected mobile case (three repetitions sufficient), plus inspect prior QA-3 applicability. Main has run ten repetitions and full 12-case smoke; do not repeat unrelated passing checks without a new concern.

Source/state/notebook are read-only. Write only ci-correction/qa-4.md, qa-4.json and qa-4-*.txt/json evidence; use /tmp for isolated config/probes/screenshots. Use separate loopback demo BFF port, preserve source and original evidence, and avoid external providers/native/collector startup. No credentials, commits/push or PR mutation. Return actual input hashes, commands/results, findings/limitations, verdict and reuse justification. Same-provider verification only, not cross-provider PR approval. Target focused completion within three minutes; report mandatory defects immediately.
