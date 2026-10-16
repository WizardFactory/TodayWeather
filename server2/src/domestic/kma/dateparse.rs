//! `Date.parse` of the legacy runtime: a port of V8's date parser as shipped in Node 16.20.2
//! (V8 9.4; `deps/v8/src/date/dateparser.h`, `dateparser-inl.h`, `dateparser.cc` and
//! `ParseDateTimeString`, `MakeDay`, `MakeTime`, `MakeDate` in `src/builtins/builtins-date.cc`),
//! with the process time zone UTC (local time equals UTC).
//!
//! The port keeps V8's control flow and integer arithmetic, so every string gives the value the
//! legacy `Date.parse`/`new Date(string)` gives: the ES5 ISO form first, then the permissive
//! legacy parser for the rest. It is checked against the pinned Node 16.20.2 binary over a
//! generated corpus (`tests/domestic/fixtures/v8-date-parse.json`).
//!
//! Copyright 2011 the V8 project authors. All rights reserved.
//!
//! Redistribution and use in source and binary forms, with or without modification, are
//! permitted provided that the following conditions are met:
//!
//! * Redistributions of source code must retain the above copyright notice, this list of
//!   conditions and the following disclaimer.
//! * Redistributions in binary form must reproduce the above copyright notice, this list of
//!   conditions and the following disclaimer in the documentation and/or other materials
//!   provided with the distribution.
//! * Neither the name of Google Inc. nor the names of its contributors may be used to endorse
//!   or promote products derived from this software without specific prior written permission.
//!
//! THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//! OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
//! MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
//! COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
//! EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
//! SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
//! HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//! (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
//! IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const K_NONE: i32 = i32::MAX;
const K_MAX_SIGNIFICANT_DIGITS: i32 = 9;
/// `Smi::kMaxValue` of the 64-bit build without pointer compression.
const SMI_MAX: u32 = i32::MAX as u32;

fn between(x: i32, lo: i32, hi: i32) -> bool {
    (x.wrapping_sub(lo) as u32) <= (hi.wrapping_sub(lo) as u32)
}
fn is_minute(x: i32) -> bool {
    between(x, 0, 59)
}
fn is_hour(x: i32) -> bool {
    between(x, 0, 23)
}
fn is_second(x: i32) -> bool {
    between(x, 0, 59)
}
fn is_hour12(x: i32) -> bool {
    between(x, 0, 12)
}
fn is_millisecond(x: i32) -> bool {
    between(x, 0, 999)
}
fn is_month(x: i32) -> bool {
    between(x, 1, 12)
}
fn is_day(x: i32) -> bool {
    between(x, 1, 31)
}

struct InputReader<'a> {
    index: usize,
    buffer: &'a [u16],
    ch: u32,
}
impl<'a> InputReader<'a> {
    fn new(buffer: &'a [u16]) -> Self {
        let mut r = Self {
            index: 0,
            buffer,
            ch: 0,
        };
        r.next();
        r
    }
    fn position(&self) -> usize {
        self.index
    }
    fn next(&mut self) {
        self.ch = self.buffer.get(self.index).map_or(0, |c| u32::from(*c));
        self.index += 1;
    }
    fn read_unsigned_numeral(&mut self) -> i32 {
        let mut n: i32 = 0;
        let mut i = 0;
        while self.ch == u32::from(b'0') {
            self.next();
        }
        while self.is_ascii_digit() {
            if i < K_MAX_SIGNIFICANT_DIGITS {
                n = n * 10 + (self.ch - u32::from(b'0')) as i32;
            }
            i += 1;
            self.next();
        }
        n
    }
    fn read_word(&mut self, prefix: &mut [u32; 3]) -> usize {
        let mut len = 0;
        while self.is_ascii_alpha_or_above() {
            if len < 3 {
                // AsciiAlphaToLower: `c | 0x20` for any character.
                prefix[len] = self.ch | 0x20;
            }
            self.next();
            len += 1;
        }
        for p in prefix.iter_mut().skip(len) {
            *p = 0;
        }
        len
    }
    fn skip(&mut self, c: u8) -> bool {
        if self.ch == u32::from(c) {
            self.next();
            true
        } else {
            false
        }
    }
    fn skip_white_space(&mut self) -> bool {
        if is_white_space_or_line_terminator(self.ch) {
            self.next();
            true
        } else {
            false
        }
    }
    fn skip_parentheses(&mut self) -> bool {
        if self.ch != u32::from(b'(') {
            return false;
        }
        let mut balance = 0;
        loop {
            if self.ch == u32::from(b')') {
                balance -= 1;
            } else if self.ch == u32::from(b'(') {
                balance += 1;
            }
            self.next();
            if !(balance > 0 && self.ch != 0) {
                break;
            }
        }
        true
    }
    fn is_end(&self) -> bool {
        self.ch == 0
    }
    fn is_ascii_digit(&self) -> bool {
        (u32::from(b'0')..=u32::from(b'9')).contains(&self.ch)
    }
    fn is_ascii_alpha_or_above(&self) -> bool {
        self.ch >= u32::from(b'A')
    }
}
/// V8 `IsWhiteSpaceOrLineTerminator` (ECMAScript WhiteSpace and LineTerminator).
fn is_white_space_or_line_terminator(c: u32) -> bool {
    matches!(
        c,
        0x09 | 0x0B | 0x0C | 0x20 | 0xA0 | 0x1680 | 0x2000
            ..=0x200A | 0x202F | 0x205F | 0x3000 | 0xFEFF | 0x0A | 0x0D | 0x2028 | 0x2029
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum KeywordType {
    Invalid,
    MonthName,
    TimeZoneName,
    TimeSeparator,
    AmPm,
}
const KEYWORDS: [([u8; 3], KeywordType, i32); 28] = [
    (*b"jan", KeywordType::MonthName, 1),
    (*b"feb", KeywordType::MonthName, 2),
    (*b"mar", KeywordType::MonthName, 3),
    (*b"apr", KeywordType::MonthName, 4),
    (*b"may", KeywordType::MonthName, 5),
    (*b"jun", KeywordType::MonthName, 6),
    (*b"jul", KeywordType::MonthName, 7),
    (*b"aug", KeywordType::MonthName, 8),
    (*b"sep", KeywordType::MonthName, 9),
    (*b"oct", KeywordType::MonthName, 10),
    (*b"nov", KeywordType::MonthName, 11),
    (*b"dec", KeywordType::MonthName, 12),
    (*b"am\0", KeywordType::AmPm, 0),
    (*b"pm\0", KeywordType::AmPm, 12),
    (*b"ut\0", KeywordType::TimeZoneName, 0),
    (*b"utc", KeywordType::TimeZoneName, 0),
    (*b"z\0\0", KeywordType::TimeZoneName, 0),
    (*b"gmt", KeywordType::TimeZoneName, 0),
    (*b"cdt", KeywordType::TimeZoneName, -5),
    (*b"cst", KeywordType::TimeZoneName, -6),
    (*b"edt", KeywordType::TimeZoneName, -4),
    (*b"est", KeywordType::TimeZoneName, -5),
    (*b"mdt", KeywordType::TimeZoneName, -6),
    (*b"mst", KeywordType::TimeZoneName, -7),
    (*b"pdt", KeywordType::TimeZoneName, -7),
    (*b"pst", KeywordType::TimeZoneName, -8),
    (*b"t\0\0", KeywordType::TimeSeparator, 0),
    (*b"\0\0\0", KeywordType::Invalid, 0),
];
/// `KeywordTable::Lookup`: the matching entry (the final `Invalid` entry when none matches).
fn lookup(prefix: &[u32; 3], len: usize) -> (KeywordType, i32) {
    for (word, kind, value) in KEYWORDS {
        if kind == KeywordType::Invalid {
            return (kind, value);
        }
        let mut j = 0;
        while j < 3 && prefix[j] == u32::from(word[j]) {
            j += 1;
        }
        if j == 3 && (len <= 3 || kind == KeywordType::MonthName) {
            return (kind, value);
        }
    }
    (KeywordType::Invalid, 0)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Tag {
    Invalid,
    Unknown,
    WhiteSpace,
    Number,
    Symbol,
    EndOfInput,
    Keyword(KeywordType),
}
#[derive(Clone, Copy, Debug)]
struct Token {
    tag: Tag,
    length: usize,
    value: i32,
}
impl Token {
    fn is_invalid(&self) -> bool {
        self.tag == Tag::Invalid
    }
    fn is_number(&self) -> bool {
        self.tag == Tag::Number
    }
    fn is_white_space(&self) -> bool {
        self.tag == Tag::WhiteSpace
    }
    fn is_end_of_input(&self) -> bool {
        self.tag == Tag::EndOfInput
    }
    fn is_keyword(&self) -> bool {
        matches!(self.tag, Tag::Keyword(_))
    }
    fn keyword_type(&self) -> KeywordType {
        match self.tag {
            Tag::Keyword(k) => k,
            _ => KeywordType::Invalid,
        }
    }
    fn is_symbol(&self, c: u8) -> bool {
        self.tag == Tag::Symbol && self.value == i32::from(c)
    }
    fn is_keyword_type(&self, k: KeywordType) -> bool {
        self.tag == Tag::Keyword(k)
    }
    fn is_fixed_length_number(&self, length: usize) -> bool {
        self.is_number() && self.length == length
    }
    fn is_ascii_sign(&self) -> bool {
        self.tag == Tag::Symbol && (self.value == i32::from(b'-') || self.value == i32::from(b'+'))
    }
    fn ascii_sign(&self) -> i32 {
        44 - self.value
    }
    fn is_keyword_z(&self) -> bool {
        self.is_keyword_type(KeywordType::TimeZoneName) && self.length == 1 && self.value == 0
    }
    fn number(n: i32, length: usize) -> Self {
        Self {
            tag: Tag::Number,
            length,
            value: n,
        }
    }
    fn symbol(c: u8) -> Self {
        Self {
            tag: Tag::Symbol,
            length: 1,
            value: i32::from(c),
        }
    }
    fn simple(tag: Tag, length: usize) -> Self {
        Self {
            tag,
            length,
            value: -1,
        }
    }
}

struct Tokenizer<'a> {
    input: InputReader<'a>,
    next: Token,
}
impl<'a> Tokenizer<'a> {
    fn new(mut input: InputReader<'a>) -> Self {
        let next = scan(&mut input);
        Self { input, next }
    }
    fn next(&mut self) -> Token {
        let result = self.next;
        self.next = scan(&mut self.input);
        result
    }
    fn peek(&self) -> Token {
        self.next
    }
    fn skip_symbol(&mut self, c: u8) -> bool {
        if self.next.is_symbol(c) {
            self.next = scan(&mut self.input);
            true
        } else {
            false
        }
    }
}
fn scan(input: &mut InputReader<'_>) -> Token {
    let pre_pos = input.position();
    if input.is_end() {
        return Token::simple(Tag::EndOfInput, 0);
    }
    if input.is_ascii_digit() {
        let n = input.read_unsigned_numeral();
        let length = input.position() - pre_pos;
        return Token::number(n, length);
    }
    for c in *b":-+.)" {
        if input.skip(c) {
            return Token::symbol(c);
        }
    }
    if input.is_ascii_alpha_or_above() {
        let mut prefix = [0u32; 3];
        let length = input.read_word(&mut prefix);
        let (kind, value) = lookup(&prefix, length);
        return Token {
            tag: Tag::Keyword(kind),
            length,
            value,
        };
    }
    if input.skip_white_space() {
        return Token::simple(Tag::WhiteSpace, input.position() - pre_pos);
    }
    if input.skip_parentheses() {
        return Token::simple(Tag::Unknown, 1);
    }
    input.next();
    Token::simple(Tag::Unknown, 1)
}
fn read_milliseconds(token: Token) -> i32 {
    let mut number = token.value;
    let mut length = token.length as i32;
    if length < 3 {
        if length == 1 {
            number *= 100;
        } else if length == 2 {
            number *= 10;
        }
    } else if length > 3 {
        if length > K_MAX_SIGNIFICANT_DIGITS {
            length = K_MAX_SIGNIFICANT_DIGITS;
        }
        let mut factor = 1;
        loop {
            factor *= 10;
            length -= 1;
            if length <= 3 {
                break;
            }
        }
        number /= factor;
    }
    number
}

struct TimeZoneComposer {
    sign: i32,
    hour: i32,
    minute: i32,
}
impl TimeZoneComposer {
    fn set(&mut self, offset_in_hours: i32) {
        self.sign = if offset_in_hours < 0 { -1 } else { 1 };
        self.hour = offset_in_hours * self.sign;
        self.minute = 0;
    }
    fn set_sign(&mut self, sign: i32) {
        self.sign = if sign < 0 { -1 } else { 1 };
    }
    fn is_expecting(&self, n: i32) -> bool {
        self.hour != K_NONE && self.minute == K_NONE && is_minute(n)
    }
    fn is_utc(&self) -> bool {
        self.hour == 0 && self.minute == 0
    }
    fn is_empty(&self) -> bool {
        self.hour == K_NONE
    }
    /// The UTC offset in seconds (None: no zone given, local time).
    fn write(&mut self) -> Result<Option<i32>, ()> {
        if self.sign == K_NONE {
            return Ok(None);
        }
        if self.hour == K_NONE {
            self.hour = 0;
        }
        if self.minute == K_NONE {
            self.minute = 0;
        }
        // Unsigned 32-bit arithmetic, as V8 computes it.
        let total = (self.hour as u32)
            .wrapping_mul(3600)
            .wrapping_add((self.minute as u32).wrapping_mul(60));
        if total > SMI_MAX {
            return Err(());
        }
        let mut total = total as i32;
        if self.sign < 0 {
            total = -total;
        }
        Ok(Some(total))
    }
}

struct TimeComposer {
    comp: [i32; 4],
    index: usize,
    hour_offset: i32,
}
impl TimeComposer {
    fn is_empty(&self) -> bool {
        self.index == 0
    }
    fn is_expecting(&self, n: i32) -> bool {
        (self.index == 1 && is_minute(n))
            || (self.index == 2 && is_second(n))
            || (self.index == 3 && is_millisecond(n))
    }
    fn add(&mut self, n: i32) -> bool {
        if self.index < 4 {
            self.comp[self.index] = n;
            self.index += 1;
            true
        } else {
            false
        }
    }
    fn add_final(&mut self, n: i32) -> bool {
        if !self.add(n) {
            return false;
        }
        while self.index < 4 {
            self.comp[self.index] = 0;
            self.index += 1;
        }
        true
    }
    fn write(&mut self) -> Option<[i32; 4]> {
        while self.index < 4 {
            self.comp[self.index] = 0;
            self.index += 1;
        }
        let [mut hour, minute, second, millisecond] = self.comp;
        if self.hour_offset != K_NONE {
            if !is_hour12(hour) {
                return None;
            }
            hour %= 12;
            hour += self.hour_offset;
        }
        if (!is_hour(hour)
            || !is_minute(minute)
            || !is_second(second)
            || !is_millisecond(millisecond))
            && (hour != 24 || minute != 0 || second != 0 || millisecond != 0)
        {
            return None;
        }
        Some([hour, minute, second, millisecond])
    }
}

struct DayComposer {
    comp: [i32; 3],
    index: usize,
    named_month: i32,
    is_iso_date: bool,
}
impl DayComposer {
    fn is_empty(&self) -> bool {
        self.index == 0
    }
    fn add(&mut self, n: i32) -> bool {
        if self.index < 3 {
            self.comp[self.index] = n;
            self.index += 1;
            true
        } else {
            false
        }
    }
    /// (year, 0-based month, day).
    fn write(&mut self) -> Option<(i32, i32, i32)> {
        if self.index < 1 {
            return None;
        }
        while self.index < 3 {
            self.comp[self.index] = 1;
            self.index += 1;
        }
        let mut year = 0;
        let month;
        let day;
        if self.named_month == K_NONE {
            if self.is_iso_date || (self.index == 3 && !is_day(self.comp[0])) {
                year = self.comp[0];
                month = self.comp[1];
                day = self.comp[2];
            } else {
                month = self.comp[0];
                day = self.comp[1];
                if self.index == 3 {
                    year = self.comp[2];
                }
            }
        } else {
            month = self.named_month;
            if self.index == 1 {
                day = self.comp[0];
            } else if !is_day(self.comp[0]) {
                year = self.comp[0];
                day = self.comp[1];
            } else {
                day = self.comp[0];
                year = self.comp[1];
            }
        }
        if !self.is_iso_date {
            if between(year, 0, 49) {
                year += 2000;
            } else if between(year, 50, 99) {
                year += 1900;
            }
        }
        // Smi::IsValid(year) always holds for a 9-digit numeral on a 32-bit Smi build.
        if !is_month(month) || !is_day(day) {
            return None;
        }
        Some((year, month - 1, day))
    }
}

/// `ParseES5DateTime`: the next token for the legacy parser (EndOfInput when complete,
/// Invalid when terminally unsuccessful).
fn parse_es5_date_time(
    scanner: &mut Tokenizer<'_>,
    day: &mut DayComposer,
    time: &mut TimeComposer,
    tz: &mut TimeZoneComposer,
) -> Token {
    let invalid = Token::simple(Tag::Invalid, 0);
    if scanner.peek().is_ascii_sign() {
        let sign_token = scanner.next();
        if !scanner.peek().is_fixed_length_number(6) {
            return sign_token;
        }
        let sign = sign_token.ascii_sign();
        let year = scanner.next().value;
        if sign < 0 && year == 0 {
            return sign_token;
        }
        day.add(sign * year);
    } else if scanner.peek().is_fixed_length_number(4) {
        day.add(scanner.next().value);
    } else {
        return scanner.next();
    }
    if scanner.skip_symbol(b'-') {
        if !scanner.peek().is_fixed_length_number(2) || !is_month(scanner.peek().value) {
            return scanner.next();
        }
        day.add(scanner.next().value);
        if scanner.skip_symbol(b'-') {
            if !scanner.peek().is_fixed_length_number(2) || !is_day(scanner.peek().value) {
                return scanner.next();
            }
            day.add(scanner.next().value);
        }
    }
    if !scanner.peek().is_keyword_type(KeywordType::TimeSeparator) {
        if !scanner.peek().is_end_of_input() {
            return scanner.next();
        }
    } else {
        scanner.next();
        if !scanner.peek().is_fixed_length_number(2) || !between(scanner.peek().value, 0, 24) {
            return invalid;
        }
        let hour_is_24 = scanner.peek().value == 24;
        time.add(scanner.next().value);
        if !scanner.skip_symbol(b':') {
            return invalid;
        }
        if !scanner.peek().is_fixed_length_number(2)
            || !is_minute(scanner.peek().value)
            || (hour_is_24 && scanner.peek().value > 0)
        {
            return invalid;
        }
        time.add(scanner.next().value);
        if scanner.skip_symbol(b':') {
            if !scanner.peek().is_fixed_length_number(2)
                || !is_second(scanner.peek().value)
                || (hour_is_24 && scanner.peek().value > 0)
            {
                return invalid;
            }
            time.add(scanner.next().value);
            if scanner.skip_symbol(b'.') {
                if !scanner.peek().is_number() || (hour_is_24 && scanner.peek().value > 0) {
                    return invalid;
                }
                time.add(read_milliseconds(scanner.next()));
            }
        }
        if scanner.peek().is_keyword_z() {
            scanner.next();
            tz.set(0);
        } else if scanner.peek().is_symbol(b'+') || scanner.peek().is_symbol(b'-') {
            tz.set_sign(if scanner.next().value == i32::from(b'+') {
                1
            } else {
                -1
            });
            if scanner.peek().is_fixed_length_number(4) {
                let hourmin = scanner.next().value;
                let hour = hourmin / 100;
                let min = hourmin % 100;
                if !is_hour(hour) || !is_minute(min) {
                    return invalid;
                }
                tz.hour = hour;
                tz.minute = min;
            } else {
                if !scanner.peek().is_fixed_length_number(2) || !is_hour(scanner.peek().value) {
                    return invalid;
                }
                tz.hour = scanner.next().value;
                if !scanner.skip_symbol(b':') {
                    return invalid;
                }
                if !scanner.peek().is_fixed_length_number(2) || !is_minute(scanner.peek().value) {
                    return invalid;
                }
                tz.minute = scanner.next().value;
            }
        }
        if !scanner.peek().is_end_of_input() {
            return invalid;
        }
    }
    if tz.is_empty() && time.is_empty() {
        tz.set(0);
    }
    day.is_iso_date = true;
    Token::simple(Tag::EndOfInput, 0)
}

/// `DateParser::Parse`: (year, month 0-based, day, hour, minute, second, ms, UTC offset s).
#[allow(clippy::type_complexity)]
fn parse_fields(units: &[u16]) -> Option<(i32, i32, i32, [i32; 4], Option<i32>)> {
    let mut scanner = Tokenizer::new(InputReader::new(units));
    let mut tz = TimeZoneComposer {
        sign: K_NONE,
        hour: K_NONE,
        minute: K_NONE,
    };
    let mut time = TimeComposer {
        comp: [0; 4],
        index: 0,
        hour_offset: K_NONE,
    };
    let mut day = DayComposer {
        comp: [0; 3],
        index: 0,
        named_month: K_NONE,
        is_iso_date: false,
    };
    let next_unhandled = parse_es5_date_time(&mut scanner, &mut day, &mut time, &mut tz);
    if next_unhandled.is_invalid() {
        return None;
    }
    let mut has_read_number = !day.is_empty();
    let mut token = next_unhandled;
    while !token.is_end_of_input() {
        if token.is_number() {
            has_read_number = true;
            let n = token.value;
            if scanner.skip_symbol(b':') {
                if scanner.skip_symbol(b':') {
                    if !time.is_empty() {
                        return None;
                    }
                    time.add(n);
                    time.add(0);
                } else {
                    if !time.add(n) {
                        return None;
                    }
                    if scanner.peek().is_symbol(b'.') {
                        scanner.next();
                    }
                }
            } else if scanner.skip_symbol(b'.') && time.is_expecting(n) {
                time.add(n);
                if !scanner.peek().is_number() {
                    return None;
                }
                let ms = read_milliseconds(scanner.next());
                if ms < 0 {
                    return None;
                }
                time.add_final(ms);
            } else if tz.is_expecting(n) {
                tz.minute = n;
            } else if time.is_expecting(n) {
                time.add_final(n);
                let peek = scanner.peek();
                if !peek.is_end_of_input()
                    && !peek.is_white_space()
                    && !peek.is_keyword_z()
                    && !peek.is_ascii_sign()
                {
                    return None;
                }
            } else {
                if !day.add(n) {
                    return None;
                }
                scanner.skip_symbol(b'-');
            }
        } else if token.is_keyword() {
            let kind = token.keyword_type();
            let value = token.value;
            if kind == KeywordType::AmPm && !time.is_empty() {
                time.hour_offset = value;
            } else if kind == KeywordType::MonthName {
                day.named_month = value;
                scanner.skip_symbol(b'-');
            } else if kind == KeywordType::TimeZoneName && has_read_number {
                tz.set(value);
            } else {
                if has_read_number {
                    return None;
                }
                if scanner.peek().is_number() {
                    return None;
                }
            }
        } else if token.is_ascii_sign() && (tz.is_utc() || !time.is_empty()) {
            tz.set_sign(token.ascii_sign());
            let mut n = 0;
            let mut length = 0;
            if scanner.peek().is_number() {
                let t = scanner.next();
                length = t.length;
                n = t.value;
            }
            has_read_number = true;
            if scanner.peek().is_symbol(b':') {
                tz.hour = n;
                tz.minute = K_NONE;
            } else if length == 2 || length == 1 {
                tz.hour = n;
                tz.minute = 0;
            } else if length == 4 || length == 3 {
                tz.hour = n / 100;
                tz.minute = n % 100;
            } else {
                return None;
            }
        } else if (token.is_ascii_sign() || token.is_symbol(b')')) && has_read_number {
            return None;
        }
        token = scanner.next();
    }
    let (year, month, day) = day.write()?;
    let time = time.write()?;
    let offset = tz.write().ok()?;
    Some((year, month, day, time, offset))
}

const MS_PER_DAY: f64 = 86_400_000.;
const MAX_TIME_MS: f64 = 8.64e15;
/// `kMaxTimeBeforeUTCInMs`: kMaxTimeInMs plus 30 days.
const MAX_TIME_BEFORE_UTC_MS: f64 = 8.64e15 + 30. * 86_400_000.;

/// ES6 `MakeDay` with V8's integer arithmetic.
fn make_day(year: f64, month: f64, date: f64) -> f64 {
    if !((-1_000_000.0..=1_000_000.0).contains(&year)
        && (-10_000_000.0..=10_000_000.0).contains(&month)
        && date.is_finite())
    {
        return f64::NAN;
    }
    let mut y = year as i32;
    let mut m = month as i32;
    y += m / 12;
    m %= 12;
    if m < 0 {
        m += 12;
        y -= 1;
    }
    const YEAR_DELTA: i32 = 399_999;
    const BASE_DAY: i32 = 365 * (1970 + YEAR_DELTA) + (1970 + YEAR_DELTA) / 4
        - (1970 + YEAR_DELTA) / 100
        + (1970 + YEAR_DELTA) / 400;
    let mut day_from_year = 365 * (y + YEAR_DELTA) + (y + YEAR_DELTA) / 4 - (y + YEAR_DELTA) / 100
        + (y + YEAR_DELTA) / 400
        - BASE_DAY;
    const COMMON: [i32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const LEAP: [i32; 12] = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    if y % 4 != 0 || (y % 100 == 0 && y % 400 != 0) {
        day_from_year += COMMON[m as usize];
    } else {
        day_from_year += LEAP[m as usize];
    }
    f64::from(day_from_year - 1) + date.trunc()
}
fn make_time(h: f64, m: f64, s: f64, ms: f64) -> f64 {
    h.trunc() * 3_600_000. + m.trunc() * 60_000. + s.trunc() * 1000. + ms.trunc()
}
fn make_date(day: f64, time: f64) -> f64 {
    if day.is_finite() && time.is_finite() {
        time + day * MS_PER_DAY
    } else {
        f64::NAN
    }
}
fn time_clip(time: f64) -> f64 {
    if (-MAX_TIME_MS..=MAX_TIME_MS).contains(&time) {
        // DoubleToInteger; `+ 0.` turns -0 into +0 as V8's Smi/HeapNumber result does.
        time.trunc() + 0.
    } else {
        f64::NAN
    }
}

/// `Date.parse(s)` with the process time zone UTC.
pub fn date_parse(s: &str) -> f64 {
    let units: Vec<u16> = s.encode_utf16().collect();
    date_parse_utf16(&units)
}
/// [`date_parse`] of a string given as UTF-16 code units.
pub fn date_parse_utf16(units: &[u16]) -> f64 {
    let Some((year, month, day, [h, mi, se, ms], offset)) = parse_fields(units) else {
        return f64::NAN;
    };
    let d = make_day(f64::from(year), f64::from(month), f64::from(day));
    let t = make_time(f64::from(h), f64::from(mi), f64::from(se), f64::from(ms));
    let mut date = make_date(d, t);
    match offset {
        None => {
            if !(-MAX_TIME_BEFORE_UTC_MS..=MAX_TIME_BEFORE_UTC_MS).contains(&date) {
                return f64::NAN;
            }
            // Local time is UTC: `ToUTC` is the identity.
        }
        Some(seconds) => date -= f64::from(seconds) * 1000.,
    }
    time_clip(date)
}
