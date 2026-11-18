# SR-5b resumable finish verification

The initial integrated offline replay used the SR-5a producer at
`6d078b1c` and the SR-5b working tree. It ran the real `provision.py finish`
command against a local AWS CLI stand-in, without an SSH identity. No remote
services were called. The fixture generated 11,707 attempts, 23,414 paired
files and 995,095,000 body bytes. The runner interrupted the second GET after
the first verified original had been retained, and reopened the same journal
and output.

- All paired hashes and all 509 original-version dispositions matched. The
  sealed inventory SHA-256 was
  `5bc559882aa37668f6ac711e769e39f39cbe5ccf9217781d1fa078d26c664fa1`.
- GET requests were 2 at interruption and 508 after resume. The completed
  replay remained at 508. Attempted body charge was 1,331,232,110 bytes after
  resume and remained unchanged after replay. Independent AWS control
  observations continued to use their protected allowance.
- The initial supervisor suite passed 174 tests. Focused checks added after
  the replay cover saved SSH evidence after fencing, interrupted local
  promotion, lost deletion acknowledgement, independently sealed raw
  inventory and dynamic finish reserve.
- The updated workflow diagram passed Archify validation, artifact provenance
  and browser execution. The diagram and the two-page operator PDF were
  visually checked. The manual's finish image shows selected fields of the
  actual 71-attempt offline CLI replay.

Full-matrix and disposable Linux verification for the final corrected
candidate are tracked independently of this preliminary offline evidence.
