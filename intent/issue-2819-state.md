# Prevent persistent push state poisoning (#2819 C1)

AK authorized implementing the reviewed sequence on 2026-10-18 and posting the review at https://github.com/WizardFactory/TodayWeather/issues/2819#issuecomment-6244183930. This first merge unit ends at pre-merge readiness; merging and production actions are excluded.

Public registration input currently can become unreadable durable state, panic the shared writer and prevent restart recovery. Reject invalid documents before commit, propagate decode errors without panic, retain corrupt acknowledged journal bytes and reflect writer/restore failure through readiness. Existing valid registration responses, ordered atomic journal ownership and no-retry delivery claims remain.

AC1: malicious nested keys, excessive depth and oversized records produce the route's store-error reply without durable changes; later valid changes still succeed. AC2: a bad journal record fails the entry atomically without panic, skipped sequence or storage rewrite. AC3: writer exit/panic and failed restore are not ready. AC4: normal typed EJSON, registration parity, conflict/reconciliation, restart and placement gates pass.

Scope: server2/config/tasks/Safety2819.json declares paths before edits. No legacy code/data dependency, mode flag, provider/quota lookup, live send, deploy or cloud mutation. S19/S20 and the rest of #2819 remain open.
