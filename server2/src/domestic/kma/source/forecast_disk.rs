//! Disposable folded-view codec. Explicit bounds precede allocation; floats retain their bits.
//! Bump REVISION whenever the parser, selectors, ordered Doc or input identity contract changes.
use super::{
    Doc, Fetched, Val,
    forecast_cache::{DOCS, Key, PAGE_BYTES, allocation, reserve},
    forecast_manifest::Manifest,
};
use crate::{
    storage::{Error, sha256},
    summary::InputId,
};
use std::{mem::size_of, sync::Arc};

const REVISION: &[u8] = b"TWFCV001";
pub(super) const MAXIMUM: usize = 48 * 1024 * 1024;
const RAW: usize = 32 * 1024 * 1024;
const HEAP: usize = 12 * 1024 * 1024;
fn corrupt() -> Error {
    Error::Corrupt("forecast view codec")
}
pub(super) fn key(key: &Key) -> String {
    format!("forecast-view-v1/{}", sha256(format!("{key:?}").as_bytes()))
}
pub(super) struct Payload {
    pub docs: Vec<Doc>,
    pub raw: Vec<Fetched>,
    pub ids: Option<Vec<InputId>>,
    pub usable: Vec<String>,
    pub wall: f64,
    pub expiry: f64,
    pub manifest: Manifest,
}
struct Out(Vec<u8>);
impl Out {
    fn bytes(&mut self, bytes: &[u8]) -> Result<(), Error> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|n| n > MAXIMUM)
        {
            return Err(Error::Capacity);
        }
        self.0
            .try_reserve(bytes.len())
            .map_err(|_| Error::Capacity)?;
        self.0.extend_from_slice(bytes);
        Ok(())
    }
    fn n(&mut self, n: usize) -> Result<(), Error> {
        self.bytes(&u32::try_from(n).map_err(|_| Error::Capacity)?.to_le_bytes())
    }
    fn u64(&mut self, n: u64) -> Result<(), Error> {
        self.bytes(&n.to_le_bytes())
    }
    fn text(&mut self, s: &str) -> Result<(), Error> {
        self.n(s.len())?;
        self.bytes(s.as_bytes())
    }
    fn doc(&mut self, d: &Doc, depth: usize) -> Result<(), Error> {
        if depth > 32 {
            return Err(Error::Capacity);
        }
        self.n(d.entries().len())?;
        for (k, v) in d.entries() {
            self.text(k)?;
            self.val(v, depth + 1)?;
        }
        Ok(())
    }
    fn val(&mut self, v: &Val, depth: usize) -> Result<(), Error> {
        if depth > 32 {
            return Err(Error::Capacity);
        }
        match v {
            Val::Num(n) => {
                self.bytes(&[0])?;
                self.u64(n.to_bits())?;
            }
            Val::Str(s) => {
                self.bytes(&[1])?;
                self.text(s)?;
            }
            Val::Bool(b) => self.bytes(&[2, u8::from(*b)])?,
            Val::Null => self.bytes(&[3])?,
            Val::Undef => self.bytes(&[4])?,
            Val::Date(n) => {
                self.bytes(&[5])?;
                self.u64(n.to_bits())?;
            }
            Val::Arr(a) => {
                self.bytes(&[6])?;
                self.n(a.len())?;
                for v in a {
                    self.val(v, depth + 1)?;
                }
            }
            Val::Doc(d) => {
                self.bytes(&[7])?;
                self.doc(d, depth + 1)?;
            }
        }
        Ok(())
    }
}
/// Borrow the admitted view without copying its raw or Doc trees.
#[allow(clippy::too_many_arguments)]
pub(super) fn encode(
    key: &Key,
    docs: &[Doc],
    raw: &[Fetched],
    ids: Option<&[InputId]>,
    usable: &[String],
    wall: f64,
    expiry: f64,
    manifest: &Manifest,
) -> Result<Vec<u8>, Error> {
    let mut out = Out(Vec::new());
    out.bytes(REVISION)?;
    out.text(&format!("{key:?}"))?;
    out.u64(wall.to_bits())?;
    out.u64(expiry.to_bits())?;
    out.n(docs.len())?;
    for d in docs {
        out.doc(d, 0)?;
    }
    out.n(raw.len())?;
    for f in raw {
        out.u64(f.fetched_at_ms)?;
        out.text(&f.partition)?;
        out.n(f.pages.len())?;
        for p in &f.pages {
            out.n(p.len())?;
            out.bytes(p)?;
        }
    }
    if let Some(ids) = ids {
        out.bytes(&[1])?;
        out.n(ids.len())?;
        for id in ids {
            out.text(&id.family)?;
            out.u64(id.start_ms as u64)?;
            out.u64(id.end_ms as u64)?;
            out.u64(id.fetched_at_ms)?;
            out.text(&id.content_sha256)?;
        }
    } else {
        out.bytes(&[0])?;
    }
    out.n(usable.len())?;
    for p in usable {
        out.text(p)?;
    }
    out.n(manifest.months.len())?;
    for m in &manifest.months {
        out.n(*m as usize)?;
    }
    out.n(manifest.catalogs.len())?;
    for (p, h) in &manifest.catalogs {
        out.text(p)?;
        out.text(h)?;
    }
    Ok(out.0)
}
struct Input<'a> {
    bytes: &'a [u8],
    at: usize,
    heap: usize,
    raw: usize,
    pages: usize,
}
impl<'a> Input<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], Error> {
        let end = self.at.checked_add(n).ok_or_else(corrupt)?;
        let bytes = self.bytes.get(self.at..end).ok_or_else(corrupt)?;
        self.at = end;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8, Error> {
        Ok(self.take(1)?[0])
    }
    fn n(&mut self, maximum: usize) -> Result<usize, Error> {
        let n = u32::from_le_bytes(self.take(4)?.try_into().map_err(|_| corrupt())?) as usize;
        if n > maximum {
            return Err(Error::Capacity);
        }
        Ok(n)
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| corrupt())?,
        ))
    }
    fn claim(&mut self, n: usize) -> Result<(), Error> {
        self.heap = self
            .heap
            .checked_add(allocation(n)?)
            .ok_or(Error::Capacity)?;
        if self.heap > HEAP {
            return Err(Error::Capacity);
        }
        Ok(())
    }
    fn vec<T>(&mut self, maximum: usize) -> Result<(Vec<T>, usize), Error> {
        let n = self.n(maximum)?;
        self.claim(n.checked_mul(size_of::<T>()).ok_or(Error::Capacity)?)?;
        let mut v = Vec::new();
        reserve(&mut v, n)?;
        Ok((v, n))
    }
    fn text(&mut self, maximum: usize) -> Result<String, Error> {
        let n = self.n(maximum)?;
        self.claim(n)?;
        let s = std::str::from_utf8(self.take(n)?).map_err(|_| corrupt())?;
        super::forecast_cache::copied(s)
    }
    fn doc(&mut self, depth: usize) -> Result<Doc, Error> {
        if depth > 32 {
            return Err(Error::Capacity);
        }
        let (mut fields, n) = self.vec::<(String, Val)>(4096)?;
        for _ in 0..n {
            let k = self.text(1024)?;
            if fields.iter().any(|(old, _)| old == &k) {
                return Err(corrupt());
            }
            fields.push((k, self.val(depth + 1)?));
        }
        Ok(Doc::from_entries(fields))
    }
    fn val(&mut self, depth: usize) -> Result<Val, Error> {
        if depth > 32 {
            return Err(Error::Capacity);
        }
        Ok(match self.byte()? {
            0 => Val::Num(f64::from_bits(self.u64()?)),
            1 => Val::Str(self.text(8 * 1024 * 1024)?),
            2 => Val::Bool(match self.byte()? {
                0 => false,
                1 => true,
                _ => return Err(corrupt()),
            }),
            3 => Val::Null,
            4 => Val::Undef,
            5 => Val::Date(f64::from_bits(self.u64()?)),
            6 => {
                let (mut a, n) = self.vec::<Val>(DOCS * 256)?;
                for _ in 0..n {
                    a.push(self.val(depth + 1)?);
                }
                Val::Arr(a)
            }
            7 => Val::Doc(self.doc(depth + 1)?),
            _ => return Err(corrupt()),
        })
    }
}
pub(super) fn decode(key: &Key, bytes: &[u8]) -> Result<Payload, Error> {
    if bytes.len() > MAXIMUM {
        return Err(Error::Capacity);
    }
    let mut r = Input {
        bytes,
        at: 0,
        heap: 0,
        raw: 0,
        pages: 0,
    };
    if r.take(REVISION.len())? != REVISION || r.text(128)? != format!("{key:?}") {
        return Err(corrupt());
    }
    let wall = f64::from_bits(r.u64()?);
    let expiry = f64::from_bits(r.u64()?);
    if !wall.is_finite() || !expiry.is_finite() || wall < 0. || expiry <= wall {
        return Err(corrupt());
    }
    let (mut docs, n) = r.vec::<Doc>(DOCS)?;
    for _ in 0..n {
        docs.push(r.doc(0)?);
    }
    let (mut raw, n) = r.vec::<Fetched>(2048)?;
    for _ in 0..n {
        let fetched_at_ms = r.u64()?;
        let partition = r.text(32)?;
        let (mut pages, n) = r.vec::<Arc<[u8]>>(8192)?;
        r.pages = r.pages.checked_add(n).ok_or(Error::Capacity)?;
        if r.pages > 8192 {
            return Err(Error::Capacity);
        }
        for _ in 0..n {
            let n = r.n(PAGE_BYTES)?;
            r.raw = r.raw.checked_add(allocation(n)?).ok_or(Error::Capacity)?;
            if r.raw > RAW {
                return Err(Error::Capacity);
            }
            pages.push(Arc::from(r.take(n)?));
        }
        raw.push(Fetched {
            fetched_at_ms,
            partition,
            pages,
        });
    }
    let ids = match r.byte()? {
        0 => None,
        1 => {
            let (mut ids, n) = r.vec::<InputId>(2048)?;
            for _ in 0..n {
                ids.push(InputId {
                    family: r.text(64)?,
                    start_ms: r.u64()? as i64,
                    end_ms: r.u64()? as i64,
                    fetched_at_ms: r.u64()?,
                    content_sha256: r.text(64)?,
                });
            }
            Some(ids)
        }
        _ => return Err(corrupt()),
    };
    let (mut usable, n) = r.vec::<String>(2048)?;
    for _ in 0..n {
        usable.push(r.text(32)?);
    }
    let (mut months, n) = r.vec::<u32>(1024)?;
    for _ in 0..n {
        months.push(r.n(999912)? as u32);
    }
    let (mut catalogs, n) = r.vec::<(String, String)>(1024)?;
    for _ in 0..n {
        let p = r.text(32)?;
        let h = r.text(64)?;
        if h.len() != 64 || !h.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(corrupt());
        }
        catalogs.push((p, h));
    }
    if r.at != bytes.len()
        || ids.is_none()
        || months.is_empty()
        || months
            .iter()
            .any(|m| *m < super::HISTORY_START_MONTH || !(1..=12).contains(&(m % 100)))
        || months.windows(2).any(|m| m[0] >= m[1])
        || catalogs.windows(2).any(|p| p[0].0 >= p[1].0)
    {
        return Err(corrupt());
    }
    Ok(Payload {
        docs,
        raw,
        ids,
        usable,
        wall,
        expiry,
        manifest: Manifest { months, catalogs },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> (Key, Vec<Doc>, Manifest) {
        let key = Key::Grid(super::super::Family::Current, 60, 127);
        let d = Doc::new()
            .with("nan", Val::Num(f64::from_bits(0x7ff8000000000001)))
            .with("minus_zero", Val::Num(-0.))
            .with("undefined", Val::Undef)
            .with("date", Val::Date(f64::INFINITY))
            .with(
                "array",
                Val::Arr(vec![
                    Val::Null,
                    Val::Bool(true),
                    Val::Doc(Doc::new().with("x", Val::str("안녕"))),
                ]),
            );
        (
            key,
            vec![d],
            Manifest {
                months: vec![202609],
                catalogs: vec![],
            },
        )
    }
    #[test]
    fn binary_view_roundtrip_preserves_bits_order_and_undefined() {
        let (key, docs, m) = sample();
        let b = encode(&key, &docs, &[], Some(&[]), &[], 1., 2., &m).unwrap();
        let p = decode(&key, &b).unwrap();
        assert_eq!(
            encode(
                &key,
                &p.docs,
                &p.raw,
                p.ids.as_deref(),
                &p.usable,
                p.wall,
                p.expiry,
                &p.manifest
            )
            .unwrap(),
            b
        );
        assert_eq!(
            p.docs[0].keys().collect::<Vec<_>>(),
            docs[0].keys().collect::<Vec<_>>()
        );
        assert!(matches!(p.docs[0].get("undefined"), Some(Val::Undef)));
        let Some(Val::Num(n)) = p.docs[0].get("nan") else {
            panic!()
        };
        assert_eq!(n.to_bits(), 0x7ff8000000000001);
        let Some(Val::Num(n)) = p.docs[0].get("minus_zero") else {
            panic!()
        };
        assert_eq!(n.to_bits(), (-0f64).to_bits());
    }
    #[test]
    fn truncated_wrong_revision_key_and_trailing_bytes_are_misses() {
        let (key, docs, m) = sample();
        let b = encode(&key, &docs, &[], Some(&[]), &[], 1., 2., &m).unwrap();
        for n in 0..b.len() {
            assert!(
                decode(&key, &b[..n]).is_err(),
                "accepted truncated length{n}"
            );
        }
        let mut bad = b.clone();
        bad[7] = b'2';
        assert!(decode(&key, &bad).is_err());
        assert!(decode(&Key::Rss(60, 127), &b).is_err());
        let mut bad = b;
        bad.push(0);
        assert!(decode(&key, &bad).is_err());
    }
    #[test]
    fn decoder_rejects_declared_growth_before_allocation() {
        let mut r = Input {
            bytes: &u32::MAX.to_le_bytes(),
            at: 0,
            heap: 0,
            raw: 0,
            pages: 0,
        };
        assert!(r.vec::<Doc>(DOCS).is_err());
        assert_eq!(r.heap, 0);
        let mut r = Input {
            bytes: &[],
            at: 0,
            heap: 0,
            raw: 0,
            pages: 0,
        };
        assert!(r.claim(HEAP + 1).is_err());
    }
}
