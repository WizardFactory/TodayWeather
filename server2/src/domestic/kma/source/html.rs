//! An HTML tree built like legacy cheerio 0.20.0 builds it (htmlparser2 3.8.3 with
//! `decodeEntities: true`, HTML mode): the tokenizer states, `openImpliesClose`, void elements,
//! script/style raw text, CDATA as comments and lowercase tag/attribute names. No HTML5 tree
//! construction (no implied `tbody`), so `table > tr` stays as written, as legacy sees it.
//!
//! Entities: the 106 legacy (no-semicolon) entities and the HTML 4.01 named set. A
//! semicolon-terminated name outside that set (an HTML5-only entity) cannot be decoded as legacy
//! would and fails the parse, so the page is not used rather than read differently.

/// One node of the tree.
#[derive(Debug, Clone)]
pub enum Node {
    Element(Element),
    Text(String),
    Comment,
    Directive,
}
#[derive(Debug, Clone)]
pub struct Element {
    pub name: String,
    /// Attributes in source order; a repeated name keeps the first value.
    pub attrs: Vec<(String, String)>,
    pub children: Vec<usize>,
}
/// The parsed document: node 0 is the root.
#[derive(Debug, Clone)]
pub struct Document {
    nodes: Vec<Node>,
    parent: Vec<Option<usize>>,
}
pub const ROOT: usize = 0;

const VOID: [&str; 28] = [
    "area", "base", "basefont", "br", "col", "command", "embed", "frame", "hr", "img", "input",
    "isindex", "keygen", "link", "meta", "param", "source", "track", "wbr", "path", "circle",
    "ellipse", "line", "rect", "use", "stop", "polyline", "polygon",
];
const FORM_TAGS: [&str; 7] = [
    "input", "option", "optgroup", "select", "button", "datalist", "textarea",
];
fn implies_close(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "tr" => &["tr", "th", "td"],
        "th" => &["th"],
        "td" => &["thead", "th", "td"],
        "body" => &["head", "link", "script"],
        "li" => &["li"],
        "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => &["p"],
        "select" | "input" | "output" | "button" | "datalist" | "textarea" => &FORM_TAGS,
        "option" => &["option"],
        "optgroup" => &["optgroup"],
        _ => return None,
    })
}
fn is_void(name: &str) -> bool {
    VOID.contains(&name)
}
/// htmlparser2 `whitespace(c)`.
fn ws(c: char) -> bool {
    matches!(c, ' ' | '\n' | '\t' | '\u{c}' | '\r')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseError;

/// Tree builder (`domhandler` with the parser's open/close events).
struct Builder {
    doc: Document,
    /// The open element stack of the parser (names) and of the handler (node ids).
    stack: Vec<String>,
    open: Vec<usize>,
    tag: String,
    attrs: Option<Vec<(String, String)>>,
    attr_name: String,
    attr_value: String,
}
impl Builder {
    fn current(&self) -> usize {
        self.open.last().copied().unwrap_or(ROOT)
    }
    fn add(&mut self, node: Node) -> usize {
        let id = self.doc.nodes.len();
        let parent = self.current();
        self.doc.nodes.push(node);
        self.doc.parent.push(Some(parent));
        if let Node::Element(e) = &mut self.doc.nodes[parent] {
            e.children.push(id);
        }
        id
    }
    fn text(&mut self, data: &str) {
        if data.is_empty() {
            return;
        }
        // domhandler merges adjacent text nodes.
        let parent = self.current();
        if let Node::Element(e) = &self.doc.nodes[parent]
            && let Some(&last) = e.children.last()
            && let Node::Text(t) = &mut self.doc.nodes[last]
        {
            t.push_str(data);
            return;
        }
        self.add(Node::Text(data.to_owned()));
    }
    fn on_open_tag_name(&mut self, name: &str) {
        let name = name.to_lowercase();
        if let Some(closes) = implies_close(&name) {
            while let Some(top) = self.stack.last().cloned() {
                if !closes.contains(&top.as_str()) {
                    break;
                }
                self.on_close_tag(&top);
            }
        }
        if !is_void(&name) {
            self.stack.push(name.clone());
        }
        self.tag = name;
        self.attrs = Some(Vec::new());
    }
    fn on_open_tag_end(&mut self) {
        if let Some(attrs) = self.attrs.take() {
            let id = self.add(Node::Element(Element {
                name: self.tag.clone(),
                attrs,
                children: Vec::new(),
            }));
            self.open.push(id);
        }
        if is_void(&self.tag) {
            self.handler_close();
        }
        self.tag.clear();
    }
    /// `onclosetag` of the handler: closes the innermost open element.
    fn handler_close(&mut self) {
        self.open.pop();
    }
    fn on_close_tag(&mut self, name: &str) {
        let name = name.to_lowercase();
        if !self.stack.is_empty() && !is_void(&name) {
            if let Some(pos) = self.stack.iter().rposition(|n| *n == name) {
                for _ in pos..self.stack.len() {
                    self.stack.pop();
                    self.handler_close();
                }
            } else if name == "p" {
                self.on_open_tag_name("p");
                self.close_current_tag();
            }
        } else if name == "br" || name == "p" {
            self.on_open_tag_name(&name);
            self.close_current_tag();
        }
    }
    fn close_current_tag(&mut self) {
        let name = self.tag.clone();
        self.on_open_tag_end();
        if self.stack.last() == Some(&name) {
            self.handler_close();
            self.stack.pop();
        }
    }
    fn on_attrib_end(&mut self) {
        let name = std::mem::take(&mut self.attr_name);
        let value = std::mem::take(&mut self.attr_value);
        if let Some(attrs) = &mut self.attrs
            && !attrs.iter().any(|(n, _)| *n == name)
        {
            attrs.push((name, value));
        }
    }
    fn on_end(&mut self) {
        while self.stack.pop().is_some() {
            self.handler_close();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum S {
    Text,
    BeforeTagName,
    InTagName,
    InSelfClosingTag,
    BeforeClosingTagName,
    InClosingTagName,
    AfterClosingTagName,
    BeforeAttributeName,
    InAttributeName,
    AfterAttributeName,
    BeforeAttributeValue,
    InAttributeValueDq,
    InAttributeValueSq,
    InAttributeValueNq,
    BeforeDeclaration,
    InDeclaration,
    InProcessingInstruction,
    BeforeComment,
    InComment,
    AfterComment1,
    AfterComment2,
    BeforeCdata(u8),
    InCdata,
    AfterCdata1,
    AfterCdata2,
    BeforeSpecial,
    BeforeSpecialEnd,
    BeforeScript(u8),
    AfterScript(u8),
    BeforeStyle(u8),
    AfterStyle(u8),
    BeforeEntity,
    BeforeNumericEntity,
    InNamedEntity,
    InNumericEntity,
    InHexEntity,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Special {
    None,
    Script,
    Style,
}

/// Parse `html` (already decoded text).
pub fn parse(html: &str) -> Result<Document, ParseError> {
    let buf: Vec<char> = html.chars().collect();
    let mut b = Builder {
        doc: Document {
            nodes: vec![Node::Element(Element {
                name: "#root".into(),
                attrs: Vec::new(),
                children: Vec::new(),
            })],
            parent: vec![None],
        },
        stack: Vec::new(),
        open: Vec::new(),
        tag: String::new(),
        attrs: None,
        attr_name: String::new(),
        attr_value: String::new(),
    };
    let mut state = S::Text;
    let mut base = S::Text;
    let mut special = Special::None;
    let mut start: isize = 0;
    let mut i: isize = 0;
    let len = buf.len() as isize;
    let section = |a: isize, z: isize| -> String {
        if a < 0 || a >= z {
            return String::new();
        }
        buf[a as usize..z as usize].iter().collect()
    };
    let mut error = false;
    // Emit decoded entity text to text or attribute data.
    macro_rules! partial {
        ($b:expr, $v:expr) => {
            if base != S::Text {
                $b.attr_value.push_str(&$v);
            } else {
                $b.text(&$v);
            }
        };
    }
    while i < len {
        let c = buf[i as usize];
        match state {
            S::Text => {
                if c == '<' {
                    if i > start {
                        b.text(&section(start, i));
                    }
                    state = S::BeforeTagName;
                    start = i;
                } else if special == Special::None && c == '&' {
                    if i > start {
                        b.text(&section(start, i));
                    }
                    base = S::Text;
                    state = S::BeforeEntity;
                    start = i;
                }
            }
            S::BeforeTagName => {
                if c == '/' {
                    state = S::BeforeClosingTagName;
                } else if c == '>' || special != Special::None || ws(c) {
                    state = S::Text;
                } else if c == '!' {
                    state = S::BeforeDeclaration;
                    start = i + 1;
                } else if c == '?' {
                    state = S::InProcessingInstruction;
                    start = i + 1;
                } else if c == '<' {
                    b.text(&section(start, i));
                    start = i;
                } else {
                    state = if c == 's' || c == 'S' {
                        S::BeforeSpecial
                    } else {
                        S::InTagName
                    };
                    start = i;
                }
            }
            S::InTagName => {
                if c == '/' || c == '>' || ws(c) {
                    b.on_open_tag_name(&section(start, i));
                    start = -1;
                    state = S::BeforeAttributeName;
                    i -= 1;
                }
            }
            S::BeforeClosingTagName => {
                if ws(c) {
                } else if c == '>' {
                    state = S::Text;
                } else if special != Special::None {
                    if c == 's' || c == 'S' {
                        state = S::BeforeSpecialEnd;
                    } else {
                        state = S::Text;
                        i -= 1;
                    }
                } else {
                    state = S::InClosingTagName;
                    start = i;
                }
            }
            S::InClosingTagName => {
                if c == '>' || ws(c) {
                    b.on_close_tag(&section(start, i));
                    start = -1;
                    state = S::AfterClosingTagName;
                    i -= 1;
                }
            }
            S::AfterClosingTagName => {
                if c == '>' {
                    state = S::Text;
                    start = i + 1;
                }
            }
            S::BeforeAttributeName => {
                if c == '>' {
                    b.on_open_tag_end();
                    state = S::Text;
                    start = i + 1;
                } else if c == '/' {
                    state = S::InSelfClosingTag;
                } else if !ws(c) {
                    state = S::InAttributeName;
                    start = i;
                }
            }
            S::InSelfClosingTag => {
                if c == '>' {
                    // `onselfclosingtag` without recognizeSelfClosing is `onopentagend`.
                    b.on_open_tag_end();
                    state = S::Text;
                    start = i + 1;
                } else if !ws(c) {
                    state = S::BeforeAttributeName;
                    i -= 1;
                }
            }
            S::InAttributeName => {
                if c == '=' || c == '/' || c == '>' || ws(c) {
                    b.attr_name = section(start, i).to_lowercase();
                    start = -1;
                    state = S::AfterAttributeName;
                    i -= 1;
                }
            }
            S::AfterAttributeName => {
                if c == '=' {
                    state = S::BeforeAttributeValue;
                } else if c == '/' || c == '>' {
                    b.on_attrib_end();
                    state = S::BeforeAttributeName;
                    i -= 1;
                } else if !ws(c) {
                    b.on_attrib_end();
                    state = S::InAttributeName;
                    start = i;
                }
            }
            S::BeforeAttributeValue => {
                if c == '"' {
                    state = S::InAttributeValueDq;
                    start = i + 1;
                } else if c == '\'' {
                    state = S::InAttributeValueSq;
                    start = i + 1;
                } else if !ws(c) {
                    state = S::InAttributeValueNq;
                    start = i;
                    i -= 1;
                }
            }
            S::InAttributeValueDq | S::InAttributeValueSq => {
                let quote = if state == S::InAttributeValueDq { '"' } else { '\'' };
                if c == quote {
                    let v = section(start, i);
                    b.attr_value.push_str(&v);
                    start = -1;
                    b.on_attrib_end();
                    state = S::BeforeAttributeName;
                } else if c == '&' {
                    let v = section(start, i);
                    b.attr_value.push_str(&v);
                    base = state;
                    state = S::BeforeEntity;
                    start = i;
                }
            }
            S::InAttributeValueNq => {
                if ws(c) || c == '>' {
                    let v = section(start, i);
                    b.attr_value.push_str(&v);
                    start = -1;
                    b.on_attrib_end();
                    state = S::BeforeAttributeName;
                    i -= 1;
                } else if c == '&' {
                    let v = section(start, i);
                    b.attr_value.push_str(&v);
                    base = state;
                    state = S::BeforeEntity;
                    start = i;
                }
            }
            S::BeforeDeclaration => {
                state = match c {
                    '[' => S::BeforeCdata(1),
                    '-' => S::BeforeComment,
                    _ => S::InDeclaration,
                };
            }
            S::InDeclaration => {
                if c == '>' {
                    b.add(Node::Directive);
                    state = S::Text;
                    start = i + 1;
                }
            }
            S::InProcessingInstruction => {
                if c == '>' {
                    b.add(Node::Directive);
                    state = S::Text;
                    start = i + 1;
                }
            }
            S::BeforeComment => {
                if c == '-' {
                    state = S::InComment;
                    start = i + 1;
                } else {
                    state = S::InDeclaration;
                }
            }
            S::InComment => {
                if c == '-' {
                    state = S::AfterComment1;
                }
            }
            S::AfterComment1 => {
                state = if c == '-' {
                    S::AfterComment2
                } else {
                    S::InComment
                };
            }
            S::AfterComment2 => {
                if c == '>' {
                    b.add(Node::Comment);
                    state = S::Text;
                    start = i + 1;
                } else if c != '-' {
                    state = S::InComment;
                }
            }
            S::BeforeCdata(n) => {
                let want = ['C', 'D', 'A', 'T', 'A'];
                if n <= 5 {
                    let w = want[n as usize - 1];
                    if c == w || c == w.to_ascii_lowercase() {
                        state = S::BeforeCdata(n + 1);
                    } else {
                        state = S::InDeclaration;
                        i -= 1;
                    }
                } else if c == '[' {
                    state = S::InCdata;
                    start = i + 1;
                } else {
                    state = S::InDeclaration;
                    i -= 1;
                }
            }
            S::InCdata => {
                if c == ']' {
                    state = S::AfterCdata1;
                }
            }
            S::AfterCdata1 => {
                if c == ']' {
                    state = S::AfterCdata2;
                }
            }
            S::AfterCdata2 => {
                if c == '>' {
                    // CDATA outside XML mode becomes a comment.
                    b.add(Node::Comment);
                    state = S::Text;
                    start = i + 1;
                } else if c != ']' {
                    state = S::InCdata;
                }
            }
            S::BeforeSpecial => {
                if c == 'c' || c == 'C' {
                    state = S::BeforeScript(1);
                } else if c == 't' || c == 'T' {
                    state = S::BeforeStyle(1);
                } else {
                    state = S::InTagName;
                    i -= 1;
                }
            }
            S::BeforeSpecialEnd => {
                if special == Special::Script && (c == 'c' || c == 'C') {
                    state = S::AfterScript(1);
                } else if special == Special::Style && (c == 't' || c == 'T') {
                    state = S::AfterStyle(1);
                } else {
                    state = S::Text;
                }
            }
            S::BeforeScript(n) | S::BeforeStyle(n) => {
                let script = matches!(state, S::BeforeScript(_));
                let word: &[char] = if script {
                    &['R', 'I', 'P', 'T']
                } else {
                    &['Y', 'L', 'E']
                };
                let k = n as usize;
                if k <= word.len() {
                    let w = word[k - 1];
                    if c == w || c == w.to_ascii_lowercase() {
                        state = if script {
                            S::BeforeScript(n + 1)
                        } else {
                            S::BeforeStyle(n + 1)
                        };
                    } else {
                        state = S::InTagName;
                        i -= 1;
                    }
                } else {
                    if c == '/' || c == '>' || ws(c) {
                        special = if script {
                            Special::Script
                        } else {
                            Special::Style
                        };
                    }
                    state = S::InTagName;
                    i -= 1;
                }
            }
            S::AfterScript(n) | S::AfterStyle(n) => {
                let script = matches!(state, S::AfterScript(_));
                let word: &[char] = if script {
                    &['R', 'I', 'P', 'T']
                } else {
                    &['Y', 'L', 'E']
                };
                let k = n as usize;
                if k <= word.len() {
                    let w = word[k - 1];
                    if c == w || c == w.to_ascii_lowercase() {
                        state = if script {
                            S::AfterScript(n + 1)
                        } else {
                            S::AfterStyle(n + 1)
                        };
                    } else {
                        state = S::Text;
                        i -= 1;
                    }
                } else if c == '>' || ws(c) {
                    special = Special::None;
                    state = S::InClosingTagName;
                    start = i - if script { 6 } else { 5 };
                    i -= 1;
                } else {
                    state = S::Text;
                }
            }
            S::BeforeEntity => {
                if c == '#' {
                    state = S::BeforeNumericEntity;
                } else {
                    state = S::InNamedEntity;
                    i -= 1;
                }
            }
            S::BeforeNumericEntity => {
                if c == 'x' || c == 'X' {
                    state = S::InHexEntity;
                } else {
                    state = S::InNumericEntity;
                    i -= 1;
                }
            }
            S::InNamedEntity => {
                if c == ';' {
                    match strict_entity(&section(start + 1, i)) {
                        Some(v) => {
                            partial!(b, v);
                            start = i + 1;
                        }
                        None if start + 1 < i && is_name(&section(start + 1, i)) => {
                            // A named entity this table does not hold (HTML5-only).
                            error = true;
                        }
                        None => {}
                    }
                    if start + 1 < i {
                        legacy_entity(&buf, &mut start, i, &mut |v| partial!(b, v));
                    }
                    state = base;
                } else if !c.is_ascii_alphanumeric() {
                    if start + 1 == i {
                    } else if base != S::Text {
                        if c != '='
                            && let Some(v) = strict_entity(&section(start + 1, i))
                        {
                            partial!(b, v);
                            start = i + 1;
                        }
                    } else {
                        legacy_entity(&buf, &mut start, i, &mut |v| partial!(b, v));
                    }
                    state = base;
                    i -= 1;
                }
            }
            S::InNumericEntity | S::InHexEntity => {
                let hex = state == S::InHexEntity;
                let digit = if hex {
                    c.is_ascii_hexdigit()
                } else {
                    c.is_ascii_digit()
                };
                if c == ';' {
                    numeric_entity(&buf, &mut start, i, hex, &mut |v| partial!(b, v));
                    start += 1;
                    state = base;
                } else if !digit {
                    numeric_entity(&buf, &mut start, i, hex, &mut |v| partial!(b, v));
                    state = base;
                    i -= 1;
                }
            }
        }
        i += 1;
    }
    if error {
        return Err(ParseError);
    }
    // `_cleanup` then `_finish`: trailing data.
    if state == S::Text {
        if start >= 0 && start < len {
            b.text(&section(start, len));
        }
    } else if start >= 0 && start < len {
        match state {
            S::InCdata | S::AfterCdata1 | S::AfterCdata2 => {
                b.add(Node::Comment);
            }
            S::InComment | S::AfterComment1 | S::AfterComment2 => {
                b.add(Node::Comment);
            }
            S::InNamedEntity | S::InNumericEntity | S::InHexEntity => {
                // Rare at the end of a document: treated as text after decoding attempts.
                return Err(ParseError);
            }
            S::InTagName
            | S::BeforeAttributeName
            | S::BeforeAttributeValue
            | S::AfterAttributeName
            | S::InAttributeName
            | S::InAttributeValueSq
            | S::InAttributeValueDq
            | S::InAttributeValueNq
            | S::InClosingTagName => {}
            _ => b.text(&section(start, len)),
        }
    }
    b.on_end();
    Ok(b.doc)
}
fn is_name(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric())
}
fn legacy_entity(buf: &[char], start: &mut isize, i: isize, emit: &mut dyn FnMut(String)) {
    let from = *start + 1;
    let mut limit = (i - from).min(6);
    while limit >= 2 {
        let name: String = buf[from as usize..(from + limit) as usize].iter().collect();
        if let Some(v) = legacy(&name) {
            emit(v.to_string());
            *start += limit + 1;
            return;
        }
        limit -= 1;
    }
}
fn numeric_entity(
    buf: &[char],
    start: &mut isize,
    i: isize,
    hex: bool,
    emit: &mut dyn FnMut(String),
) {
    let from = *start + if hex { 3 } else { 2 };
    if from != i {
        let digits: String = buf[from as usize..i as usize].iter().collect();
        let parsed = u32::from_str_radix(&digits, if hex { 16 } else { 10 }).unwrap_or(u32::MAX);
        emit(decode_code_point(parsed));
        *start = i;
    } else {
        *start -= 1;
    }
}
/// `entities/lib/decode_codepoint.js`.
fn decode_code_point(cp: u32) -> String {
    if (0xD800..=0xDFFF).contains(&cp) || cp > 0x10FFFF {
        return "\u{FFFD}".into();
    }
    let mapped = match cp {
        0 => 0xFFFD,
        128 => 8364,
        130 => 8218,
        131 => 402,
        132 => 8222,
        133 => 8230,
        134 => 8224,
        135 => 8225,
        136 => 710,
        137 => 8240,
        138 => 352,
        139 => 8249,
        140 => 338,
        142 => 381,
        145 => 8216,
        146 => 8217,
        147 => 8220,
        148 => 8221,
        149 => 8226,
        150 => 8211,
        151 => 8212,
        152 => 732,
        153 => 8482,
        154 => 353,
        155 => 8250,
        156 => 339,
        158 => 382,
        159 => 376,
        other => other,
    };
    char::from_u32(mapped).map_or_else(|| "\u{FFFD}".into(), String::from)
}
/// The legacy (semicolon-free) entities: the Latin-1 set plus `amp`, `lt`, `gt`, `quot`.
fn legacy(name: &str) -> Option<char> {
    match name {
        "AMP" | "amp" => return Some('&'),
        "LT" | "lt" => return Some('<'),
        "GT" | "gt" => return Some('>'),
        "QUOT" | "quot" => return Some('"'),
        "COPY" => return Some('\u{a9}'),
        "REG" => return Some('\u{ae}'),
        _ => {}
    }
    LATIN1
        .iter()
        .position(|n| *n == name)
        .and_then(|i| char::from_u32(0xA0 + i as u32))
}
const LATIN1: [&str; 96] = [
    "nbsp", "iexcl", "cent", "pound", "curren", "yen", "brvbar", "sect", "uml", "copy", "ordf",
    "laquo", "not", "shy", "reg", "macr", "deg", "plusmn", "sup2", "sup3", "acute", "micro",
    "para", "middot", "cedil", "sup1", "ordm", "raquo", "frac14", "frac12", "frac34", "iquest",
    "Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring", "AElig", "Ccedil", "Egrave",
    "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml", "ETH", "Ntilde", "Ograve",
    "Oacute", "Ocirc", "Otilde", "Ouml", "times", "Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml",
    "Yacute", "THORN", "szlig", "agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig",
    "ccedil", "egrave", "eacute", "ecirc", "euml", "igrave", "iacute", "icirc", "iuml", "eth",
    "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide", "oslash", "ugrave",
    "uacute", "ucirc", "uuml", "yacute", "thorn", "yuml",
];
/// Semicolon-terminated named entities: the legacy set and the HTML 4.01 symbols and Greek.
fn strict_entity(name: &str) -> Option<String> {
    if let Some(c) = legacy(name) {
        return Some(c.to_string());
    }
    let cp: u32 = match name {
        "apos" => 39,
        "OElig" => 338,
        "oelig" => 339,
        "Scaron" => 352,
        "scaron" => 353,
        "Yuml" => 376,
        "fnof" => 402,
        "circ" => 710,
        "tilde" => 732,
        "ensp" => 8194,
        "emsp" => 8195,
        "thinsp" => 8201,
        "zwnj" => 8204,
        "zwj" => 8205,
        "lrm" => 8206,
        "rlm" => 8207,
        "ndash" => 8211,
        "mdash" => 8212,
        "lsquo" => 8216,
        "rsquo" => 8217,
        "sbquo" => 8218,
        "ldquo" => 8220,
        "rdquo" => 8221,
        "bdquo" => 8222,
        "dagger" => 8224,
        "Dagger" => 8225,
        "bull" => 8226,
        "hellip" => 8230,
        "permil" => 8240,
        "prime" => 8242,
        "Prime" => 8243,
        "lsaquo" => 8249,
        "rsaquo" => 8250,
        "oline" => 8254,
        "frasl" => 8260,
        "euro" => 8364,
        "image" => 8465,
        "weierp" => 8472,
        "real" => 8476,
        "trade" => 8482,
        "alefsym" => 8501,
        "larr" => 8592,
        "uarr" => 8593,
        "rarr" => 8594,
        "darr" => 8595,
        "harr" => 8596,
        "crarr" => 8629,
        "lArr" => 8656,
        "uArr" => 8657,
        "rArr" => 8658,
        "dArr" => 8659,
        "hArr" => 8660,
        "forall" => 8704,
        "part" => 8706,
        "exist" => 8707,
        "empty" => 8709,
        "nabla" => 8711,
        "isin" => 8712,
        "notin" => 8713,
        "ni" => 8715,
        "prod" => 8719,
        "sum" => 8721,
        "minus" => 8722,
        "lowast" => 8727,
        "radic" => 8730,
        "prop" => 8733,
        "infin" => 8734,
        "ang" => 8736,
        "and" => 8743,
        "or" => 8744,
        "cap" => 8745,
        "cup" => 8746,
        "int" => 8747,
        "there4" => 8756,
        "sim" => 8764,
        "cong" => 8773,
        "asymp" => 8776,
        "ne" => 8800,
        "equiv" => 8801,
        "le" => 8804,
        "ge" => 8805,
        "sub" => 8834,
        "sup" => 8835,
        "nsub" => 8836,
        "sube" => 8838,
        "supe" => 8839,
        "oplus" => 8853,
        "otimes" => 8855,
        "perp" => 8869,
        "sdot" => 8901,
        "lceil" => 8968,
        "rceil" => 8969,
        "lfloor" => 8970,
        "rfloor" => 8971,
        "lang" => 9001,
        "rang" => 9002,
        "loz" => 9674,
        "spades" => 9824,
        "clubs" => 9827,
        "hearts" => 9829,
        "diams" => 9830,
        _ => return greek(name),
    };
    char::from_u32(cp).map(String::from)
}
fn greek(name: &str) -> Option<String> {
    const UPPER: [&str; 25] = [
        "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa",
        "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "", "Sigma", "Tau", "Upsilon", "Phi",
        "Chi", "Psi", "Omega",
    ];
    const LOWER: [&str; 25] = [
        "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
        "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigmaf", "sigma", "tau", "upsilon",
        "phi", "chi", "psi", "omega",
    ];
    if let Some(i) = UPPER.iter().position(|n| !n.is_empty() && *n == name) {
        return char::from_u32(0x391 + i as u32).map(String::from);
    }
    if let Some(i) = LOWER.iter().position(|n| *n == name) {
        return char::from_u32(0x3B1 + i as u32).map(String::from);
    }
    match name {
        "thetasym" => Some("\u{3d1}".into()),
        "upsih" => Some("\u{3d2}".into()),
        "piv" => Some("\u{3d6}".into()),
        _ => None,
    }
}

impl Document {
    pub fn node(&self, id: usize) -> &Node {
        &self.nodes[id]
    }
    pub fn element(&self, id: usize) -> Option<&Element> {
        match &self.nodes[id] {
            Node::Element(e) => Some(e),
            _ => None,
        }
    }
    pub fn name(&self, id: usize) -> &str {
        self.element(id).map_or("", |e| e.name.as_str())
    }
    pub fn attr(&self, id: usize, name: &str) -> Option<&str> {
        self.element(id)?
            .attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
    pub fn has_class(&self, id: usize, class: &str) -> bool {
        self.attr(id, "class")
            .is_some_and(|c| c.split(ws).any(|t| t == class))
    }
    pub fn children(&self, id: usize) -> &[usize] {
        self.element(id).map_or(&[], |e| &e.children)
    }
    /// Element children with the given tag name (`.children(name)`).
    pub fn child_elements(&self, id: usize, name: &str) -> Vec<usize> {
        self.children(id)
            .iter()
            .copied()
            .filter(|c| self.name(*c) == name)
            .collect()
    }
    /// Descendant elements in document order (`.find`), excluding `id` itself.
    pub fn descendants(&self, id: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack: Vec<usize> = self.children(id).iter().rev().copied().collect();
        while let Some(n) = stack.pop() {
            if self.element(n).is_some() {
                out.push(n);
                stack.extend(self.children(n).iter().rev().copied());
            }
        }
        out
    }
    pub fn ancestors(&self, id: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut p = self.parent[id];
        while let Some(x) = p {
            if x == ROOT {
                break;
            }
            out.push(x);
            p = self.parent[x];
        }
        out
    }
    /// cheerio `text()` of one node: every descendant text node, comments excluded, script and
    /// style contents included; `skip_scripts` drops script elements (`clone().find('script')
    /// .remove()`).
    pub fn text(&self, id: usize, skip_scripts: bool) -> String {
        let mut out = String::new();
        self.collect_text(id, skip_scripts, &mut out);
        out
    }
    fn collect_text(&self, id: usize, skip_scripts: bool, out: &mut String) {
        match &self.nodes[id] {
            Node::Text(t) => out.push_str(t),
            Node::Element(e) => {
                if skip_scripts && e.name == "script" {
                    return;
                }
                for c in &e.children {
                    self.collect_text(*c, skip_scripts, out);
                }
            }
            Node::Comment | Node::Directive => {}
        }
    }
    /// cheerio `.html()` of a script element: its raw text children.
    pub fn inner_text_raw(&self, id: usize) -> String {
        let mut out = String::new();
        for c in self.children(id) {
            if let Node::Text(t) = &self.nodes[*c] {
                out.push_str(t);
            }
        }
        out
    }
}
