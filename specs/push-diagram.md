# Specification

AC1: One English architecture diagram with at most 12 primary nodes, showing device settings/token callback, CloudFront, service push routes, Mongo settings, alarm and alert jobs, weather enrichment, provider selection and device notification handling. Labels preserve real API paths and distinguish asynchronous scheduling from API calls. Supporting push-notifications.md contains endpoint and scheduling details, token preconditions and error behavior.

AC2: Pin repository baseline, cite current CloudFront read-only configuration and prior monthly log window. Explicitly mark worker deployment/provider delivery unverified; do not equate HTTP 403 observation with missing-token root cause. CloudFront push routing bypasses Gateway. No GET push-list or synchronous API-to-provider send is implied.

AC3: Author editable Archify JSON, generate standalone HTML with showcase 9/9 checks, run real browser containment at four packaged viewports, inspect both-theme screenshots and obtain independent fresh-context verification. Update architecture index. No code or configuration changes, no provider calls, no new test framework.
