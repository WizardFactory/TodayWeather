//! S18a offline converter for the one-time copy of legacy push registrations.
//!
//! Reads local `mongoexport` output of the legacy `pushes` (alarms) and `alertpushes` (alerts)
//! collections (one document per line or `--jsonArray`; relaxed, canonical or legacy Extended
//! JSON) and writes the canonical server2 import file plus a report of malformed documents.
//! It opens no network connection and no database; producing the export is a separate,
//! authorized read-only operator action. The report holds counts, positions and reasons only:
//! no field values or device tokens.
//!
//! Usage: push_registration_convert PUSHES_EXPORT ALERTPUSHES_EXPORT IMPORT_FILE REPORT_FILE
use server2::push::{Coll, migrate};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!(
            "usage: push_registration_convert PUSHES_EXPORT ALERTPUSHES_EXPORT IMPORT_FILE REPORT_FILE"
        );
        std::process::exit(2);
    }
    let mut out = String::new();
    let mut report = migrate::Report::default();
    for (path, c) in [(&args[1], Coll::Alarm), (&args[2], Coll::Alert)] {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!(
                    "push_registration_convert: cannot read {}: {e}",
                    c.collection()
                );
                std::process::exit(2);
            }
        };
        migrate::convert(c, &bytes, &mut out, &mut report);
    }
    if let Err(e) = write_private(&args[3], out.as_bytes()) {
        eprintln!("push_registration_convert: cannot write the import file: {e}");
        std::process::exit(1);
    }
    if let Err(e) = std::fs::write(&args[4], report.to_json()) {
        eprintln!("push_registration_convert: cannot write the report: {e}");
        std::process::exit(1);
    }
    println!(
        "read={:?} converted={:?} malformed={} extra_fields={:?}",
        report.read,
        report.converted,
        report.malformed.len(),
        report.extra_fields
    );
}

/// The import file holds device tokens: owner-only permissions where the platform has them.
fn write_private(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)
}
