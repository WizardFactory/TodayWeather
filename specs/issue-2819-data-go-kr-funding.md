# DataGoKr selected-attempt funding

For DataGoKr only, validate configured candidate identities first, then fund one logical unit for the selected key immediately before each eligible HTTP attempt. Do not reserve an unused candidate or a possible future retry. At most two actual HTTP attempts remain permitted, with current auth/quota/transient/terminal behavior and caller deadline.

If a selected key's BudgetStore returns known Exhausted, try the distinct next declared candidate without an HTTP attempt on the exhausted key. Do not rotate on Unknown, Corrupt, Transport, Clock or Deadline funding errors. A reservation/consumption that completes before cancellation stays spent: no refund or journal rewind. S08 block claims may exceed logical per-attempt units and are not wire counters.

CallReport must distinguish known local exhaustion from consumed HTTP attempts. KeyRing settlement uses success/actual provider rejection and known exhaustion with its existing compare-and-update guard, remembering a working key without overriding a concurrent valid advancement. Local funding denial does not increment provider HTTP attempts. Existing terminal funding-error metrics retain that meaning.

VisualCrossing still prepays its maximum two-attempt cost on its single key. Per-key/API policies, units, UTC/KST windows and unknown/fail-closed ownership remain unchanged. No operating allowance values are invented. Actual operating headroom and all production qualification remain open.

Acceptance AC1–4 and exclusions follow the intent. Required proof includes a one-unit available first key, an unused exhausted B, exhausted A to B and remembered B, all-exhausted/noHTTP, ambiguity/noHTTP, bounded actual retries/cancellation and VC regression. Additional functional smoke composes real acquisition/funding with owned HTTP and volatile conditional budget objects, separate from tests.
