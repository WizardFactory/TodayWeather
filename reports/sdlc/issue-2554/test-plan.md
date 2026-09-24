# Test plan
AC1: parser tests all eight English codes plus unknown/absent while retaining wfEn.
AC2/AC3: actual whole-module getShortRss with V1 and V2 projection code, query boundary doubles, all eight numeric directions, invalid boundary 8/fractions, missing/null/nonfinite/string/sentinel sources, zero and negative real temperature, absent optional fields.
AC4: publication newer/equal/older, exact/past/future, first-only future, midnight and min/max source guard. Run under UTC and America/Los_Angeles for time-helper behavior.
AC5: additional independent smoke runs actual v000903 controller route and downstream formatting/units on synthetic grids; no production services. Its exact environment/layer limits are recorded separately.
AC6: diagram artifact 9/9, browser containment and visual check; architecture link verification; independent code verification.
Command: node server/test/offline/rss-wind.test.js (Node 22.22.2, built-in test runner, no installed server dependencies). Expected red: wdEn=-1, wind undefined, first future skipped, source erasure and max-temperature guard. Unrelated dependency/setup failures are not intended red.
Cleanup: no runtime service startup, no DB/provider access. Optional smoke deps and harness isolated in /tmp; retain sanitized evidence and reviewed harness in task report/test source.
