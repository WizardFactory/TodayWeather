//! Demand-only full-window replay. A targeted S06 lookup is checked against a complete,
//! pinned day-catalog enumeration; this is an observed view, never a global watermark.
use super::{
    Doc, Val, pages,
    rainfall_store::{KST, POLICY, digest},
    stations::{RowStore, date_of},
};
use crate::{
    domestic::publication::Publication,
    history::schedule,
    storage::{
        Catalog, CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Envelope,
        Error, PageOutcome, ProviderKey, RawRecord, sha256,
    },
    summary::InputId,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
use tokio::{
    sync::OwnedSemaphorePermit,
    time::{Instant, timeout_at},
};

pub(super) const MAX_ACQUISITIONS: usize = 256;
pub(super) const MAX_RAW: usize = 16 * 1024 * 1024;
const MAX_PAGE: usize = 1024 * 1024;
#[derive(Debug, Clone)]
pub(super) struct Current {
    pub grid: [u16; 2],
    pub end: u64,
    pub pty: f64,
    pub rn1: f64,
    pub digest: String,
}
impl Current {
    pub fn from_docs(
        grid: [u16; 2],
        docs: &[Doc],
        ids: Option<&[InputId]>,
        now: f64,
    ) -> Option<Self> {
        let ids = ids?;
        let doc = docs.last()?;
        let current = doc.get("currentData")?.as_doc()?;
        let date = current.get("date")?.as_str()?;
        let time = current.get("time")?.as_str()?;
        let p = Publication::parse_compact(&(date.to_owned() + time))?;
        if !now.is_finite()
            || p.minute() != 0
            || p > crate::domestic::publication::current_base(now as i64)?
        {
            return None;
        }
        let utc = schedule::to_ms(p);
        if doc.get("fcsDate") != Some(&Val::Date(utc as f64))
            || current.get("mx") != Some(&Val::Num(f64::from(grid[0])))
            || current.get("my") != Some(&Val::Num(f64::from(grid[1])))
            || !ids
                .iter()
                .any(|i| i.family == "ultra-srt-ncst" && i.start_ms == utc && i.end_ms == utc)
        {
            return None;
        }
        let end = u64::try_from(utc).ok()?.checked_add(KST)?;
        let pty = current.get("pty")?.as_num()?;
        let rn1 = current.get("rn1")?.as_num()?;
        if !pty.is_finite() || !rn1.is_finite() {
            return None;
        }
        let bindings: Vec<_> = ids
            .iter()
            .map(|i| {
                json!([
                    i.family,
                    i.start_ms,
                    i.end_ms,
                    i.fetched_at_ms,
                    i.content_sha256
                ])
            })
            .collect();
        Some(Self {
            grid,
            end,
            pty,
            rn1,
            digest: digest(json!([
                "rns-current-v1",
                POLICY,
                grid,
                end,
                sha256(&doc.json().to_bytes()),
                bindings
            ])),
        })
    }
}
#[derive(Debug, Clone)]
pub(super) struct Minute {
    pub sensor: f64,
    pub values: Vec<Option<bool>>,
    pub digest: String,
}
#[derive(Debug, Clone)]
pub(super) enum MinuteResult {
    Ready(Vec<Minute>),
    NotEligible,
    Incomplete,
    Unavailable,
}
struct Pin {
    id: CatalogId,
    object: Option<ControlObject>,
    generation: Option<u64>,
}
fn raw_tuple(e: &Envelope) -> Value {
    let i = &e.identity;
    json!([
        i.source,
        i.kind,
        i.key_sha256,
        i.period.local_date,
        i.period.slot,
        i.fetched_at_ms,
        i.raw_sha256
    ])
}
fn publication(e: &Envelope) -> Option<Publication> {
    let i = &e.identity;
    Publication::new(i.period.local_date, i.period.slot.parse().ok()?)
}
async fn get<T: CatalogTransport>(
    t: &T,
    key: &str,
    deadline: Instant,
) -> Result<Option<ControlObject>, Error> {
    match timeout_at(deadline, t.get_control(key, MAX_PAGE))
        .await
        .map_err(|_| Error::Timeout)?
    {
        Ok(v) => Ok(Some(v)),
        Err(Error::NotFound) => Ok(None),
        Err(e) => Err(e),
    }
}
pub(super) async fn read<T: CatalogTransport + Clone + Send + Sync + 'static>(
    transport: &T,
    store: &CatalogStore<T>,
    current: &Current,
    sensors: Vec<f64>,
    cutoff: u64,
    deadline: Instant,
    guard: Arc<OwnedSemaphorePermit>,
) -> MinuteResult {
    match read_inner(transport, store, current, sensors, cutoff, deadline, guard).await {
        Ok(v) => v,
        Err(Error::Corrupt(_) | Error::NotFound) => MinuteResult::Incomplete,
        Err(_) => MinuteResult::Unavailable,
    }
}
async fn read_inner<T: CatalogTransport + Clone + Send + Sync + 'static>(
    transport: &T,
    store: &CatalogStore<T>,
    current: &Current,
    sensors: Vec<f64>,
    cutoff: u64,
    deadline: Instant,
    guard: Arc<OwnedSemaphorePermit>,
) -> Result<MinuteResult, Error> {
    if sensors.is_empty() || sensors.len() > 1024 {
        return Ok(MinuteResult::NotEligible);
    }
    let end = current.end;
    let start = end
        .checked_sub(3_600_000)
        .ok_or(Error::Invalid("rainfall window"))?;
    let first = schedule::from_ms(start as i64 - KST as i64);
    let last = schedule::from_ms(end as i64 - KST as i64);
    let mut days = BTreeSet::from([first.date(), last.date()]);
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    let key_sha256 = sha256(&key.canonical_bytes()?);
    let mut pins = Vec::new();
    let mut selected = Vec::new();
    let mut admission = Admission::default();
    for day in std::mem::take(&mut days) {
        let id = CatalogId {
            source: "kma-web".into(),
            kind: "aws-minute".into(),
            key_sha256: key_sha256.clone(),
            partition: day.to_string(),
        };
        let object = get(transport, &id.key(), deadline).await?;
        let mut generation = None;
        if let Some(o) = &object {
            let catalog = Catalog::from_bytes(
                &o.body,
                &id,
                &CatalogLimits {
                    control_bytes: MAX_PAGE,
                    entries: 2048,
                    ..CatalogLimits::default()
                },
            )?;
            generation = Some(catalog.generation);
            for e in catalog.entries {
                if e.identity.period.local_date != day {
                    return Err(Error::Corrupt("rainfall catalog publication day"));
                }
                let p = publication(&e).ok_or(Error::Corrupt("rainfall minute publication"))?;
                let wall = u64::try_from(schedule::to_ms(p))
                    .map_err(|_| Error::Corrupt("rainfall minute date"))?
                    .checked_add(KST)
                    .ok_or(Error::Corrupt("rainfall minute date"))?;
                if wall > start && wall <= end && e.identity.fetched_at_ms <= cutoff {
                    admission.include(e.raw_length)?;
                    selected.push((id.clone(), e));
                }
            }
        }
        pins.push(Pin {
            id,
            object,
            generation,
        });
    }
    selected.sort_by(|a, b| {
        let a = &a.1.identity;
        let b = &b.1.identity;
        (
            a.fetched_at_ms,
            &a.raw_sha256,
            a.period.local_date,
            &a.period.slot,
            &a.source,
            &a.kind,
            &a.key_sha256,
        )
            .cmp(&(
                b.fetched_at_ms,
                &b.raw_sha256,
                b.period.local_date,
                &b.period.slot,
                &b.source,
                &b.kind,
                &b.key_sha256,
            ))
    });
    let mut raws: Vec<RawRecord> = Vec::with_capacity(selected.len());
    let mut total = 0usize;
    for (id, e) in &selected {
        let PageOutcome::Ready(page) = store.lookup_acquisition(id, &e.identity, deadline).await?
        else {
            return Ok(MinuteResult::Incomplete);
        };
        if page.excluded_groups() != 0
            || page.acquisitions().len() != 1
            || page.acquisitions()[0].records().len() != 1
        {
            return Ok(MinuteResult::Incomplete);
        }
        let r = &page.acquisitions()[0].records()[0];
        if r.envelope
            .pagination
            .as_ref()
            .is_some_and(|p| p.page != 1 || p.pages != 1 || !p.complete)
        {
            return Ok(MinuteResult::Incomplete);
        }
        if r.envelope.identity != e.identity || r.bytes.len() > MAX_PAGE {
            return Err(Error::Capacity);
        }
        total = total.checked_add(r.bytes.len()).ok_or(Error::Capacity)?;
        if total > MAX_RAW {
            return Err(Error::Capacity);
        }
        raws.push(r.clone());
    }
    // Recheck the exact metadata view, including confirmed absent day catalogs.
    for pin in &pins {
        let after = get(transport, &pin.id.key(), deadline).await?;
        if match (&pin.object, &after) {
            (None, None) => false,
            (Some(a), Some(b)) => a.body != b.body || a.etag != b.etag || a.version != b.version,
            _ => true,
        } {
            return Ok(MinuteResult::Incomplete);
        }
    }
    let catalog_bindings: Vec<_> = pins
        .iter()
        .map(|p| {
            json!([
                p.id.key(),
                p.generation,
                p.object.as_ref().map(|o| sha256(&o.body)),
                p.object.as_ref().map(|o| &o.etag),
                p.object.as_ref().and_then(|o| o.version.as_ref())
            ])
        })
        .collect();
    let bindings: Vec<_> = selected.iter().map(|(_, e)| raw_tuple(e)).collect();
    let parse = Parse {
        raws,
        sensors,
        start,
        end,
        catalog_bindings,
        bindings,
        cutoff,
        deadline,
    }
    .spawn(guard);
    timeout_at(deadline, parse)
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|_| Error::Corrupt("rainfall parse task"))?
}

/// A bounded owned CPU projection, split so cancellation/drain checks exercise the real task.
pub(super) struct Parse {
    pub raws: Vec<RawRecord>,
    pub sensors: Vec<f64>,
    pub start: u64,
    pub end: u64,
    pub catalog_bindings: Vec<Value>,
    pub bindings: Vec<Value>,
    pub cutoff: u64,
    pub deadline: Instant,
}
impl Parse {
    pub fn spawn(
        self,
        guard: Arc<OwnedSemaphorePermit>,
    ) -> tokio::task::JoinHandle<Result<MinuteResult, Error>> {
        let Self {
            raws,
            sensors,
            start,
            end,
            catalog_bindings,
            bindings,
            cutoff,
            deadline,
        } = self;
        crate::observability::spawn_blocking(move || {
            // The owner reservation outlives cancellation and remains held through actual parse completion.
            let _guard = guard;
            let mut rows = RowStore::default();
            for r in raws {
                if Instant::now() >= deadline {
                    return Err(Error::Timeout);
                }
                let page = pages::parse_aws(&r.bytes, None)
                    .map_err(|_| Error::Corrupt("rainfall minute HTML"))?;
                let p = Publication::parse_dotted(&page.pub_date)
                    .ok_or(Error::Corrupt("rainfall minute page date"))?;
                if Some(p) != publication(&r.envelope) {
                    return Err(Error::Corrupt("rainfall minute envelope/page disagreement"));
                }
                let expected = pages::page_date(&page.pub_date);
                if page.rows.iter().any(|d| date_of(d) != expected) {
                    return Err(Error::Corrupt("rainfall minute row date"));
                }
                if Instant::now() >= deadline {
                    return Err(Error::Timeout);
                }
                let wanted: Vec<_> = page
                    .rows
                    .into_iter()
                    .filter_map(|d| {
                        let id = d.get("stnId")?;
                        if !id
                            .as_str()
                            .map(crate::world::js::string_to_number)
                            .is_some_and(|n| sensors.contains(&n))
                        {
                            return None;
                        }
                        let mut projection = Doc::new()
                            .with("stnId", id.clone())
                            .with("date", d.get("date")?.clone());
                        if let Some(Val::Bool(value)) = d.get("rns") {
                            projection.set("rns", Val::Bool(*value));
                        }
                        Some(projection)
                    })
                    .collect();
                rows.save(&wanted);
                if rows.docs().len() > 60 * 1024 {
                    return Err(Error::Capacity);
                }
            }
            let mut ready = Vec::new();
            for sensor in sensors {
                if Instant::now() >= deadline {
                    return Err(Error::Timeout);
                }
                let window: Vec<_> = rows
                    .after(sensor, start as f64)
                    .into_iter()
                    .filter(|d| date_of(d) <= end as f64)
                    .collect();
                if window.len() > 60 {
                    return Err(Error::Capacity);
                }
                let values: Vec<_> = window
                    .iter()
                    .map(|d| match d.get("rns") {
                        Some(Val::Bool(b)) => Some(*b),
                        _ => None,
                    })
                    .collect();
                if values.len() < 15 || values.iter().all(Option::is_none) {
                    continue;
                }
                let projection: Vec<_> = window
                    .iter()
                    .zip(&values)
                    .map(|(d, r)| json!([sensor, date_of(d) as u64, r]))
                    .collect();
                ready.push(Minute {
                    sensor,
                    values,
                    digest: digest(json!([
                        "rns-minute-v1",
                        POLICY,
                        cutoff,
                        sensor,
                        catalog_bindings,
                        bindings,
                        projection
                    ])),
                });
            }
            Ok(if ready.is_empty() {
                MinuteResult::NotEligible
            } else {
                MinuteResult::Ready(ready)
            })
        })
    }
}

#[derive(Default)]
struct Admission {
    acquisitions: usize,
    bytes: usize,
}
impl Admission {
    fn include(&mut self, bytes: usize) -> Result<(), Error> {
        if self.acquisitions == MAX_ACQUISITIONS || bytes > MAX_PAGE {
            return Err(Error::Capacity);
        }
        let total = self
            .bytes
            .checked_add(bytes)
            .filter(|n| *n <= MAX_RAW)
            .ok_or(Error::Capacity)?;
        self.acquisitions += 1;
        self.bytes = total;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CorpusRecord {
        file: String,
        envelope: Envelope,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct CorpusControl {
        file: String,
        id: CatalogId,
        body_sha256: String,
        etag: String,
        version: Option<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Corpus {
        schema: u8,
        profile: String,
        source_files: Value,
        current_end_ms: u64,
        cutoff_at_ms: u64,
        selected_raw_bytes: usize,
        sensors: Vec<f64>,
        controls: Vec<CorpusControl>,
        records: Vec<CorpusRecord>,
    }
    fn corpus_source_files() -> Value {
        json!([
            [
                "rainfall_input.rs",
                sha256(include_bytes!("rainfall_input.rs"))
            ],
            ["rainfall.rs", sha256(include_bytes!("rainfall.rs"))],
            ["pages.rs", sha256(include_bytes!("pages.rs"))],
            ["html.rs", sha256(include_bytes!("html.rs"))],
            ["stations.rs", sha256(include_bytes!("stations.rs"))],
            ["doc.rs", sha256(include_bytes!("doc.rs"))],
            ["js.rs", sha256(include_bytes!("../js.rs"))],
            [
                "html-entities.json",
                sha256(include_bytes!("data/html-entities.json"))
            ],
            [
                "Cargo.toml",
                sha256(include_bytes!("../../../../Cargo.toml"))
            ],
            [
                "Cargo.lock",
                sha256(include_bytes!("../../../../Cargo.lock"))
            ],
            [
                "rainfall_activation.rs",
                sha256(include_bytes!(
                    "../../../../tools/state/rainfall_activation.rs"
                ))
            ]
        ])
    }
    fn corpus_bytes(path: &std::path::Path, maximum: usize) -> Vec<u8> {
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .expect("owned corpus file")
            .take(maximum as u64 + 1)
            .read_to_end(&mut bytes)
            .expect("owned corpus read");
        assert!(bytes.len() <= maximum, "owned corpus file cap");
        bytes
    }
    fn physical_corpus(deadline: Instant) -> (Parse, String, String) {
        // This path is consulted only by explicitly invoked ignored unit-test children. There
        // is no production environment branch, mode, public Parse API or network acquisition.
        let directory = std::path::PathBuf::from(
            std::env::var_os("SERVER2_TEST_RAINFALL_CORPUS")
                .expect("explicit owned corpus test-process input"),
        );
        let bytes = corpus_bytes(&directory.join("manifest.json"), MAX_PAGE);
        let manifest_hash = sha256(&bytes);
        let c: Corpus = serde_json::from_slice(&bytes).expect("owned corpus manifest");
        assert_eq!(c.schema, 1);
        assert_eq!(
            c.source_files,
            corpus_source_files(),
            "corpus exporter/unit executable source mismatch"
        );
        let expected_count = match c.profile.as_str() {
            "page" => 46,
            "count" => 256,
            "rows" => 90,
            _ => panic!("owned corpus profile"),
        };
        assert_eq!(c.records.len(), expected_count);
        assert_eq!(c.selected_raw_bytes, MAX_RAW);
        assert_eq!(
            c.sensors,
            if c.profile == "rows" {
                (1..=1024).map(|n| n as f64).collect::<Vec<_>>()
            } else {
                vec![108.]
            }
        );
        assert_eq!(
            c.controls.len(),
            1,
            "the selected synthetic pressure profiles use one exact day catalog"
        );
        let end = c.current_end_ms;
        let start = end.checked_sub(3_600_000).expect("owned corpus hour");
        let mut bindings = Vec::new();
        let mut selected = Vec::new();
        let mut catalog_bindings = Vec::new();
        for (n, control) in c.controls.into_iter().enumerate() {
            assert_eq!(control.file, format!("catalog-{n}.json"));
            let body = corpus_bytes(&directory.join(&control.file), MAX_PAGE);
            assert_eq!(sha256(&body), control.body_sha256);
            let catalog = Catalog::from_bytes(
                &body,
                &control.id,
                &CatalogLimits {
                    control_bytes: MAX_PAGE,
                    entries: 2048,
                    ..CatalogLimits::default()
                },
            )
            .expect("owned corpus catalog");
            assert_eq!(control.id.source, "kma-web");
            assert_eq!(control.id.kind, "aws-minute");
            assert_eq!(
                control.id.key_sha256,
                sha256(
                    &ProviderKey::Named {
                        id: "aws-national".into()
                    }
                    .canonical_bytes()
                    .unwrap()
                )
            );
            for e in catalog.entries {
                let p = publication(&e).expect("owned corpus publication");
                let wall = u64::try_from(schedule::to_ms(p)).unwrap() + KST;
                if wall > start && wall <= end && e.identity.fetched_at_ms <= c.cutoff_at_ms {
                    selected.push(e);
                }
            }
            catalog_bindings.push(json!([
                control.id.key(),
                catalog.generation,
                control.body_sha256,
                control.etag,
                control.version
            ]));
        }
        assert_eq!(
            selected.len(),
            c.records.len(),
            "full selected membership must not be reduced"
        );
        let mut raws = Vec::new();
        let mut admission = Admission::default();
        for (n, (record, selected)) in c.records.into_iter().zip(selected).enumerate() {
            assert_eq!(record.file, format!("raw-{n:03}.bin"));
            assert_eq!(record.envelope, selected);
            let body = corpus_bytes(&directory.join(record.file), MAX_PAGE);
            assert_eq!(body.len(), record.envelope.raw_length);
            assert_eq!(sha256(&body), record.envelope.identity.raw_sha256);
            record
                .envelope
                .validate(&CatalogLimits::default().raw)
                .unwrap();
            admission.include(body.len()).unwrap();
            bindings.push(raw_tuple(&record.envelope));
            raws.push(RawRecord {
                envelope: record.envelope,
                bytes: body.into(),
            });
        }
        assert_eq!(admission.bytes, MAX_RAW);
        assert_eq!(admission.acquisitions, expected_count);
        (
            Parse {
                raws,
                sensors: c.sensors,
                start,
                end,
                catalog_bindings,
                bindings,
                cutoff: c.cutoff_at_ms,
                deadline,
            },
            c.profile,
            manifest_hash,
        )
    }
    #[test]
    #[ignore = "explicit retained physical corpus and exclusive CPU measurement window required"]
    fn measure_owned_pressure_load_only() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let began=std::time::Instant::now();
            let (input,profile,manifest)=physical_corpus(Instant::now()+std::time::Duration::from_secs(3));
            let reservation=Arc::new(tokio::sync::Semaphore::new(1));
            let guard=Arc::new(reservation.clone().acquire_owned().await.unwrap());
            // Match the Parse child's runtime/blocking-worker and actual reservation baseline,
            // while retaining the exact same buffers without running the HTML parser.
            let input=crate::observability::spawn_blocking(move || { let _guard=guard; std::hint::black_box(&input); input }).await.unwrap();
            assert_eq!(reservation.available_permits(),1);
            println!("\nrainfall physical measurement: {}",json!({"phase":"load-only","profile":profile,"manifest_sha256":manifest,"raw_bytes":input.raws.iter().map(|r|r.bytes.len()).sum::<usize>(),"acquisitions":input.raws.len(),"sensors":input.sensors.len(),"elapsed_seconds":began.elapsed().as_secs_f64(),"actual_reservation_retired":true,"outcome":"same bounded decoded raw/control/provenance and runtime/blocking reservation; no Parse run","source_files":corpus_source_files()}));
            std::hint::black_box(&input);
        });
    }
    #[test]
    #[ignore = "explicit retained physical corpus and exclusive CPU measurement window required"]
    fn measure_owned_pressure_parse_only() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let began=std::time::Instant::now(); let deadline=Instant::now()+std::time::Duration::from_secs(3);
            let (input,profile,manifest)=physical_corpus(deadline);
            let load_seconds=began.elapsed().as_secs_f64();
            let reservation=Arc::new(tokio::sync::Semaphore::new(1));
            let guard=Arc::new(reservation.clone().acquire_owned().await.unwrap());
            let mut parse=input.spawn(guard);
            let first=timeout_at(deadline,&mut parse).await;
            let waiter_timeout=first.is_err(); let held_at_timeout=waiter_timeout && reservation.available_permits()==0;
            let result=match first {
                Ok(joined)=>Some(joined.expect("actual Parse closure did not panic")),
                Err(_)=>tokio::time::timeout(std::time::Duration::from_secs(3),&mut parse).await.ok().map(|joined|joined.expect("actual Parse closure did not panic after waiter timeout")),
            };
            let retired=reservation.available_permits()==1;
            let outcome=match result {
                Some(Ok(MinuteResult::Ready(rows)))=>json!({"kind":"Ready","sensors":rows.len(),"row_counts":rows.iter().map(|r|r.values.len()).collect::<Vec<_>>()}),
                Some(Ok(MinuteResult::NotEligible))=>json!({"kind":"NotEligible"}),
                Some(Ok(MinuteResult::Incomplete))=>json!({"kind":"Incomplete"}),
                Some(Ok(MinuteResult::Unavailable))=>json!({"kind":"Unavailable"}),
                Some(Err(error))=>json!({"kind":"typed failure","error":error.to_string()}),
                None=>json!({"kind":"actual closure did not retire within observation deadline"}),
            };
            println!("\nrainfall physical measurement: {}",json!({"phase":"Parse-only","profile":profile,"manifest_sha256":manifest,"load_seconds":load_seconds,"elapsed_seconds":began.elapsed().as_secs_f64(),"caller_timed_out":waiter_timeout,"reservation_held_at_timeout":held_at_timeout,"actual_reservation_retired":retired,"outcome":outcome,"scope":"actual private Parse and raw/control/provenance; no public source, catalog IO or HTTP assembly","source_files":corpus_source_files()}));
            assert!(retired,"do not report a completed measurement before the actual blocking closure retires");
        });
    }
    #[test]
    fn exact_selected_metadata_limits_admit_boundary_and_reject_one_more_without_truncation() {
        let mut all = Admission::default();
        for _ in 0..256 {
            all.include(65_536).unwrap();
        }
        assert_eq!(all.bytes, 16 * 1024 * 1024);
        assert!(all.include(0).is_err());
        assert_eq!(all.acquisitions, 256);
        let mut one = Admission::default();
        one.include(1024 * 1024).unwrap();
        assert!(Admission::default().include(1024 * 1024 + 1).is_err());
        let mut total = Admission::default();
        for _ in 0..16 {
            total.include(1024 * 1024).unwrap();
        }
        assert!(total.include(1).is_err());
        assert_eq!(total.bytes, 16 * 1024 * 1024);
    }
}
