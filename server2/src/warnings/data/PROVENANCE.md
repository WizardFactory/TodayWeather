# Warning zone table provenance

`kma_warning_zones.csv` is a byte-identical copy of
`server/utils/data/kma_warning_zones.csv` at repository revision
`ca8735cf937a634e7af57396d605e26db8bfc4ff` (introduced for #2609 in `fcdabc1e`).

- SHA-256: `c796c7d22d3c336b8d21172998b54788c6cf46c0c1df34ec6a66810421074ed2`
- Upstream: KMA 기상특보 조회서비스 OpenAPI guide, 특보구역코드안내 (260601), Sheet2, as
  recorded in the file header. Repository license applies to the copy (MIT).
- Runtime use: `server2/src/warnings/zones.rs` embeds it with `include_str!`; server2 never
  reads the legacy file.

Update both copies only through a reviewed zone-table change; legacy keeps its own copy
during coexistence.
