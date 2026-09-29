# Build correction 2
Inputs: initial independent findings in independent-initial.md (Claude), original plan and clarified user scope.
Resolved F1 hyphenated Chinese restoration strings; F2/F3 obsolete documentation statements; F4 local symlink replaced with ignored directory; F5 unused StoreKit and In-App Purchase declarations removed from both legacy native projects still copied by Gulp. No historical bundled www/vendor files changed. Added regression test exposes native and locale leftovers (7 pass, 1 intended fail before correction); all eight now pass. Smoke waits for queued informational popups to finish before capture.
Native declaration cleanup is a justified plan refinement within AK's explicit complete app-library removal, recorded on issue #2641. Server remains unchanged; #2642 separate.
Final source set and digest: candidate-v2.json. Native parsing evidence: native-projects.log. No native device build performed.
