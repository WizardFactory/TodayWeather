//! Pure-Rust text extractor for Korean electronic gazette (`%PDF-1.4`) notices.
//!
//! Decodes FlateDecode content streams and `/ToUnicode` CMaps using `flate2`,
//! reconstructing reading-order lines from positioned `BT..ET` text operators
//! without spawning `pdftotext`. All parsing is strictly bounded in memory,
//! recursion depth, token count, CMap expansion, and output size.

use flate2::read::ZlibDecoder;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::sync::Arc;

pub const MAX_PDF_BYTES: usize = 5 * 1024 * 1024;
const MAX_DECOMPRESSED_STREAM: usize = 5 * 1024 * 1024;
const MAX_TOTAL_DECOMPRESSED: usize = 16 * 1024 * 1024;
const MAX_TREE_DEPTH: usize = 32;
const MAX_PAGES: usize = 256;
const MAX_ARRAY_DEPTH: usize = 32;
const MAX_TOKENS: usize = 200_000;
const MAX_CMAP_ENTRIES: usize = 65_536;
const MAX_TOTAL_CMAP_ENTRIES: usize = 131_072;
const MAX_CMAP_RANGE: u32 = 4096;
const MAX_CMAP_STR_BYTES: usize = 64;
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfError(pub String);

impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PdfError {}

struct StreamCache {
    decoded: HashMap<u32, Option<Arc<[u8]>>>,
    total_inflated: usize,
}

impl StreamCache {
    fn new() -> Self {
        Self {
            decoded: HashMap::new(),
            total_inflated: 0,
        }
    }

    fn get_or_decode(&mut self, oid: u32, obj: &[u8]) -> Result<Option<Arc<[u8]>>, PdfError> {
        if let Some(cached) = self.decoded.get(&oid) {
            return Ok(cached.clone());
        }
        let decoded = decode_stream(obj, &mut self.total_inflated)?.map(Arc::<[u8]>::from);
        self.decoded.insert(oid, decoded.clone());
        Ok(decoded)
    }
}

pub fn extract_text(pdf: &[u8]) -> Result<String, PdfError> {
    if pdf.len() > MAX_PDF_BYTES || !pdf.starts_with(b"%PDF-") {
        return Err(PdfError("invalid gazette PDF".into()));
    }
    let objects = parse_objects(pdf);
    if objects.is_empty() {
        return Err(PdfError("no PDF objects found".into()));
    }

    let mut streams = StreamCache::new();
    let mut parsed_cmaps: HashMap<u32, Arc<CMap>> = HashMap::new();
    let mut font_cmaps: HashMap<u32, Arc<CMap>> = HashMap::new();
    let mut total_cmap_entries = 0usize;

    for (&oid, body) in &objects {
        if let Some(cmap_id) = find_ref(body, b"/ToUnicode") {
            if let Some(existing) = parsed_cmaps.get(&cmap_id) {
                font_cmaps.insert(oid, Arc::clone(existing));
                continue;
            }
            if let Some(cmap_obj) = objects.get(&cmap_id)
                && let Some(stream) = streams.get_or_decode(cmap_id, cmap_obj)?
            {
                let cmap = Arc::new(parse_cmap(&stream, &mut total_cmap_entries)?);
                parsed_cmaps.insert(cmap_id, Arc::clone(&cmap));
                font_cmaps.insert(oid, cmap);
            }
        }
    }

    let pages = ordered_pages(&objects)?;
    if pages.is_empty() {
        return Err(PdfError("no PDF pages found".into()));
    }

    let mut lines = Vec::new();
    let mut token_count = 0usize;
    let mut output_bytes = 0usize;
    let mut total_page_stream_bytes = 0usize;

    for page_id in pages {
        let Some(page_obj) = objects.get(&page_id) else {
            continue;
        };
        let font_map = collect_font_map(page_obj, &objects, &font_cmaps);
        let content_ids = collect_contents(page_obj);
        let mut combined = Vec::new();
        for cid in content_ids {
            if let Some(cobj) = objects.get(&cid)
                && let Some(bytes) = streams.get_or_decode(cid, cobj)?
            {
                if combined.len().saturating_add(bytes.len()) > MAX_DECOMPRESSED_STREAM {
                    return Err(PdfError("decompressed PDF content exceeds limit".into()));
                }
                total_page_stream_bytes = total_page_stream_bytes.saturating_add(bytes.len());
                if total_page_stream_bytes > MAX_TOTAL_DECOMPRESSED {
                    return Err(PdfError("total PDF content exceeds limit".into()));
                }
                combined.extend_from_slice(&bytes);
                combined.push(b'\n');
            }
        }
        extract_page_lines(
            &combined,
            &font_map,
            &mut token_count,
            &mut output_bytes,
            &mut lines,
        )?;
    }

    if lines.is_empty() {
        return Err(PdfError("failed to extract almanac table".into()));
    }
    let joined_len: usize =
        lines.iter().map(String::len).sum::<usize>() + lines.len().saturating_sub(1);
    if joined_len > MAX_OUTPUT_BYTES {
        return Err(PdfError("extracted PDF text exceeds limit".into()));
    }
    Ok(lines.join("\n"))
}

fn parse_objects(pdf: &[u8]) -> BTreeMap<u32, &[u8]> {
    let mut out = BTreeMap::new();
    let mut i = 0;
    while i < pdf.len() {
        if let Some((oid, header_end)) = match_obj_header(pdf, i)
            && let Some(end_pos) = find_endobj(pdf, header_end)
        {
            out.insert(oid, &pdf[header_end..end_pos]);
            i = end_pos + b"endobj".len();
            continue;
        }
        i += 1;
    }
    out
}

fn match_obj_header(data: &[u8], start: usize) -> Option<(u32, usize)> {
    if start > 0 && !matches!(data[start - 1], b'\n' | b'\r' | b' ' | b'\t') {
        return None;
    }
    let mut p = start;
    let oid_start = p;
    while p < data.len() && data[p].is_ascii_digit() {
        p += 1;
    }
    if p == oid_start || p - oid_start > 9 {
        return None;
    }
    let oid: u32 = std::str::from_utf8(&data[oid_start..p])
        .ok()?
        .parse()
        .ok()?;
    let ws1 = p;
    while p < data.len() && matches!(data[p], b' ' | b'\t') {
        p += 1;
    }
    if p == ws1 {
        return None;
    }
    let gen_start = p;
    while p < data.len() && data[p].is_ascii_digit() {
        p += 1;
    }
    if p == gen_start || p - gen_start > 5 {
        return None;
    }
    let ws2 = p;
    while p < data.len() && matches!(data[p], b' ' | b'\t') {
        p += 1;
    }
    if p == ws2 || !data[p..].starts_with(b"obj") {
        return None;
    }
    p += 3;
    if p < data.len() && !matches!(data[p], b'\r' | b'\n' | b' ' | b'\t' | b'<' | b'[') {
        return None;
    }
    Some((oid, p))
}

fn find_endobj(data: &[u8], from: usize) -> Option<usize> {
    let mut p = from;
    while p < data.len() {
        let endobj = find_subslice(&data[p..], b"endobj").map(|r| p + r)?;
        if let Some(rel) = find_subslice(&data[p..endobj], b"stream") {
            let s = p + rel;
            let before_ok = s == from || matches!(data[s - 1], b'\n' | b'\r' | b'>' | b' ' | b'\t');
            let after_s = s + 6;
            let after_ok = after_s < data.len() && matches!(data[after_s], b'\r' | b'\n');
            if before_ok
                && after_ok
                && let Some(erel) = find_subslice(&data[after_s..], b"endstream")
            {
                p = after_s + erel + b"endstream".len();
                continue;
            }
        }
        return Some(endobj);
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn decode_stream(obj: &[u8], total_inflated: &mut usize) -> Result<Option<Vec<u8>>, PdfError> {
    let Some(spos) = find_subslice(obj, b"stream") else {
        return Ok(None);
    };
    let dict = &obj[..spos];
    let mut start = spos + b"stream".len();
    if obj.get(start) == Some(&b'\r') {
        start += 1;
    }
    if obj.get(start) == Some(&b'\n') {
        start += 1;
    } else {
        return Ok(None);
    }
    let Some(erel) = find_subslice(&obj[start..], b"endstream") else {
        return Ok(None);
    };
    let mut raw = &obj[start..start + erel];
    while raw.ends_with(b"\n") || raw.ends_with(b"\r") {
        raw = &raw[..raw.len() - 1];
    }
    if find_subslice(dict, b"/FlateDecode").is_some() {
        let mut decoder = ZlibDecoder::new(raw);
        let mut out = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = decoder
                .read(&mut buf)
                .map_err(|_| PdfError("flate decode failed".into()))?;
            if n == 0 {
                break;
            }
            if out.len().saturating_add(n) > MAX_DECOMPRESSED_STREAM {
                return Err(PdfError("decompressed PDF stream exceeds limit".into()));
            }
            if total_inflated.saturating_add(n) > MAX_TOTAL_DECOMPRESSED {
                return Err(PdfError("total decompressed PDF bytes exceed limit".into()));
            }
            *total_inflated += n;
            out.extend_from_slice(&buf[..n]);
        }
        Ok(Some(out))
    } else {
        if raw.len() > MAX_DECOMPRESSED_STREAM {
            return Err(PdfError("PDF stream exceeds limit".into()));
        }
        if total_inflated.saturating_add(raw.len()) > MAX_TOTAL_DECOMPRESSED {
            return Err(PdfError("total decompressed PDF bytes exceed limit".into()));
        }
        *total_inflated += raw.len();
        Ok(Some(raw.to_vec()))
    }
}

fn find_ref(data: &[u8], key: &[u8]) -> Option<u32> {
    let mut p = 0;
    while let Some(rel) = find_subslice(&data[p..], key) {
        let mut cur = p + rel + key.len();
        if cur < data.len() && data[cur].is_ascii_alphanumeric() {
            p = cur;
            continue;
        }
        while cur < data.len() && data[cur].is_ascii_whitespace() {
            cur += 1;
        }
        if let Some((oid, _)) = parse_indirect_ref(data, cur) {
            return Some(oid);
        }
        p = cur;
    }
    None
}

fn parse_indirect_ref(data: &[u8], mut p: usize) -> Option<(u32, usize)> {
    let start = p;
    while p < data.len() && data[p].is_ascii_digit() {
        p += 1;
    }
    if p == start {
        return None;
    }
    let oid: u32 = std::str::from_utf8(&data[start..p]).ok()?.parse().ok()?;
    while p < data.len() && data[p].is_ascii_whitespace() {
        p += 1;
    }
    let gstart = p;
    while p < data.len() && data[p].is_ascii_digit() {
        p += 1;
    }
    if p == gstart {
        return None;
    }
    while p < data.len() && data[p].is_ascii_whitespace() {
        p += 1;
    }
    if data.get(p) == Some(&b'R') {
        Some((oid, p + 1))
    } else {
        None
    }
}

fn find_refs_in_array(data: &[u8], key: &[u8]) -> Vec<u32> {
    let Some(rel) = find_subslice(data, key) else {
        return Vec::new();
    };
    let mut p = rel + key.len();
    while p < data.len() && data[p].is_ascii_whitespace() {
        p += 1;
    }
    if data.get(p) != Some(&b'[') {
        return Vec::new();
    }
    p += 1;
    let mut out = Vec::new();
    while p < data.len() && data[p] != b']' {
        if data[p].is_ascii_digit()
            && let Some((oid, next)) = parse_indirect_ref(data, p)
        {
            out.push(oid);
            p = next;
            continue;
        }
        p += 1;
    }
    out
}

fn ordered_pages(objects: &BTreeMap<u32, &[u8]>) -> Result<Vec<u32>, PdfError> {
    let root = objects.iter().find_map(|(_, body)| {
        (find_subslice(body, b"/Type").is_some() && find_subslice(body, b"/Catalog").is_some())
            .then(|| find_ref(body, b"/Pages"))
            .flatten()
    });
    if let Some(root_id) = root {
        let mut out = Vec::new();
        let mut visited = HashMap::new();
        collect_page_tree(root_id, objects, &mut visited, &mut out, 0)?;
        if !out.is_empty() {
            return Ok(out);
        }
    }
    let mut fallback = Vec::new();
    for (&oid, body) in objects {
        if is_page_object(body) {
            if fallback.len() >= MAX_PAGES {
                return Err(PdfError("PDF page count exceeds limit".into()));
            }
            fallback.push(oid);
        }
    }
    Ok(fallback)
}

fn is_page_object(body: &[u8]) -> bool {
    let mut p = 0;
    while let Some(rel) = find_subslice(&body[p..], b"/Page") {
        let end = p + rel + b"/Page".len();
        if body.get(end).is_none_or(|b| !b.is_ascii_alphanumeric()) {
            return true;
        }
        p = end;
    }
    false
}

fn collect_page_tree(
    oid: u32,
    objects: &BTreeMap<u32, &[u8]>,
    visited: &mut HashMap<u32, ()>,
    out: &mut Vec<u32>,
    depth: usize,
) -> Result<(), PdfError> {
    if depth > MAX_TREE_DEPTH {
        return Err(PdfError("PDF page tree nesting exceeds limit".into()));
    }
    if visited.insert(oid, ()).is_some() {
        return Ok(());
    }
    let Some(body) = objects.get(&oid) else {
        return Ok(());
    };
    if find_subslice(body, b"/Pages").is_some() {
        let kids = find_refs_in_array(body, b"/Kids");
        if !kids.is_empty() {
            for kid in kids {
                collect_page_tree(kid, objects, visited, out, depth + 1)?;
            }
            return Ok(());
        }
    }
    if out.len() >= MAX_PAGES {
        return Err(PdfError("PDF page count exceeds limit".into()));
    }
    out.push(oid);
    Ok(())
}

fn collect_contents(page_obj: &[u8]) -> Vec<u32> {
    let arr = find_refs_in_array(page_obj, b"/Contents");
    if !arr.is_empty() {
        return arr;
    }
    find_ref(page_obj, b"/Contents").into_iter().collect()
}

fn collect_font_map<'a>(
    page_obj: &[u8],
    objects: &BTreeMap<u32, &[u8]>,
    font_cmaps: &'a HashMap<u32, Arc<CMap>>,
) -> HashMap<String, &'a CMap> {
    let mut res = page_obj;
    if let Some(rid) = find_ref(page_obj, b"/Resources")
        && let Some(robj) = objects.get(&rid)
    {
        res = robj;
    }
    if let Some(fid) = find_ref(res, b"/Font")
        && let Some(fobj) = objects.get(&fid)
    {
        res = fobj;
    }
    let mut out = HashMap::new();
    let mut p = 0;
    while p < res.len() {
        if res[p] == b'/' {
            let nstart = p + 1;
            let mut nend = nstart;
            while nend < res.len()
                && (res[nend].is_ascii_alphanumeric() || matches!(res[nend], b'_' | b'+' | b'-'))
            {
                nend += 1;
            }
            if nend > nstart {
                let mut cur = nend;
                while cur < res.len() && res[cur].is_ascii_whitespace() {
                    cur += 1;
                }
                if let Some((rid, next)) = parse_indirect_ref(res, cur) {
                    if let Some(cmap) = font_cmaps.get(&rid)
                        && let Ok(name) = std::str::from_utf8(&res[nstart..nend])
                    {
                        out.insert(name.to_owned(), cmap.as_ref());
                    }
                    p = next;
                    continue;
                }
            }
        }
        p += 1;
    }
    out
}

struct CMap {
    map: HashMap<u32, String>,
    two_byte: bool,
}

fn insert_cmap_entry(
    map: &mut HashMap<u32, String>,
    total_entries: &mut usize,
    code: u32,
    value: String,
) -> Result<(), PdfError> {
    if value.len() > MAX_CMAP_STR_BYTES {
        return Err(PdfError("CMap glyph string exceeds limit".into()));
    }
    if !map.contains_key(&code) {
        if map.len() >= MAX_CMAP_ENTRIES || *total_entries >= MAX_TOTAL_CMAP_ENTRIES {
            return Err(PdfError("CMap entry count exceeds limit".into()));
        }
        *total_entries += 1;
    }
    map.insert(code, value);
    Ok(())
}

fn parse_cmap(bytes: &[u8], total_entries: &mut usize) -> Result<CMap, PdfError> {
    let text = String::from_utf8_lossy(bytes);
    let mut map = HashMap::new();
    let mut two_byte = false;
    for section in sections(&text, "begincodespacerange", "endcodespacerange") {
        if hex_tokens(section).iter().any(|h| h.len() >= 4) {
            two_byte = true;
        }
    }
    for section in sections(&text, "beginbfchar", "endbfchar") {
        let tokens = hex_tokens(section);
        for pair in tokens.as_chunks::<2>().0 {
            if pair[0].len() >= 4 {
                two_byte = true;
            }
            if let Ok(code) = u32::from_str_radix(&pair[0], 16)
                && let Some(decoded) = decode_utf16be_hex(&pair[1])
            {
                insert_cmap_entry(&mut map, total_entries, code, decoded)?;
            }
        }
    }
    for section in sections(&text, "beginbfrange", "endbfrange") {
        parse_bfrange(section, &mut map, total_entries)?;
    }
    if map.keys().any(|&k| k > 255) {
        two_byte = true;
    }
    Ok(CMap { map, two_byte })
}

fn sections<'a>(text: &'a str, start_kw: &str, end_kw: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(s) = rest.find(start_kw) {
        let after = &rest[s + start_kw.len()..];
        let Some(e) = after.find(end_kw) else {
            break;
        };
        out.push(&after[..e]);
        rest = &after[e + end_kw.len()..];
    }
    out
}

fn hex_tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let start = i + 1;
            i = start;
            while i < bytes.len() && bytes[i] != b'>' {
                i += 1;
            }
            if i < bytes.len() {
                let hex: String = s[start..i]
                    .chars()
                    .filter(|c| c.is_ascii_hexdigit())
                    .collect();
                if !hex.is_empty() {
                    out.push(hex);
                }
            }
        }
        i += 1;
    }
    out
}

fn parse_bfrange(
    section: &str,
    map: &mut HashMap<u32, String>,
    total_entries: &mut usize,
) -> Result<(), PdfError> {
    let bytes = section.as_bytes();
    let mut i = 0;
    let read_hex = |pos: &mut usize| -> Option<String> {
        while *pos < bytes.len() && bytes[*pos].is_ascii_whitespace() {
            *pos += 1;
        }
        if bytes.get(*pos) != Some(&b'<') {
            return None;
        }
        *pos += 1;
        let start = *pos;
        while *pos < bytes.len() && bytes[*pos] != b'>' {
            *pos += 1;
        }
        if *pos >= bytes.len() {
            return None;
        }
        let hex = section[start..*pos]
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .collect();
        *pos += 1;
        Some(hex)
    };
    while i < bytes.len() {
        while i < bytes.len() && bytes[i] != b'<' {
            i += 1;
        }
        let Some(s_hex) = read_hex(&mut i) else {
            break;
        };
        let Some(e_hex) = read_hex(&mut i) else {
            break;
        };
        let (Ok(start), Ok(end)) = (
            u32::from_str_radix(&s_hex, 16),
            u32::from_str_radix(&e_hex, 16),
        ) else {
            return Err(PdfError("invalid CMap bfrange bounds".into()));
        };
        if start > end {
            return Err(PdfError("inverted CMap bfrange bounds".into()));
        }
        let span = end - start;
        if span > MAX_CMAP_RANGE {
            return Err(PdfError("CMap bfrange span exceeds limit".into()));
        }
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if bytes.get(i) == Some(&b'<') {
            let Some(base_hex) = read_hex(&mut i) else {
                return Err(PdfError("unterminated CMap bfrange base".into()));
            };
            let base = u32::from_str_radix(&base_hex, 16)
                .map_err(|_| PdfError("invalid CMap bfrange base".into()))?;
            for offset in 0..=span {
                let code = start
                    .checked_add(offset)
                    .ok_or_else(|| PdfError("CMap bfrange code overflow".into()))?;
                let target = base
                    .checked_add(offset)
                    .ok_or_else(|| PdfError("CMap bfrange target overflow".into()))?;
                if let Some(ch) = char::from_u32(target) {
                    insert_cmap_entry(map, total_entries, code, ch.to_string())?;
                }
            }
        } else if bytes.get(i) == Some(&b'[') {
            i += 1;
            let mut idx = 0u32;
            let mut closed = false;
            while i < bytes.len() {
                if bytes[i] == b']' {
                    closed = true;
                    i += 1;
                    break;
                }
                if bytes[i] == b'<' {
                    let Some(val_hex) = read_hex(&mut i) else {
                        return Err(PdfError("unterminated CMap bfrange array hex".into()));
                    };
                    if idx > span {
                        return Err(PdfError("CMap bfrange array exceeds range bounds".into()));
                    }
                    let code = start
                        .checked_add(idx)
                        .ok_or_else(|| PdfError("CMap bfrange code overflow".into()))?;
                    if let Some(decoded) = decode_utf16be_hex(&val_hex) {
                        insert_cmap_entry(map, total_entries, code, decoded)?;
                    }
                    idx = idx
                        .checked_add(1)
                        .ok_or_else(|| PdfError("CMap bfrange index overflow".into()))?;
                    continue;
                }
                i += 1;
            }
            if !closed {
                return Err(PdfError("unterminated CMap bfrange array".into()));
            }
        }
    }
    Ok(())
}

fn decode_utf16be_hex(hex: &str) -> Option<String> {
    let bytes = hex_to_bytes(hex);
    if bytes.is_empty() || !bytes.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    Some(String::from_utf16_lossy(&units))
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    let clean: Vec<u8> = hex.bytes().filter(|b| b.is_ascii_hexdigit()).collect();
    let mut out = Vec::with_capacity(clean.len().div_ceil(2));
    let mut i = 0;
    while i < clean.len() {
        let hi = hex_nibble(clean[i]);
        let lo = if i + 1 < clean.len() {
            hex_nibble(clean[i + 1])
        } else {
            0
        };
        out.push((hi << 4) | lo);
        i += 2;
    }
    out
}

fn hex_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => 0,
    }
}

#[derive(Debug)]
enum Token {
    Name(String),
    Number(f64),
    Hex(Vec<u8>),
    Lit(Vec<u8>),
    Array(Vec<Token>),
    Op(String),
}

fn push_token(
    tokens: &mut Vec<Token>,
    token_count: &mut usize,
    tok: Token,
) -> Result<(), PdfError> {
    if *token_count >= MAX_TOKENS {
        return Err(PdfError("PDF token count exceeds limit".into()));
    }
    *token_count += 1;
    tokens.push(tok);
    Ok(())
}

fn tokenize_content(
    data: &[u8],
    nesting_depth: usize,
    token_count: &mut usize,
) -> Result<Vec<Token>, PdfError> {
    if nesting_depth > MAX_ARRAY_DEPTH {
        return Err(PdfError("PDF array nesting exceeds limit".into()));
    }
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b == b'%' {
            while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                i += 1;
            }
            continue;
        }
        if b == b'/' {
            i += 1;
            let start = i;
            while i < data.len()
                && !data[i].is_ascii_whitespace()
                && !matches!(
                    data[i],
                    b'/' | b'<' | b'>' | b'[' | b']' | b'(' | b')' | b'%'
                )
            {
                i += 1;
            }
            push_token(
                &mut tokens,
                token_count,
                Token::Name(String::from_utf8_lossy(&data[start..i]).into_owned()),
            )?;
            continue;
        }
        if b == b'<' {
            if data.get(i + 1) == Some(&b'<') {
                i += 2;
                continue;
            }
            i += 1;
            let start = i;
            while i < data.len() && data[i] != b'>' {
                i += 1;
            }
            if i >= data.len() {
                return Err(PdfError("unterminated PDF hex string".into()));
            }
            let hex = String::from_utf8_lossy(&data[start..i]);
            push_token(&mut tokens, token_count, Token::Hex(hex_to_bytes(&hex)))?;
            i += 1;
            continue;
        }
        if matches!(b, b'>' | b']' | b')') {
            i += 1;
            continue;
        }
        if b == b'(' {
            let (lit, next) = read_literal_string(data, i)?;
            push_token(&mut tokens, token_count, Token::Lit(lit))?;
            i = next;
            continue;
        }
        if b == b'[' {
            i += 1;
            let start = i;
            let mut depth = 1usize;
            while i < data.len() && depth > 0 {
                match data[i] {
                    b'(' => {
                        let (_, next) = read_literal_string(data, i)?;
                        i = next;
                    }
                    b'%' => {
                        while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                            i += 1;
                        }
                    }
                    b'[' => {
                        depth += 1;
                        if depth > MAX_ARRAY_DEPTH {
                            return Err(PdfError("PDF array nesting exceeds limit".into()));
                        }
                        i += 1;
                    }
                    b']' => {
                        depth -= 1;
                        i += 1;
                    }
                    _ => i += 1,
                }
            }
            if depth != 0 || i <= start {
                return Err(PdfError("unterminated PDF array".into()));
            }
            let end = i - 1;
            let inner = tokenize_content(&data[start..end], nesting_depth + 1, token_count)?;
            push_token(&mut tokens, token_count, Token::Array(inner))?;
            continue;
        }
        let start = i;
        while i < data.len()
            && !data[i].is_ascii_whitespace()
            && !matches!(
                data[i],
                b'/' | b'<' | b'>' | b'[' | b']' | b'(' | b')' | b'%'
            )
        {
            i += 1;
        }
        if i == start {
            i += 1;
            continue;
        }
        let word = String::from_utf8_lossy(&data[start..i]);
        let tok = if let Ok(num) = word.parse::<f64>() {
            Token::Number(num)
        } else {
            Token::Op(word.into_owned())
        };
        push_token(&mut tokens, token_count, tok)?;
    }
    Ok(tokens)
}

fn read_literal_string(data: &[u8], mut i: usize) -> Result<(Vec<u8>, usize), PdfError> {
    i += 1; // skip '('
    let mut out = Vec::new();
    let mut depth = 1usize;
    while i < data.len() && depth > 0 {
        match data[i] {
            b'\\' => {
                i += 1;
                if i >= data.len() {
                    break;
                }
                match data[i] {
                    b'n' => {
                        out.push(b'\n');
                        i += 1;
                    }
                    b'r' => {
                        out.push(b'\r');
                        i += 1;
                    }
                    b't' => {
                        out.push(b'\t');
                        i += 1;
                    }
                    b'b' => {
                        out.push(8);
                        i += 1;
                    }
                    b'f' => {
                        out.push(12);
                        i += 1;
                    }
                    b'(' | b')' | b'\\' => {
                        out.push(data[i]);
                        i += 1;
                    }
                    b'0'..=b'7' => {
                        let mut val = 0u8;
                        for _ in 0..3 {
                            if i < data.len() && (b'0'..=b'7').contains(&data[i]) {
                                val = val.wrapping_mul(8).wrapping_add(data[i] - b'0');
                                i += 1;
                            } else {
                                break;
                            }
                        }
                        out.push(val);
                    }
                    b'\r' => {
                        i += 1;
                        if data.get(i) == Some(&b'\n') {
                            i += 1;
                        }
                    }
                    b'\n' => i += 1,
                    other => {
                        out.push(other);
                        i += 1;
                    }
                }
            }
            b'(' => {
                depth += 1;
                if depth > MAX_ARRAY_DEPTH {
                    return Err(PdfError("PDF literal string nesting exceeds limit".into()));
                }
                out.push(b'(');
                i += 1;
            }
            b')' => {
                depth -= 1;
                if depth > 0 {
                    out.push(b')');
                }
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
        if out.len() > MAX_DECOMPRESSED_STREAM {
            return Err(PdfError("PDF literal string exceeds limit".into()));
        }
    }
    if depth != 0 {
        return Err(PdfError("unterminated PDF literal string".into()));
    }
    Ok((out, i))
}

fn push_bounded(out: &mut String, output_bytes: &mut usize, s: &str) -> Result<(), PdfError> {
    if output_bytes.saturating_add(s.len()) > MAX_OUTPUT_BYTES {
        return Err(PdfError("extracted PDF text exceeds limit".into()));
    }
    *output_bytes += s.len();
    out.push_str(s);
    Ok(())
}

fn decode_text(
    raw: &[u8],
    cmap: Option<&CMap>,
    output_bytes: &mut usize,
) -> Result<String, PdfError> {
    let mut out = String::new();
    if let Some(cmap) = cmap {
        if cmap.two_byte && raw.len().is_multiple_of(2) {
            for pair in raw.as_chunks::<2>().0 {
                let code = u32::from(u16::from_be_bytes([pair[0], pair[1]]));
                if let Some(s) = cmap.map.get(&code) {
                    push_bounded(&mut out, output_bytes, s)?;
                }
            }
        } else {
            for &b in raw {
                if let Some(s) = cmap.map.get(&u32::from(b)) {
                    push_bounded(&mut out, output_bytes, s)?;
                } else if (32..127).contains(&b) {
                    let mut buf = [0u8; 1];
                    buf[0] = b;
                    push_bounded(
                        &mut out,
                        output_bytes,
                        std::str::from_utf8(&buf).unwrap_or(""),
                    )?;
                }
            }
        }
        return Ok(out);
    }
    for &b in raw {
        if (32..127).contains(&b) {
            let buf = [b];
            push_bounded(
                &mut out,
                output_bytes,
                std::str::from_utf8(&buf).unwrap_or(""),
            )?;
        }
    }
    Ok(out)
}

fn extract_page_lines(
    stream: &[u8],
    font_map: &HashMap<String, &CMap>,
    token_count: &mut usize,
    output_bytes: &mut usize,
    out_lines: &mut Vec<String>,
) -> Result<(), PdfError> {
    let tokens = tokenize_content(stream, 0, token_count)?;
    let mut operands: Vec<&Token> = Vec::new();
    let mut in_text = false;
    let mut cur_font: Option<String> = None;
    let mut font_size = 10.0_f64;
    let mut tx = 0.0_f64;
    let mut ty = 0.0_f64;
    let mut leading = 0.0_f64;
    let mut spans: Vec<(f64, f64, f64, String)> = Vec::new();

    for tok in &tokens {
        match tok {
            Token::Op(op) => {
                match op.as_str() {
                    "BT" => {
                        in_text = true;
                        tx = 0.0;
                        ty = 0.0;
                    }
                    "ET" => in_text = false,
                    "Tf" if operands.len() >= 2 => {
                        if let (Token::Name(name), Token::Number(sz)) =
                            (operands[operands.len() - 2], operands[operands.len() - 1])
                        {
                            cur_font = Some(name.clone());
                            let abs = sz.abs();
                            font_size = if abs > 0.1 { abs } else { 10.0 };
                        }
                    }
                    "TL" if !operands.is_empty() => {
                        if let Token::Number(v) = operands[operands.len() - 1] {
                            leading = *v;
                        }
                    }
                    "Tm" if in_text && operands.len() >= 6 => {
                        let base = operands.len() - 6;
                        if let (Token::Number(e), Token::Number(f)) =
                            (operands[base + 4], operands[base + 5])
                        {
                            tx = *e;
                            ty = *f;
                        }
                    }
                    "Td" | "TD" if in_text && operands.len() >= 2 => {
                        let base = operands.len() - 2;
                        if let (Token::Number(dx), Token::Number(dy)) =
                            (operands[base], operands[base + 1])
                        {
                            tx += *dx;
                            ty += *dy;
                            if op == "TD" {
                                leading = -*dy;
                            }
                        }
                    }
                    "T*" if in_text => {
                        ty -= leading;
                    }
                    "Tj" | "'" if in_text && !operands.is_empty() => {
                        if op == "'" {
                            ty -= leading;
                        }
                        let cmap = cur_font
                            .as_deref()
                            .and_then(|name| font_map.get(name).copied());
                        let txt = match operands[operands.len() - 1] {
                            Token::Hex(b) | Token::Lit(b) => decode_text(b, cmap, output_bytes)?,
                            _ => String::new(),
                        };
                        if !txt.is_empty() {
                            spans.push((ty, tx, font_size, txt));
                        }
                    }
                    "TJ" if in_text && !operands.is_empty() => {
                        let cmap = cur_font
                            .as_deref()
                            .and_then(|name| font_map.get(name).copied());
                        if let Token::Array(items) = operands[operands.len() - 1] {
                            let mut txt = String::new();
                            for item in items {
                                match item {
                                    Token::Hex(b) | Token::Lit(b) => {
                                        txt.push_str(&decode_text(b, cmap, output_bytes)?);
                                    }
                                    Token::Number(adj) if *adj < -180.0 => {
                                        push_bounded(&mut txt, output_bytes, " ")?;
                                    }
                                    _ => {}
                                }
                            }
                            if !txt.is_empty() {
                                spans.push((ty, tx, font_size, txt));
                            }
                        }
                    }
                    _ => {}
                }
                operands.clear();
            }
            other => operands.push(other),
        }
    }

    spans.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.total_cmp(&b.1)));
    type SpanRow = (f64, Vec<(f64, f64, String)>);
    let mut rows: Vec<SpanRow> = Vec::new();
    for (sy, sx, fs, txt) in spans {
        if let Some(last) = rows.last_mut()
            && (last.0 - sy).abs() <= 2.5
        {
            last.1.push((sx, fs, txt));
        } else {
            rows.push((sy, vec![(sx, fs, txt)]));
        }
    }
    for (_, mut cols) in rows {
        cols.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut line = String::new();
        let mut prev_end: Option<f64> = None;
        for (sx, fs, txt) in cols {
            let width: f64 = txt
                .chars()
                .map(|ch| if ch as u32 > 127 { fs } else { fs * 0.55 })
                .sum();
            if let Some(end) = prev_end
                && sx - end > fs * 0.35
            {
                line.push(' ');
            }
            line.push_str(&txt);
            prev_end = Some(sx + width);
        }
        out_lines.push(line);
    }
    Ok(())
}
