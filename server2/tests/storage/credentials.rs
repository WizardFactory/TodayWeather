//! S10f (#2759): S3 credentials from the EC2 instance role and the server2 S3 region.
use server2::storage::S3Settings;

const PLACEHOLDER: &str = "You have to set key of AWS";

/// A copy of the operator's legacy `server/.env`: placeholder AWS keys and the legacy
/// `TWA_S3_REGION` of the unrelated 2018 bucket, plus the server2 bucket.
fn copied_legacy(name: &str) -> Option<String> {
    match name {
        "SERVER2_S3_BUCKET" => Some("tw-server2-test".to_owned()),
        "AWS_ACCESS_KEY" | "AWS_SECRET_KEY" => Some(PLACEHOLDER.to_owned()),
        "TWA_S3_REGION" => Some("us-east-1".to_owned()),
        _ => None,
    }
}

#[test]
fn s3_credentials_and_region_follow_s10f() {
    // The legacy region is not read; the server2 default region applies.
    let settings = S3Settings::from_vars(&copied_legacy).unwrap();
    assert_eq!(settings.region, "ap-northeast-2");
    assert_eq!(
        settings.endpoint,
        "https://s3.ap-northeast-2.amazonaws.com/"
    );
    // SERVER2_S3_REGION selects the regional endpoint.
    let eu = |name: &str| match name {
        "SERVER2_S3_REGION" => Some("eu-west-1".to_owned()),
        _ => copied_legacy(name),
    };
    let settings = S3Settings::from_vars(&eu).unwrap();
    assert_eq!(settings.endpoint, "https://s3.eu-west-1.amazonaws.com/");
    // Absent or empty keys select the instance role instead of failing configuration.
    for value in [None, Some("")] {
        let absent = |name: &str| match name {
            "AWS_ACCESS_KEY" | "AWS_SECRET_KEY" => value.map(str::to_owned),
            _ => copied_legacy(name),
        };
        assert!(S3Settings::from_vars(&absent).is_ok(), "{value:?}");
    }
    // One real key without the other is a configuration error.
    for (real, other) in [
        ("AWS_ACCESS_KEY", None),
        ("AWS_SECRET_KEY", Some(PLACEHOLDER)),
    ] {
        let partial = |name: &str| {
            if name == real {
                Some("configured-real-value".to_owned())
            } else if name == "AWS_ACCESS_KEY" || name == "AWS_SECRET_KEY" {
                other.map(str::to_owned)
            } else {
                copied_legacy(name)
            }
        };
        assert!(S3Settings::from_vars(&partial).is_err(), "{real} alone");
    }
}

#[test]
fn the_credential_source_follows_the_keys_and_test_roots_are_loopback() {
    let with = |access: Option<&'static str>, secret: Option<&'static str>| {
        move |name: &str| match name {
            "AWS_ACCESS_KEY" => access.map(str::to_owned),
            "AWS_SECRET_KEY" => secret.map(str::to_owned),
            _ => copied_legacy(name),
        }
    };
    // The copied legacy file (placeholder keys), absent and empty keys: the instance role.
    for (access, secret) in [
        (Some(PLACEHOLDER), Some(PLACEHOLDER)),
        (None, None),
        (Some(""), Some("")),
        (None, Some(PLACEHOLDER)),
    ] {
        let settings = S3Settings::from_vars(&with(access, secret)).unwrap();
        assert!(settings.uses_instance_role(), "{access:?} {secret:?}");
    }
    // Real static keys are used as configured.
    let settings =
        S3Settings::from_vars(&with(Some("configured-access"), Some("configured-secret"))).unwrap();
    assert!(!settings.uses_instance_role());
    // A test IMDS root is plain HTTP to a loopback address with no path.
    for root in [
        "http://127.0.0.1:9",
        "http://127.0.0.1:9/",
        "http://[::1]:9",
    ] {
        assert!(
            S3Settings::from_vars_with(&with(None, None), None, Some(root)).is_ok(),
            "{root}"
        );
    }
    for root in [
        "https://127.0.0.1:9",
        "http://10.0.0.5",
        "http://169.254.169.254.example.test",
        "http://127.0.0.1:9/latest",
        "http://user@127.0.0.1:9",
        "http://127.0.0.1:9/?x",
        "not a url",
    ] {
        assert!(
            S3Settings::from_vars_with(&with(None, None), None, Some(root)).is_err(),
            "{root}"
        );
    }
    // An invalid server2 region is refused.
    let bad = |name: &str| match name {
        "SERVER2_S3_REGION" => Some("bad/region".to_owned()),
        _ => copied_legacy(name),
    };
    assert!(S3Settings::from_vars(&bad).is_err());
}

mod role {
    use super::super::imds::Imds;
    use super::super::peer::Peer;
    use server2::storage::*;
    use std::sync::atomic::Ordering;

    fn record() -> RawRecord {
        RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20261015,
                slot: "1200".into(),
            },
            1760500000000,
            200,
            "application/json",
            None,
            br#"{"s10f":"instance role"}"#.as_slice().into(),
            &Limits::default(),
        )
        .unwrap()
    }
    fn settings(
        peer: &Peer,
        imds: &Imds,
        keys: Option<(&'static str, &'static str)>,
    ) -> S3Settings {
        let var = move |name: &str| match name {
            "SERVER2_S3_BUCKET" => Some("records".to_owned()),
            "AWS_ACCESS_KEY" => keys.map(|k| k.0.to_owned()),
            "AWS_SECRET_KEY" => keys.map(|k| k.1.to_owned()),
            _ => None,
        };
        S3Settings::from_vars_with(&var, Some(&peer.endpoint), Some(&imds.root)).unwrap()
    }

    /// Without keys a raw record is written and read with IMDSv2 role credentials (session
    /// token included); one refresh serves every request while the credentials are fresh.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn instance_role_credentials_write_and_read_a_raw_record() {
        let peer = Peer::new();
        let imds = Imds::start("server2-local-role", true).await;
        let settings = settings(&peer, &imds, None);
        assert!(settings.uses_instance_role());
        // Reading the settings and building the transport do not contact IMDS.
        let store = RawRecordStore::new(settings.transport().unwrap(), Limits::default()).unwrap();
        assert_eq!(imds.requests(), 0);
        let record = record();
        let id = record.envelope.identity.clone();
        assert_eq!(
            store.publish(record.clone()).await.unwrap(),
            PublishOutcome::Created
        );
        assert_eq!(
            store.publish(record).await.unwrap(),
            PublishOutcome::AlreadyPresent
        );
        assert_eq!(
            &*store.load(&id).await.unwrap().bytes,
            br#"{"s10f":"instance role"}"#
        );
        assert_eq!(imds.requests(), 3, "token, role name, credentials once");
        let state = peer.state.lock().unwrap();
        assert!(!state.credential_ids.is_empty());
        assert!(
            state
                .credential_ids
                .iter()
                .all(|id| id == "server2-local-role-1"),
            "{:?}",
            state.credential_ids
        );
        assert!(state.session_tokens.iter().all(|t| *t));
    }

    /// Real static keys sign without a session token and never contact IMDS.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn static_keys_never_contact_imds() {
        let peer = Peer::new();
        let imds = Imds::start("server2-local-role", true).await;
        let settings = settings(
            &peer,
            &imds,
            Some(("server2-local", "server2-local-secret")),
        );
        assert!(!settings.uses_instance_role());
        let store = RawRecordStore::new(settings.transport().unwrap(), Limits::default()).unwrap();
        assert_eq!(
            store.publish(record()).await.unwrap(),
            PublishOutcome::Created
        );
        assert_eq!(imds.requests(), 0);
        let state = peer.state.lock().unwrap();
        assert!(state.credential_ids.iter().all(|id| id == "server2-local"));
        assert!(state.session_tokens.iter().all(|t| !*t));
    }

    /// An IMDS failure is a transport failure before any S3 request: a missing role (IMDS 404)
    /// is never an absent object, and attempts are spaced instead of repeated per request.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_imds_failure_sends_no_s3_request_and_is_not_an_absent_object() {
        let peer = Peer::new();
        let imds = Imds::start("server2-local-role", true).await;
        imds.state.status.store(404, Ordering::Release);
        let store = RawRecordStore::new(
            settings(&peer, &imds, None).transport().unwrap(),
            Limits::default(),
        )
        .unwrap();
        let id = record().envelope.identity.clone();
        let first = store.load(&id).await.unwrap_err();
        assert_ne!(first, Error::NotFound);
        assert_eq!(imds.requests(), 3);
        let second = store.load(&id).await.unwrap_err();
        assert_ne!(second, Error::NotFound);
        assert_eq!(
            imds.requests(),
            3,
            "no new attempt within the retry spacing"
        );
        assert!(peer.state.lock().unwrap().calls.is_empty());
        assert_eq!(CREDENTIAL_RETRY_AFTER, std::time::Duration::from_secs(10));
    }

    /// S10F GROK-1: without credentials no PUT is sent, so publication fails definitely
    /// (`Transport`), not as an ambiguous write that must be reconciled.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_credential_failure_before_the_put_is_not_an_ambiguous_write() {
        let peer = Peer::new();
        let imds = Imds::start("server2-local-role", true).await;
        imds.state.status.store(404, Ordering::Release);
        let store = RawRecordStore::new(
            settings(&peer, &imds, None).transport().unwrap(),
            Limits::default(),
        )
        .unwrap();
        assert_eq!(store.publish(record()).await, Err(Error::Transport));
        assert_eq!(store.publish(record()).await, Err(Error::Transport));
        assert_eq!(imds.requests(), 3, "spaced, not repeated per publication");
        assert!(peer.state.lock().unwrap().calls.is_empty());
    }
}
