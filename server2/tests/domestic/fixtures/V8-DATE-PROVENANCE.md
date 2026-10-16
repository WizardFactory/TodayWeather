# S15b-4b-1 V8 `Date.parse` corpus

This is test data only. The server2 runtime never reads it.

`v8-date-parse.json.gz` holds `Date.parse` results of the legacy runtime over a deterministic
corpus of 20,048 strings; 2,095 of them parse to a number. The test
`server2/tests/domestic/v8_date.rs` checks that the port `server2::domestic::kma::dateparse`
returns the same value for every string.

| Item | Value |
| --- | --- |
| sha256 | `9411254a1d5a85dde50c1c6dc93c7409e485e2324cfde8cf7644723e2873f96e` |
| Generator | `v8_date_corpus.js` (sha256 `92d6c0c552c1eb813b041b181e7e8b0550a3de220c5ac82a23d03756546031e4`) |
| Runtime | Node.js `v16.20.2` (V8 9.4), `TZ=UTC`, the S15 oracle runtime |
| Command | `TZ=UTC node v8_date_corpus.js \| gzip -9n > v8-date-parse.json.gz` |

The generator uses a fixed mulberry32 seed. Each case is `[UTF-16 code units, value or null]`;
`null` is `NaN`. The corpus covers:

- ES5 ISO forms, including out-of-range fields;
- the KMA page forms;
- legacy forms with month names, AM/PM, zone names and offsets, parentheses and every numeral
  length class;
- whitespace and line terminators, NUL and unpaired surrogates.

The port follows `deps/v8/src/date/dateparser.h`, `dateparser-inl.h` and `dateparser.cc`, and
`ParseDateTimeString`, `MakeDay`, `MakeTime` and `MakeDate` in `src/builtins/builtins-date.cc` of
Node.js `v16.20.2`. V8 is BSD-licensed; the notice is kept in `src/domestic/kma/dateparse.rs`.
