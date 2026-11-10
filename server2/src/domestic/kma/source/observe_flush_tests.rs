//! KMA-STATION-FLUSH over an isolated in-memory S3 on a paused clock: a flush that waits for a
//! failed day read (SF-flush-read-recovery) and the time contract of the early fold
//! (SF-real-clock-deadlines). The store has no I/O, so virtual time advances only when every task
//! waits for a timer (blocking work holds it on the current-thread runtime). A reload is a request
//! after its interval: the instants of the last read are moved back, the clock stays paused.
use super::*;
use crate::domestic::family::WebFamily;
use crate::storage::{
    CatalogLimits, CatalogTransport, ControlObject, Error, GroupDeclaration, GroupMember, ListPage,
    Object, ObjectTransport, PreparedRecord, WriteCondition,
};

/// 2026-09-24 10:50 KST.
const NOW_MS: i64 = 1_790_214_600_000;
const TODAY: u32 = 20260924;
const YESTERDAY: u32 = 20260923;
/// Today's station-page products.
const TODAY_PRODUCTS: &str = "raw/v2/kma-web/station-pages/2026/09/24/";

/// An isolated in-memory S3: raw objects, conditional control objects and the catalog index. Raw
/// reads and writes under a held prefix wait until the test releases them (a slow store), and
/// control reads under the failing prefix fail (a transient catalog failure).
#[derive(Clone)]
struct Memory {
    objects: Arc<Mutex<Objects>>,
    held: Arc<watch::Sender<Vec<String>>>,
    /// Raw reads and writes that arrived under a held prefix.
    reached: Arc<watch::Sender<usize>>,
    failing: Arc<Mutex<Option<String>>>,
}
#[derive(Default)]
struct Objects {
    raw: BTreeMap<String, Object>,
    control: BTreeMap<String, ControlObject>,
    revision: u64,
}
impl Memory {
    fn new() -> Self {
        Self {
            objects: Arc::default(),
            held: Arc::new(watch::channel(Vec::new()).0),
            reached: Arc::new(watch::channel(0).0),
            failing: Arc::default(),
        }
    }
    /// Hold the raw reads and writes under `prefix` until [`Self::release`].
    fn hold(&self, prefix: &str) {
        self.held.send_modify(|held| held.push(prefix.to_owned()));
    }
    fn release(&self) {
        self.held.send_replace(Vec::new());
    }
    /// Wait until a raw read or write is held.
    async fn reached(&self) {
        let _ = self.reached.subscribe().wait_for(|n| *n > 0).await;
    }
    /// Pass `key` once no held prefix covers it.
    async fn pass(&self, key: &str) {
        let covered = |held: &Vec<String>| held.iter().any(|p| key.starts_with(p.as_str()));
        let mut held = self.held.subscribe();
        if covered(&held.borrow_and_update()) {
            self.reached.send_modify(|n| *n += 1);
        }
        let _ = held.wait_for(|held| !covered(held)).await;
    }
    /// Fail the control reads under `prefix` (None: none).
    fn fail(&self, prefix: Option<String>) {
        *self.failing.lock().unwrap() = prefix;
    }
    /// Raw objects stored under `prefix`.
    fn stored(&self, prefix: &str) -> usize {
        let objects = self.objects.lock().unwrap();
        objects.raw.keys().filter(|k| k.starts_with(prefix)).count()
    }
}
impl ObjectTransport for Memory {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        self.pass(&record.key).await;
        let mut objects = self.objects.lock().unwrap();
        if objects.raw.contains_key(&record.key) {
            return Ok(412);
        }
        let object = Object {
            metadata: record.metadata.clone(),
            length: record.body.len(),
            body: record.body.clone(),
        };
        objects.raw.insert(record.key.clone(), object);
        Ok(200)
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let objects = self.objects.lock().unwrap();
        let object = objects.raw.get(key).ok_or(Error::NotFound)?;
        Ok(Object {
            body: Vec::new(),
            ..object.clone()
        })
    }
    async fn get(&self, key: &str, _: usize) -> Result<Object, Error> {
        self.pass(key).await;
        let objects = self.objects.lock().unwrap();
        objects.raw.get(key).cloned().ok_or(Error::NotFound)
    }
}
impl CatalogTransport for Memory {
    async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
        if self
            .failing
            .lock()
            .unwrap()
            .as_deref()
            .is_some_and(|prefix| key.starts_with(prefix))
        {
            return Err(Error::Transport);
        }
        let objects = self.objects.lock().unwrap();
        objects.control.get(key).cloned().ok_or(Error::NotFound)
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let mut objects = self.objects.lock().unwrap();
        let agrees = match (condition, objects.control.get(key)) {
            (WriteCondition::Absent, None) => true,
            (WriteCondition::Match(etag), Some(current)) => *etag == current.etag,
            _ => false,
        };
        if !agrees {
            return Ok(412);
        }
        objects.revision += 1;
        let etag = format!("\"v{}\"", objects.revision);
        objects.control.insert(
            key.to_owned(),
            ControlObject {
                body: body.to_vec(),
                etag,
                version: None,
            },
        );
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        panic!("the observations list the catalog index")
    }
}
impl IndexListing for Memory {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, Error> {
        let objects = self.objects.lock().unwrap();
        Ok(ListPage {
            keys: objects
                .control
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect(),
            next: None,
        })
    }
}

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn row(id: &str, name: &str, rain: bool, addr: &str) -> Vec<String> {
    let mark = if rain {
        "<font color=blue>●</font>"
    } else {
        "<font color=red>○</font>"
    };
    [
        id, name, "12m", mark, "0", "0.5", "0", "0", "0", "0", "18.4", "270.1", "W", "1.2",
        "265.0", "WSW", "1.4", "61", "1013.2", addr,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}
/// An AWS page (`nph-aws_txt_min`) of three Seoul stations, as the KMA serves it (EUC-KR).
fn aws_page(publication: Publication, rain_410: bool) -> Vec<u8> {
    let rows = [
        row("108", "서울", false, "서울특별시 종로구 송월동"),
        row("400", "강남", false, "서울특별시 강남구 일원동"),
        row("410", "중구", rain_410, "서울특별시 중구 명동"),
    ];
    let mut html = String::from(
        r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
    );
    html += "\n";
    html += &format!(
        r"<span class=ehead>[ 매분관측자료 ] {}</span>",
        dotted(publication)
    );
    html += "\n";
    html += "<table border=0 cellspacing=0 cellpadding=0>\n<tr><td bgcolor=#999999>\n<table border=0 cellspacing=1 cellpadding=1>\n";
    html += r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#;
    html += "\n";
    for r in rows {
        html += "<tr align=center class=text>";
        for c in r {
            html += &format!(r"<td>{c}</td>");
        }
        html += r"</tr>";
        html += "\n";
    }
    for part in [r"</table>", r"</td></tr></table>", r"</BODY></HTML>"] {
        html += part;
        html += "\n";
    }
    encoding_rs::EUC_KR.encode(&html).0.into_owned()
}
/// A city page (`currentweather.jsp`) of 108 at `publication`.
fn city_page(publication: Publication) -> Vec<u8> {
    let d = publication.date();
    let date = format!(
        "{}.{}.{}.{:02}:00",
        d / 10000,
        (d / 100) % 100,
        d % 100,
        publication.hour()
    );
    format!(
        r#"<html><head><meta charset="utf-8"></head><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>{date}</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>운량<br/>1/10</th><th>현재<br/>기온</th><th>습도<br/>%</th><th>풍향</th><th>풍속</th></tr></thead><tbody><tr><td><a href="city-obs.do?stn=108">서울</a></td><td>맑음</td><td>3</td><td>18.0</td><td>60</td><td>남서</td><td>2.0</td></tr></tbody></table></body></html>"#
    )
    .into_bytes()
}
/// A KMA page record as the S13 acquirer stores it.
fn page_record(kind: &str, hour: Publication, fetched_at: u64, body: Vec<u8>) -> RawRecord {
    let (key, content) = if kind == "city-obs" {
        (city_key(), "text/html;charset=utf-8")
    } else {
        (aws_key(), "text/html;charset=euc-kr")
    };
    RawRecord::new(
        "kma-web",
        kind,
        &key,
        hour.period(),
        fetched_at,
        200,
        content,
        None,
        body.into(),
        &CatalogLimits::default().raw,
    )
    .unwrap()
}
/// One group of `record` in its day catalog, as the S13 acquirer publishes it.
fn acquisition(record: RawRecord) -> crate::resolver::Acquisition {
    let limits = CatalogLimits::default();
    let partition = format!("{:08}", record.envelope.identity.period.local_date);
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![CatalogId::for_record(&record.envelope.identity, &partition).unwrap()],
    };
    crate::resolver::Acquisition {
        declaration: GroupDeclaration::new(vec![member], &limits).unwrap(),
        records: vec![record],
    }
}
async fn publish(memory: &Memory, record: RawRecord) {
    let store = CatalogStore::new(memory.clone(), CatalogLimits::default()).unwrap();
    let a = acquisition(record);
    store
        .publish(
            a.declaration,
            a.records,
            Instant::now() + Duration::from_secs(20),
        )
        .await
        .unwrap();
}
/// Request-time acquisitions and geocoding that never reach a provider, except the AWS hourly
/// pages of `answers` (fetched a minute before NOW).
struct Provider {
    answers: Vec<Publication>,
}
impl Acquire for Provider {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            match request.publication() {
                Some(hour)
                    if request.family() == WebFamily::AwsHourly && self.answers.contains(&hour) =>
                {
                    let body = aws_page(hour, false);
                    let record = page_record("aws-hourly", hour, NOW_MS as u64 - 60_000, body);
                    Ok(Acquired::Complete(acquisition(record)))
                }
                _ => Err(DomesticError::Transport),
            }
        })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
}
impl Locate for Provider {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { None })
    }
}
/// A process of the observed policy on `memory`.
fn process(memory: &Memory, answers: Vec<Publication>) -> Arc<Observations<Memory>> {
    let store = Arc::new(CatalogStore::new(memory.clone(), CatalogLimits::default()).unwrap());
    Arc::new(
        Observations::new(
            memory.clone(),
            store,
            Arc::new(Provider { answers }),
            Arc::new(Provider {
                answers: Vec::new(),
            }),
        )
        .observed_history(),
    )
}
/// A request at NOW with the production wait.
async fn request(obs: &Arc<Observations<Memory>>) -> Arc<Folded> {
    obs.stations(NOW_MS, Instant::now() + Duration::from_millis(2500))
        .await
        .unwrap()
}
/// Wait until no read, fold, geocoding, product comparison or full read is in flight and no
/// product comparison is due. A comparison due with no worker is given a few turns of the other
/// tasks to start one, then left due (the caller's assertions see it).
async fn idle(obs: &Arc<Observations<Memory>>) {
    let mut turns = 0;
    loop {
        let running: Vec<_> = [
            Flight::Load,
            Flight::LoadRest,
            Flight::Fold,
            Flight::Geocode,
            Flight::Product,
            Flight::Expand,
        ]
        .iter()
        .filter_map(|f| obs.flight(f))
        .collect();
        if running.is_empty() {
            if !obs.state().product_due || turns == 100 {
                return;
            }
            turns += 1;
            tokio::task::yield_now().await;
            continue;
        }
        for mut done in running {
            let _ = done.wait_for(|done| *done).await;
        }
    }
}
/// A process that read the 05:00 pages of `days` and stored their products; its provider answers
/// the 06:00 pages of those days.
async fn read_once(memory: &Memory, days: &[u32]) -> Arc<Observations<Memory>> {
    for day in days {
        let hour = p(*day, 500);
        let at = schedule::to_ms(hour) as u64 + 15 * 60_000;
        publish(
            memory,
            page_record("aws-hourly", hour, at, aws_page(hour, false)),
        )
        .await;
    }
    let obs = process(memory, days.iter().map(|day| p(*day, 600)).collect());
    let _ = request(&obs).await;
    idle(&obs).await;
    obs
}
/// A reload whose read of today's AWS catalog fails: today is unreadable.
async fn fail_today(obs: &Arc<Observations<Memory>>, memory: &Memory) {
    let catalog = super::super::records::catalog("kma-web", "aws-hourly", &aws_key(), "20260924")
        .unwrap()
        .key();
    memory.fail(Some(catalog));
    reload_due(obs);
    let _ = request(obs).await;
    idle(obs).await;
    assert!(obs.state().pages.unreadable.contains(&TODAY));
    memory.fail(None);
}
/// The fill pass of a raced restore: it acquires the absent 06:00 pages.
async fn fill(obs: &Arc<Observations<Memory>>) {
    let asked = vec![p(TODAY, 1000), p(TODAY, 900)];
    obs.fill_window(NOW_MS, asked, Instant::now() + Duration::from_secs(60))
        .await;
}
/// Make the next request reload, with today due again: the instants of the last read move back
/// past [`RELOAD`].
fn reload_due(obs: &Arc<Observations<Memory>>) {
    let past = std::time::Instant::now()
        .checked_sub(RELOAD + Duration::from_secs(1))
        .unwrap();
    let mut s = obs.state();
    s.pages.minute_read = Some(past);
    s.pages.days.insert(TODAY, past);
}

/// SF-flush-read-recovery (code review 1): a reload's catalog read of today fails, so the day is
/// unreadable when a fill pass ends with its 06:00 page. The product worker keeps the flush, and
/// the fold of the page asks it again in vain. The next reload finds every listed page of the day
/// held (no page changes, so the hourly part is not folded again) and makes the day readable:
/// that read alone has the day's product stored with the filled page, within ten minutes of the
/// first.
#[tokio::test(start_paused = true)]
async fn a_flush_kept_by_a_failed_day_read_is_stored_after_the_next_read() {
    let memory = Memory::new();
    let obs = read_once(&memory, &[TODAY]).await;
    assert_eq!(
        memory.stored(TODAY_PRODUCTS),
        1,
        "the day's product of 05:00"
    );
    fail_today(&obs, &memory).await;
    fill(&obs).await;
    assert!(obs.state().pages.hourly.contains_key(&p(TODAY, 600)));
    // A request folds the page; the worker is asked again, in vain.
    let _ = request(&obs).await;
    idle(&obs).await;
    assert!(
        obs.state().flush.contains(&TODAY),
        "kept for the day's read"
    );
    assert_eq!(memory.stored(TODAY_PRODUCTS), 1);
    // The next reload changes no page and makes the day readable.
    reload_due(&obs);
    let _ = request(&obs).await;
    idle(&obs).await;
    assert!(!obs.state().pages.unreadable.contains(&TODAY));
    assert_eq!(
        memory.stored(TODAY_PRODUCTS),
        2,
        "the day's product with the filled page"
    );
    assert!(obs.state().flush.is_empty(), "spent");
}

/// SF-flush-read-recovery (code review 2): the read that makes a flushed day storable asks for the
/// comparison while the product worker is finishing: the worker has made its last comparison, but
/// its flight is still registered, so the request joins it. Once that flight ends, with no further
/// request, the day's product is stored exactly once.
///
/// In the real worker that interval has no await (its last check, its return and the removal of
/// its flight run in one poll), so no test reaches it there without a hook in the product code.
/// The test holds the interval's state instead: a registered product flight whose worker does not
/// compare again, ended as `start` ends a flight (the flight removed, then its end sent).
#[tokio::test(start_paused = true)]
async fn a_read_that_joins_a_finishing_product_worker_has_the_day_stored_once() {
    let memory = Memory::new();
    let obs = read_once(&memory, &[TODAY]).await;
    fail_today(&obs, &memory).await;
    fill(&obs).await;
    let _ = request(&obs).await;
    idle(&obs).await;
    assert!(
        obs.state().flush.contains(&TODAY),
        "kept for the day's read"
    );
    // The finishing worker: its last comparison made, its flight still registered.
    let (ended, finishing) = watch::channel(false);
    obs.flights.lock().unwrap().insert(
        Flight::Product,
        (finishing, crate::observability::current()),
    );
    // The reload makes the day readable during the request; its comparison joins that worker.
    reload_due(&obs);
    let _ = request(&obs).await;
    assert!(!obs.state().pages.unreadable.contains(&TODAY));
    assert!(obs.state().product_due, "the comparison is due");
    assert_eq!(memory.stored(TODAY_PRODUCTS), 1);
    // The worker's flight ends; no request follows.
    obs.flights.lock().unwrap().remove(&Flight::Product);
    ended.send_replace(true);
    idle(&obs).await;
    assert_eq!(
        memory.stored(TODAY_PRODUCTS),
        2,
        "the day's product with the filled page, once"
    );
    assert!(obs.state().flush.is_empty(), "spent");
    assert!(!obs.state().product_due);
}

/// SF-flush-read-recovery (code review 2): the read that makes today storable arrives while the
/// product worker waits in the store of yesterday's product (its raw PUT held), which the end of
/// the same fill pass asked for. Once the PUT is released, with no further request, each day's
/// product is stored exactly once.
#[tokio::test(start_paused = true)]
async fn a_read_during_a_product_store_has_the_day_stored_once() {
    let memory = Memory::new();
    let obs = read_once(&memory, &[YESTERDAY, TODAY]).await;
    let yesterday = "raw/v2/kma-web/station-pages/2026/09/23/";
    assert_eq!(
        (memory.stored(yesterday), memory.stored(TODAY_PRODUCTS)),
        (1, 1)
    );
    fail_today(&obs, &memory).await;
    memory.hold(yesterday);
    let pass = {
        let obs = obs.clone();
        tokio::spawn(async move { fill(&obs).await })
    };
    memory.reached().await;
    // The reload makes today readable while the worker stores yesterday.
    reload_due(&obs);
    let _ = request(&obs).await;
    assert!(!obs.state().pages.unreadable.contains(&TODAY));
    memory.release();
    pass.await.unwrap();
    idle(&obs).await;
    assert_eq!(
        (memory.stored(yesterday), memory.stored(TODAY_PRODUCTS)),
        (2, 2),
        "each day's product with its filled page, once"
    );
    assert!(obs.state().flush.is_empty(), "spent");
}

/// AWS hourly and city pages of every hour from `first_day` 00:00 to 10:00 today, fetched 15
/// minutes into the hour, and the minute pages of 10:11 to 10:49.
async fn store_window(memory: &Memory, first_day: u32) {
    let mut h = p(first_day, 0);
    while h <= p(TODAY, 1000) {
        let at = schedule::to_ms(h) as u64 + 15 * 60_000;
        let page = aws_page(h, h.hour().is_multiple_of(5));
        publish(memory, page_record("aws-hourly", h, at, page)).await;
        publish(memory, page_record("city-obs", h, at, city_page(h))).await;
        h = h.add_hours(1).unwrap();
    }
    for minute in (11..=49).step_by(2) {
        let m = p(TODAY, 1000 + minute);
        let at = schedule::to_ms(m) as u64 + 30_000;
        publish(
            memory,
            page_record("aws-minute", m, at, aws_page(m, minute == 49)),
        )
        .await;
    }
}
/// Requests until the station inputs were read completely (S16).
async fn settle(obs: &Arc<Observations<Memory>>) {
    for _ in 0..40 {
        let folded = request(obs).await;
        if obs.settled(NOW_MS, &folded) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("the station inputs never settled");
}
/// Station 108's hourly rows with a one-hour rain amount (`rs1h`, which the assembly answers as
/// the `rn1` of `KMA_STATION_HOURLY`) from hour `from` to `to`. A row is dated nine hours after
/// its KST hour (the page time read as UTC, as the parsed pages carry it).
fn rain_hours_of_108(f: &Folded, from: Publication, to: Publication) -> usize {
    let shift = 9 * 3_600_000;
    let (from, to) = (
        (schedule::to_ms(from) + shift) as f64,
        (schedule::to_ms(to) + shift) as f64,
    );
    f.hourly
        .docs()
        .iter()
        .filter(|d| {
            d.get("stnId") == Some(&Val::Num(108.)) && matches!(d.get("rs1h"), Some(Val::Num(_)))
        })
        .map(super::super::stations::date_of)
        .filter(|t| (from..=to).contains(t))
        .count()
}

/// EARLY-FOLD time contract (KMA-STATION-FLUSH V2, SF-real-clock-deadlines): a restart's read
/// whose minute pages are held past the request's wait folds today's and yesterday's pages before
/// them. The first answer, given when its 2.5 s wait ends, has station 108's rain rows of every
/// hour of both days, and it is not complete (S16).
#[tokio::test(start_paused = true)]
async fn the_first_answer_has_today_and_yesterday_while_the_minute_pages_are_held() {
    let memory = Memory::new();
    store_window(&memory, YESTERDAY).await;
    let obs = process(&memory, Vec::new());
    memory.hold("raw/v2/kma-web/aws-minute/");
    let started = Instant::now();
    let first = request(&obs).await;
    assert_eq!(
        started.elapsed(),
        Duration::from_millis(2500),
        "its whole wait"
    );
    assert_eq!(
        rain_hours_of_108(&first, p(YESTERDAY, 0), p(TODAY, 1000)),
        35
    );
    assert!(!obs.settled(NOW_MS, &first));
    memory.release();
}

/// EARLY-FOLD time contract (DR-V-early-fold-order, SF-real-clock-deadlines): an older day's
/// product read held past the request's wait does not hold today and yesterday back. The first
/// answer, given when its 2.5 s wait ends, has station 108's rain rows of every hour of both
/// days, and it is not complete (S16).
#[tokio::test(start_paused = true)]
async fn the_first_answer_has_today_and_yesterday_while_an_older_days_product_is_held() {
    let memory = Memory::new();
    store_window(&memory, 20260916).await;
    settle(&process(&memory, Vec::new())).await;
    let older = "raw/v2/kma-web/station-pages/2026/09/20/";
    assert_eq!(
        memory.stored(older),
        1,
        "the products of a process that read every page"
    );
    let obs = process(&memory, Vec::new());
    memory.hold(older);
    let started = Instant::now();
    let first = request(&obs).await;
    assert_eq!(
        started.elapsed(),
        Duration::from_millis(2500),
        "its whole wait"
    );
    assert_eq!(
        rain_hours_of_108(&first, p(YESTERDAY, 0), p(TODAY, 1000)),
        35
    );
    assert!(!obs.settled(NOW_MS, &first));
    memory.release();
}
