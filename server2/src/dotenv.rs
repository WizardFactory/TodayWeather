//! The `server2/.env` file (S10e, AK 2026-10-15): a copy of the legacy `server/.env`, plus the
//! few server2-only settings, read with the rules of the legacy loader (`dotenv` 10.0.0 as
//! `server/config/env.js` uses it). server2 never reads `server/.env` or any other legacy file.
//!
//! Rules (dotenv 10.0.0 `parse` and `config`):
//! - one `KEY=value` per line (`\n`, `\r` or `\r\n`); a line matches
//!   `^\s*([\w.-]+)\s*=\s*(.*)?\s*$`, every other line (comments, `export KEY=...`) is ignored.
//!   `\s` and `trim` are the ECMAScript sets (they include U+FEFF, so a byte order mark before the
//!   first key is skipped), and `.` stops at U+2028/U+2029;
//! - a value enclosed in matching single or double quotes loses them, and inside double quotes
//!   `\n` becomes a newline; any other value is trimmed;
//! - a repeated key keeps its last value;
//! - a variable present in the process environment wins over the file, even when empty.
//!
//! Values are secrets: this type has no `Debug` and errors never include file contents.
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;

/// The file name, read from the process working directory (start server2 from `server2/`).
pub const FILE: &str = ".env";

/// Parsed file values; lookups prefer the process environment.
pub struct DotEnv {
    values: HashMap<String, String>,
}
impl DotEnv {
    /// No file values: the process environment only.
    pub fn empty() -> Self {
        Self {
            values: HashMap::new(),
        }
    }
    /// Load `path`. A missing file is allowed (environment-only deployments, as legacy); any
    /// other read failure is an error that names only the error kind.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(Self::parse(&String::from_utf8_lossy(&bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::empty()),
            Err(e) => Err(format!("unable to load server2/.env ({:?})", e.kind())),
        }
    }
    /// Parse file text with the dotenv 10.0.0 rules.
    pub fn parse(text: &str) -> Self {
        let mut values = HashMap::new();
        for line in text.split("\r\n").flat_map(|l| l.split(['\n', '\r'])) {
            if let Some((key, value)) = parse_line(line) {
                values.insert(key.to_owned(), value);
            }
        }
        Self { values }
    }
    /// The value of `name`: the process environment first (presence wins, as dotenv does not
    /// override), then the file.
    pub fn var(&self, name: &str) -> Option<String> {
        self.var_with(name, std::env::var_os(name))
    }
    fn var_with(&self, name: &str, process: Option<OsString>) -> Option<String> {
        match process {
            Some(v) => Some(v.to_string_lossy().into_owned()),
            None => self.values.get(name).cloned(),
        }
    }
    /// The file value alone (tests and the configuration check).
    pub fn file_var(&self, name: &str) -> Option<String> {
        self.values.get(name).cloned()
    }
}

use crate::world::js::is_js_space;

fn is_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')
}
/// One line: `^\s*([\w.-]+)\s*=\s*(.*)?\s*$` (JavaScript semantics), then the quote or trim
/// rule.
fn parse_line(line: &str) -> Option<(&str, String)> {
    let rest = line.trim_start_matches(is_js_space);
    let end = rest.find(|c: char| !is_key_char(c)).unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    let (key, rest) = rest.split_at(end);
    let rest = rest
        .trim_start_matches(is_js_space)
        .strip_prefix('=')?
        .trim_start_matches(is_js_space);
    // `(.*)?` stops at U+2028/U+2029 (the other line terminators already split lines); the
    // greedy `.*` keeps blanks before it, and `\s*$` must consume everything after it.
    let (value, tail) = match rest.find(['\u{2028}', '\u{2029}']) {
        Some(at) => rest.split_at(at),
        None => (rest, ""),
    };
    if !tail.chars().all(is_js_space) {
        return None;
    }
    let quoted = |q: char| value.len() >= 2 && value.starts_with(q) && value.ends_with(q);
    let value = if quoted('"') {
        value[1..value.len() - 1].replace("\\n", "\n")
    } else if quoted('\'') {
        value[1..value.len() - 1].to_owned()
    } else {
        value.trim_matches(is_js_space).to_owned()
    };
    Some((key, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_dotenv_10() {
        let env = DotEnv::parse(concat!(
            "# comment line\n",
            "PLAIN=value\r\n",
            "  SPACED = padded value  \n",
            "DOUBLE=\"a\\nb\"\n",
            "SINGLE='[\"k1\",\"k2\"]'\r",
            "EMPTY=\n",
            "export EXPORTED=1\n",
            "INLINE=value # not a comment\n",
            "TRAILING=\"quoted\"  \n",
            "ONE_QUOTE=\"\n",
            "DUP=first\n",
            "DUP=last\n",
            "dotted.key-1=x\n",
            "no equals sign\n",
        ));
        let get = |k: &str| env.file_var(k);
        assert_eq!(get("PLAIN").as_deref(), Some("value"));
        assert_eq!(get("SPACED").as_deref(), Some("padded value"));
        assert_eq!(get("DOUBLE").as_deref(), Some("a\nb"));
        assert_eq!(get("SINGLE").as_deref(), Some(r#"["k1","k2"]"#));
        assert_eq!(get("EMPTY").as_deref(), Some(""));
        assert_eq!(get("EXPORTED"), None);
        assert_eq!(get("export EXPORTED"), None);
        assert_eq!(get("INLINE").as_deref(), Some("value # not a comment"));
        // The trailing blanks follow the closing quote, so the value is not quoted: trimmed.
        assert_eq!(get("TRAILING").as_deref(), Some("\"quoted\""));
        assert_eq!(get("ONE_QUOTE").as_deref(), Some("\""));
        assert_eq!(get("DUP").as_deref(), Some("last"));
        assert_eq!(get("dotted.key-1").as_deref(), Some("x"));
        assert_eq!(get("# comment line"), None);
    }

    /// S10E-R1: JavaScript `\s`/`trim` (U+FEFF yes, U+0085 no) and `.` (stops at U+2028).
    #[test]
    fn javascript_whitespace_and_line_terminators() {
        let env = DotEnv::parse(concat!(
            "\u{feff}FIRST=after a byte order mark\n",
            "PADDED=\u{feff}\u{a0}value\u{3000}\n",
            "NEL=\u{85}value\u{85}\n",
            "SEPARATED=value \u{2028} \n",
            "BROKEN=value\u{2028}more\n",
        ));
        let get = |k: &str| env.file_var(k);
        assert_eq!(get("FIRST").as_deref(), Some("after a byte order mark"));
        assert_eq!(get("PADDED").as_deref(), Some("value"));
        assert_eq!(get("NEL").as_deref(), Some("\u{85}value\u{85}"));
        assert_eq!(get("SEPARATED").as_deref(), Some("value"));
        assert_eq!(get("BROKEN"), None);
    }

    #[test]
    fn the_process_environment_wins_even_when_empty() {
        let env = DotEnv::parse("KEY=file\n");
        assert_eq!(env.var_with("KEY", None).as_deref(), Some("file"));
        assert_eq!(
            env.var_with("KEY", Some("process".into())).as_deref(),
            Some("process")
        );
        assert_eq!(env.var_with("KEY", Some("".into())).as_deref(), Some(""));
        assert_eq!(env.var_with("OTHER", None), None);
    }

    #[test]
    fn a_missing_file_is_environment_only() {
        let missing = std::env::temp_dir()
            .join("server2-dotenv-missing-dir")
            .join(FILE);
        let env = DotEnv::load(&missing).unwrap();
        assert_eq!(env.file_var("PORT"), None);
    }
}
