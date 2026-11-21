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

## Sub-zone mapping table (`kma_warning_subzones.json`)

`kma_warning_subzones.json` is a byte-identical copy of
`server/utils/data/kma_warning_subzones.json` introduced for #3084 and mirrored in #3085.

- SHA-256: `1cafabb2c6145f47ce9bd5f1c2101faae6744b017b5e8c7e68e8758e778c9d3b`
- Upstream: KMA Weather Nuri (`weather.go.kr`) 특보구역 세분화 안내 붙임자료 (2026-06-01,
  `https://www.weather.go.kr/w/resources/pdf/warning_zone_detailed_guide_2.pdf`,
  PDF SHA-256 `eaf04636385cfc475dc2f7c6d5980ce00e8383f4c2442e6c6a5b61a9d5e38086`),
  supplemented with Incheon's 2026-07-01 district reform names and historical township
  aliases present in `areaNoKma.csv`. Repository MIT license applies to this copy.
- Runtime use: `server2/src/warnings/zones.rs` embeds it with `include_str!`; server2 never
  reads the legacy file.
