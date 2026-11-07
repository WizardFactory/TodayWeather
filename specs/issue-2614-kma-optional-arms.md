# Acceptance for supplementary KMA inputs

- **LIFE:** under the observed source, a life acquisition that has not ended does not hold the snapshot once its required inputs are in: with stored forecast inputs the snapshot returns well before the life bound (2.5 s after the start), answering the life data held (none here). The acquisition continues, and a later snapshot answers what it published. Checked by `tests/domestic/life_s3.rs`.
- **NARRATIVE:** under the observed source, a narrative read that ends at once is in the answer. A read that does not end answers no narrative and does not hold the answer: it comes back well before the narrative bound of 2.9 s. Checked by `tests/domestic/full_response.rs`.
- **LEGACY:** the legacy-path source and the life and narrative tests that use it pass unchanged.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a life read or acquisition that fails leaves the held data (or none) and is retried as before. A narrative read that fails or ends late leaves the answer without a narrative, as when no narrative exists.
