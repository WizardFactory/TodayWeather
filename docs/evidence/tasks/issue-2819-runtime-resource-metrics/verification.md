# Private native metrics: selected local evidence

Base: `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`, with the #2819 resource/metrics working candidate. This is source-bound local evidence, not production qualification or issue closure. Current local checks are recorded below; independent review and CI remain separate gates. Original failed invocations remain retained locally.

## Actual optimized flows

| Retained run | Report SHA-256 | Executable SHA-256 | Result |
| --- | --- | --- | --- |
| normal2 | `fb7a0397bf9ef4726dd92e7a4ea3bab7af854b1d7789b998e98de147f0cf1991` | `0ad01b2a501e7f0410f1351ce19c5f29affa7cd1ae4f9388dc6fa994ddb7eefa` | PASS |
| historical capacity2 | `c7b75e141df3cc2811dcfa37c04a345a58d5928ca5a852ddc97f7c96c0df2312` | `2cfd7f593c8900cd0ffbe1a95bb41a3faeca5d1dcb4d003894d8aa9b5e9a7f37` | PASS |
| current capacity3 | `98bef5503486320b5821b5780f5f013f3e884ff828b4de7c57a4dbdde5fa2089` | `f5f00dee6fb5d7600d71dbc77f1bd4838818e50d895cdb46f09f317da8d7ef1e` | PASS |

These runs used runner `5221608f2960a2af3f85cee2be17bea1bfaca655bd68f255ae3a26c2ee2a2c53`. Full before/after runtime source maps were unchanged; compiled Rust/runtime assets match the release compilation. The runner-only assertion correction after capacity1 did not change those assets. Capacity1 retained its failure when the assertion combined 2048 synthetic operations with three actual native successes; capacity2 measures the synthetic baseline before native traffic. Normal1/capacity1 remain distinct runs, not relabelled results.

Normal2 drove actual Gateway/DirectRoutes/native backend public HTTP with owned S3 and recorded VC/air peers, not a response-only double. Its cold request took30.55ms. Warm provider increments were zero; a fresh process restored byte-identical data with providers down, no extra VC/air attempts and no legacy hops. Private metrics exposed1769samples; public metrics stayed unmounted. Actual CPU completions included VC gzip1, VC parse1, world restore2, air parse1, S06 codec4 and control44. LOG_LEVEL=error filtered461lines while native counters advanced. These local observations do not establish a percentile or production latency.

Current capacity3 held one actual shared CPU permit, generated2048 separately counted synthetic successful operations, and left the owned stderr pipe unread. Before release: public501 in2999.17ms and VC/air attempts0. Private metrics remained available. After the holder actually completed: public200 and VC/air attempts1each. Logging reported queue_full628 and rate_limited3104; native metrics remained available before the pipe drained. Three subsequent native other successes are separate from the2048synthetic baseline. Holder completion, stderr drain, drainer join and retirement of every owned child were asserted; neither shutdown timeout nor an idle caller substituted for completion.

## Fixed bounds and coverage

Actual full-schema tests enumerate1719core series,1640newu64cells (1730with the conservative existing-view reserve),1790complete-private samples,131167ordinary rendered bytes and164735max-u64-width bytes including comments.72saturation series are explicit. Caps remain2048series,4096u64cells,512KiB. The owned normal composition's1769samples are not the all-view bound.

The shared path covers resource-aware VC/world/air/S06 work and one actual domestic collector. It does not claim all KMA/warning/AirKorea CPU work, D2/F2 injection or total process RSS/CPU. Existing standalone constructors retain their earlier ownership. S3 retains FIFO12permits and its earlier retry/funding rules. Logical byte counters are not AWS billing; HTTP timing ends at headers; relaxed counters are not a durable ledger. Partial publication ambiguity and no-resend rules remain authoritative.

## Manual and capture

[Editable operator guide](../../../operations/server2-runtime-metrics.md), [visually checked three-page PDF](../../../operations/server2-runtime-metrics.pdf), and [selected actual evidence image](metrics.png).

The browser images are labelled presentations of retained actual reports and private metric lines, not a live product dashboard or a new run. An owned loopback evidence-view server was retired after headless Chrome capture. PDF pages1-3 were rendered and individually inspected for cropping, missing content, glyphs and caption/result agreement. The overview image and detail captures contain only synthetic local evidence. PDF SHA-256 `918ffc0d681ace38ed0f37a5a2599053ac1c06d306cf41490dbb1a7852641a44`; overview PNG SHA-256 `987f9b87fe8d1a4957aca2f1aeeb7b7dbbb8abbd8f38d1ad08776ab2d5a152c9`. The current capture uses normal2 and capacity3. Original manual1/capacity2 images remain retained separately. Detailed JSON, raw metrics, command/source manifests, capture receipts and page renders remain in ignored task reports; this maintained record does not require local report links.

No live providers, AWS resource operations, device sends, deployment, production log pressure, seven-day shadow or merge was performed. Host/IAM/SigV4/TLS/quota headroom, operational thresholds and both genuinely eligible full recovery releases remain separate gates.

## Current source, regression and format checks

The final implementation map contains753server2inputs (`0a386c96321fbec98ac079ee0e652f0a4764e9c3a99ea0d1a28c48f43bf70eb8`). Since the original regressions and normal2 run, only the separate capacity example changed: equivalent argument-pair syntax required by Clippy. Runtime/library/tests/fixtures/normal example/runner stayed byte-identical, and the rebuilt normal binary is byte-identical. Capacity3 was executed on the fresh current example and compile map. No new normal run is claimed.

The default-concurrency eleven-target command exited101:633passed,4failed,6ignored. Domestic accounted for the4failures; all10other targets passed. Each failed selector passed alone with the same source/deadline/assertions, then the complete domestic target passed under `--test-threads=1`:168passed,2ignored. Combining the other10targets with that explicit serial domestic run gives637passed/6ignored; this was not one all-green default-concurrency whole invocation. The original failure and diagnosis remain. Transport/address/connection errors occurred among mixed intentional-fault tests; cross-test resource pressure is consistent with observations, but its exact cause remains unresolved. Default-concurrency stability is a material local verification limitation.

Current all-target Clippy with warnings denied and format check passed. The focused21feature checks are included in the broad totals, not added again. Retained executables and actual `--list` checks preserve five test inputs independently of the shared Cargo target. This does not make those test binaries a portable earlier release.
