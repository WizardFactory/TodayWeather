# Complete finite admitted push cohorts across minutes

Address the minute-boundary notification loss in [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819), including C3 alarms and the minute-refusal trigger within C2 conditional alerts. Existing workers may select and durably claim a recipient list, then refuse later members solely because earlier work crossed the UTC minute. Allow that finite cohort to complete while preserving token/registration checks, configured alert windows, clock failure/rollback refusal and shutdown admission.

Do not select new members, catch up stale queued ticks, replay claims after restore, retry actual failed/unknown sends or invent a capacity-based product expiry. Preserve current per-cohort concurrency and operation bounds. An alert must stay in its same actual admitted configured window occurrence; a later day's window does not revive it. Alarms have no new lateness cutoff: no operational lateness SLA is claimed or approved for a suspended live process.

The parent C2 task separately owns safe state compensation after definite no-POST. This child does not claim all refused alerts remain retryable or that six-hour suppression is fixed for other refusal causes. No deployment, live notification or global #2819/#2704/#2705/shadow/rollback qualification.
