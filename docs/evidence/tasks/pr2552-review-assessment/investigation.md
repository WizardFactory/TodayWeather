# Assessment of PR #2552 follow-up review

Overall: recommendations are useful, but S3 privacy is not fully established, and the push diagnosis/logging procedure needs qualification. This is the author's evidence assessment, not an independent/cross-provider PR review or merge-ready verdict.

## S3 requirement: partially verified; retain a follow-up

Live read-only observations on 2026-09-23, 08:04–08:06 UTC are retained in s3-public-access.json (use its exact timestamps). Both bucket and account return NoSuchPublicAccessBlockConfiguration. GetBucketPolicyStatus returns NoSuchBucketPolicy. Bucket ACL has two CanonicalUser FULL_CONTROL grants and no AllUsers or AuthenticatedUsers grants. Ownership controls are absent. These facts do not mean the bucket is public; they also do not establish that all object ACLs are private.

Unsigned ListObjectsV2 returned 403 AccessDenied. One actual log object from each of August 23, September 22 and September 23 had only CanonicalUser ACL grants; unsigned HeadObject returned 403 for all three. Keys are represented by SHA-256, no object bodies were downloaded. No current public exposure was observed in this bounded sample. The complete bucket/object/access-point/organization configuration was not audited. Bucket-level blocking should be considered as a separate authorized hardening change, with current CloudFront log-delivery ACL requirements preserved; it was not changed here. A bucket name in a public branch is already disclosed, regardless of merge, but is not an authentication secret.

Reference: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html explains effective settings and ACL/policy distinctions.

## Recommendations for this PR

1. Accept as a dated open question. The aggregate has 38,069 Android-like requests among 155,998 unversioned weather requests; unversioned weather is 70.72% of 220,583 product API requests. Exact weather/coord builders found in this checkout are the two iOS widget files, while the shared app builds versioned paths. A missing Android source or old released build is plausible, not proven by a user-agent heuristic. Add the discrepancy to evidence.md. An AGENTS note must bind traffic percentages to this 30-day window and v000901 fallback to the existing dated Lambda observation, not imply historical route-to-backend correlation for every request.
2. Accept: aws-code-correlation.md and evidence.md currently do not link the monthly report. These are navigation improvements, not an incorrect aggregate.
3. Accept as audience preference, not a time-calculation defect. Keep UTC daily boundaries. The equivalent KST window is 2026-08-24 04:53:45 <= time < 2026-09-23 04:53:45. Existing Europe/Berlin rendering is correct but less convenient for Korean operations.
4. Accept as portability improvement, not missing documented access. ec2-access.md explicitly says /tmp is temporary and supplies boto3 fallback. Add durable CLI installation prerequisites and official installation reference when editing; distinguish CLI v1 observations from CLI v2 features. No installation was performed.

## Separate push work: useful hypothesis, with corrections

- Source confirms _updateFcmToken sends newToken/oldToken and updates in-memory fcmToken immediately without persistence or failure rollback (client/www/js/service.push.js:292–314). init only calls it when the new token differs (line 814). savePushInfo writes the entire pushData2 at line 149, through settings/update/removal/migration-related paths; the exact condition is absence of a saved token, not simply absence of alarms.
- An isolated Node VM using the actual shared service source and stubbed HTTP/storage/Firebase confirmed: first callback sends oldToken=null; repeated same-token callbacks in the same instance send no further PUT; a different token uses the previous in-memory token; recreating the service without a save again sends null; an explicit save prevents the same-token PUT after recreation. No network/provider/device interaction occurred. See token-reproduction.json.
- Therefore replace 'every token callback' with 'a callback after initialization without a persisted token can repeat across app sessions'. This remains a plausible explanation for some 403s, not a proved cause of logged production requests or all shipped clients.
- The review's suggested `invalid body` log count is not directly supported: routePushNotification.js:151 only sends that text as a response, without a corresponding log call. Line 110 logs the PUT request body, which contains device tokens. An origin-side check would need the deployed source/logger configuration and timestamp-aligned request/status aggregates, with token-presence booleans rather than copying raw bodies. No SSH/log access was performed in this assessment.
- Clarify denominators: monthly 403-only rate is 16,337/18,872 = 86.57%; all 4xx/5xx are 96.29%. Daily 403 rates vary (September 15 95.78%, September 21 96.43%, September 22 partial day 92.80%). The issue predates/outlasts the September 16–20 incident; this does not prove complete causal independence.
- Persisting a token alone will not remove the first invalid PUT. A fix should separate initial token acquisition from replacement, skip replacement when no old token exists, persist local state deliberately, and preserve pending server synchronization/retry semantics if replacement fails. Such behavior changes belong in separate tested work.

## Other server findings

DELETE truthiness is confirmed at controllerPush.js:205–210 and alert.push.controller.js:1012–1017; cityIndex=0 can widen deletion across a token's records. This potential data-loss behavior deserves priority in a separate fix. Batch save error swallowing is confirmed in route.push.update.list.js:47–62: callbacks discard save errors, allowing HTTP 200 despite failure. The 12 legacy POST 500s are an observed failure requiring diagnosis, not proof of a particular implementation bug.

The review comment says the September 16–20 event is a confirmed EC2-internal issue. That is reviewer-supplied context; this task did not independently verify an incident record. Keep the report's timestamped observations, and avoid silently turning this assertion into a newly proved root cause.

## Scope and limitations

Read-only GitHub/source/AWS configuration and sample ACL/anonymous metadata checks plus isolated source execution. No app changes, SSH, production request bodies, notifications, settings mutations, commits, pushes or PR replies. No new diagram is needed for assessment of existing notes. Independent review is not claimed; this bounded review-only assessment does not require a separate verifier. Original PR independent documentation evidence remains separate.
