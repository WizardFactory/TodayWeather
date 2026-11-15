Task: issue-2614-bounded-shadow; owner: Codex /root; base: 9b3a362e8b84a8f555fc6e475bed41d508f42462; endpoint: pre-merge.

Authority: AK approved seven-day/6000GET-HEAD/35USD AWS+5USD providers/onehost and HOTL; Nov13 explicitly waived prior shared-headroom proof and asked moderate shared-key use. No production deployment/device sends.

One PR owns the bounded HTTP sampler, independent tests, CI invocation and operator documentation. No changes to existing loopback-only harness or Rust runtime. Runtime candidate pin remains ef145fba/server2treef15d5b3; the sampler itself gets its own candidate digest.

1. Validate manifest/origin/route boundary and dry command; fail malformed scope before creating state or networking.
2. Add durable per-origin admission and exclusive ownership; test uncertain crash, changed manifest, caps and expiry.
3. Add bounded direct HTTP capture and sequential schedule; test redirect/auth/quota/oversize/timeout and conditional headers through two real local origins.
4. Document actual CLI examples and limits, run separate end-to-end CLI smoke, placement/artifact checks, review and CI.
5. Parent root owns the connector: cloud process lifetime/cost/source retention/independent cleanup and final pinned exact URL manifest before SHADOW-RUN. This PR does not claim those gates or seven-day qualification.

Scenarios: operator previews all5852pairs without networking; operator captures successful GET and HEAD against two local peers; abrupt death after reservation consumes that attempt across resume; a redirect/429 does not cause a second request; a missing validator is explicitly skipped; an unauthorized route or concurrent process sends zero requests. Each maps to BOUND/RECOVERY/EVIDENCE and the focused test suite, with a separate real CLI smoke. Temporary local servers/state are cleaned; retained reports contain no secrets. No Rust build/cache cleanup required.
