# S15b-4b-1 V8 `Date.parse` corpus

This is test data only. The server2 runtime never reads it.

`v8-date-parse.json.gz` holds `Date.parse` results of the legacy runtime over a deterministic
corpus of 20,388 strings; 2,226 of them parse to a number. The test
`server2/tests/domestic/v8_date.rs` checks that the port `server2::domestic::kma::dateparse`
returns the same value for every string.

| Item | Value |
| --- | --- |
| sha256 | `7e6866153fba48bb35d5cb1b2e7c67491590db2a21d5a99cb5168e2adab4f634` |
| Generator | `v8_date_corpus.js` (sha256 `da40791b4bf4d5d95977132177f95aeeb7753a5a606505eeee62d48075493418`) |
| Runtime | Node.js `v16.20.2` (V8 9.4), `TZ=UTC`, the S15 oracle runtime |
| Command | `TZ=UTC node v8_date_corpus.js \| gzip -9n > v8-date-parse.json.gz` |

The generator uses a fixed mulberry32 seed. Each case is `[UTF-16 code units, value or null]`;
`null` is `NaN`. The corpus covers:

- ES5 ISO forms, including out-of-range fields;
- the KMA page forms;
- legacy forms with month names, AM/PM, zone names and offsets, parentheses and every numeral
  length class;
- whitespace and line terminators, NUL and unpaired surrogates;
- the TimeClip limits (±8.64e15 ms) in each grammar, with adjacent milliseconds and offsets
  that move an instant across them, and zone offsets whose minute arithmetic wraps 32 bits.

The port follows `deps/v8/src/date/dateparser.h`, `dateparser-inl.h` and `dateparser.cc`, and
`ParseDateTimeString`, `MakeDay`, `MakeTime` and `MakeDate` in `src/builtins/builtins-date.cc` of
Node.js `v16.20.2`. V8 is BSD-licensed; the notice is kept in `src/domestic/kma/dateparse.rs`.

## `req.query` corpus (qs 4.0.0)

`qs-parse.json.gz` holds `req.query` from the legacy Express 4.13.4 query parser over a
deterministic corpus of 8,025 query strings. The parser is `compileQueryParser('extended')`, which
calls `qs` 4.0.0 with `allowDots: false` and `allowPrototypes: true`. The test
`server2/tests/domestic/qs.rs` checks that `server2::domestic::kma::qs::parse` gives the same
`JSON.stringify` and the same property reads, including reads that go through a prototype.

| Item | Value |
| --- | --- |
| sha256 | `84c57d9e85ab376edf8c3548294e59bca0055040c412ebd389e1deb35466236b` |
| Generator | `qs_corpus.js` (sha256 `3385543c4e1d05f4c0cc15511f83d95c877da5280a315135180bdf5ed56bddbf`) |
| Runtime | Node.js `v16.20.2`; `express` 4.13.4 with its `qs` 4.0.0, from the S15 oracle installation |
| Command | `EXPRESS_DIR=<express dir> node qs_corpus.js \| gzip -9n > qs-parse.json.gz` |

The corpus covers:

- bracket nesting beyond the depth limit and array indices around the limit;
- `__proto__` and other `Object.prototype` names;
- empty keys and repeated keys;
- malformed escapes and `+`;
- characters in the stand-in range and encoded surrogates.

The `qs` port follows `qs/lib/parse.js` and `qs/lib/utils.js` 4.0.0 (BSD-3-Clause).
