//! Request arguments and key resolution versus legacy getUrl/dataGoKrKeys at ca8735cf.
use server2::domestic::family::{
    DataGoKrFamily as F, DataGoKrRequest, Endpoints, Service, Target, WebRequest,
};
use server2::domestic::keys::parse_keys;
use server2::domestic::publication::Publication;
use server2::storage::ProviderKey;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn url(r: &DataGoKrRequest, page: u32) -> String {
    r.endpoint(&Endpoints::default(), page).unwrap().to_string()
}
const GRID: Target = Target::Grid { nx: 60, ny: 127 };

#[test]
fn town_forecast_arguments_match_legacy_get_url() {
    let base = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/";
    for (family, op, time) in [
        (F::UltraSrtNcst, "getUltraSrtNcst", 1400),
        (F::UltraSrtFcst, "getUltraSrtFcst", 1430),
        (F::VilageFcst, "getVilageFcst", 1400),
    ] {
        let r = DataGoKrRequest::new(family, GRID, p(20261013, time)).unwrap();
        assert_eq!(r.family().service(), Service::VilageFcst);
        assert_eq!(
            url(&r, 2),
            format!(
                "{base}{op}?base_date=20261013&base_time={time:04}&nx=60&ny=127&pageNo=2&numOfRows=999"
            )
        );
        assert_eq!(r.provider_key(), ProviderKey::Grid { nx: 60, ny: 127 });
    }
}

#[test]
fn mid_and_life_index_arguments_match_legacy() {
    let mid = "https://apis.data.go.kr/1360000/MidFcstInfoService/";
    let r =
        DataGoKrRequest::new(F::MidFcst, Target::Station("108".into()), p(20261013, 600)).unwrap();
    assert_eq!(
        url(&r, 1),
        format!("{mid}getMidFcst?stnId=108&tmFc=202610130600&pageNo=1&numOfRows=999")
    );
    assert_eq!(
        r.provider_key(),
        ProviderKey::Named {
            id: "stn-108".into()
        }
    );
    for (family, op) in [
        (F::MidLandFcst, "getMidLandFcst"),
        (F::MidTa, "getMidTa"),
        (F::MidSeaFcst, "getMidSeaFcst"),
    ] {
        let r = DataGoKrRequest::new(family, Target::Region("11B00000".into()), p(20261012, 1800))
            .unwrap();
        assert_eq!(r.family().service(), Service::MidFcst);
        assert_eq!(
            url(&r, 1),
            format!("{mid}{op}?regId=11B00000&tmFc=202610121800&pageNo=1&numOfRows=999")
        );
        assert_eq!(
            r.provider_key(),
            ProviderKey::Named {
                id: "reg-11b00000".into()
            }
        );
    }
    let uv = DataGoKrRequest::new(F::UvIdxV5, Target::AllAreas, p(20261013, 1200)).unwrap();
    assert_eq!(uv.family().service(), Service::LivingWthrIdx);
    assert_eq!(
        url(&uv, 3),
        "https://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5?pageNo=3&numOfRows=1000&areaNo=&time=2026101312"
    );
    assert_eq!(
        uv.provider_key(),
        ProviderKey::Named {
            id: "all-areas".into()
        }
    );
    for (family, op) in [
        (F::OakPollenV3, "getOakPollenRiskIdxV3"),
        (F::PinePollenV3, "getPinePollenRiskIdxV3"),
        (F::WeedsPollenV3, "getWeedsPollenRiskndxV3"),
    ] {
        let r = DataGoKrRequest::new(family, Target::AllAreas, p(20261013, 700)).unwrap();
        assert_eq!(r.family().service(), Service::HealthWthrIdx);
        assert_eq!(
            url(&r, 1),
            format!(
                "https://apis.data.go.kr/1360000/HealthWthrIdxServiceV3/{op}?pageNo=1&numOfRows=1000&areaNo=&time=2026101307"
            )
        );
    }
}

#[test]
fn invalid_publications_and_targets_are_rejected_before_funding() {
    let bad = [
        (F::VilageFcst, GRID, 1430),
        (F::VilageFcst, GRID, 1300),
        (F::UltraSrtFcst, GRID, 1400),
        (F::UltraSrtNcst, GRID, 1430),
        (F::VilageFcst, Target::Grid { nx: 0, ny: 127 }, 1400),
        (F::VilageFcst, Target::Grid { nx: 60, ny: 254 }, 1400),
        (F::VilageFcst, Target::AllAreas, 1400),
        (F::MidFcst, Target::Region("11B00000".into()), 600),
        (F::MidTa, Target::Station("108".into()), 600),
        (F::MidTa, Target::Region("11B00000".into()), 1200),
        (F::MidTa, Target::Region("11b00000".into()), 600),
        (F::MidTa, Target::Region("11B00000&x=1".into()), 600),
        (F::UvIdxV5, Target::AllAreas, 1300),
        (F::UvIdxV5, Target::AllAreas, 1230),
        (F::OakPollenV3, GRID, 1300),
    ];
    for (family, target, time) in bad {
        assert!(
            DataGoKrRequest::new(family, target.clone(), p(20261013, time)).is_err(),
            "{family:?} {target:?} {time}"
        );
    }
    let r = DataGoKrRequest::new(F::VilageFcst, GRID, p(20261013, 1400)).unwrap();
    assert!(r.endpoint(&Endpoints::default(), 0).is_err());
    assert!(r.endpoint(&Endpoints::default(), 6).is_err());
}

#[test]
fn kma_web_arguments_match_legacy_urls() {
    let e = Endpoints::default();
    assert_eq!(
        WebRequest::town_rss(60, 127)
            .unwrap()
            .endpoint(&e)
            .unwrap()
            .as_str(),
        "https://www.kma.go.kr/wid/queryDFS.jsp?gridx=60&gridy=127"
    );
    assert_eq!(
        WebRequest::aws_minute(None).endpoint(&e).unwrap().as_str(),
        "https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min"
    );
    assert_eq!(
        WebRequest::aws_hourly(p(20261013, 1400))
            .unwrap()
            .endpoint(&e)
            .unwrap()
            .as_str(),
        "https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min?202610131400&0&MINDB_60M&0&m"
    );
    assert_eq!(
        WebRequest::city(p(20261013, 1400))
            .unwrap()
            .endpoint(&e)
            .unwrap()
            .as_str(),
        "https://www.weather.go.kr/weather/observation/currentweather.jsp?tm=2026.10.13.14:00"
    );
    assert!(WebRequest::aws_hourly(p(20261013, 1430)).is_err());
    assert!(WebRequest::town_rss(0, 1).is_err());
    assert!(
        Endpoints::new(
            "http://example.com/",
            "https://www.kma.go.kr/",
            "https://www.weather.go.kr/"
        )
        .is_err()
    );
    assert!(
        Endpoints::new(
            "https://apis.data.go.kr/",
            "https://u:p@www.kma.go.kr/",
            "https://www.weather.go.kr/"
        )
        .is_err()
    );
    assert!(
        Endpoints::new(
            "http://127.0.0.1:9/",
            "http://127.0.0.1:9/",
            "http://[::1]:9/"
        )
        .is_ok()
    );
}

#[test]
fn keys_follow_legacy_parse_and_single_decoding() {
    // Built from single-line literals: the placement gate treats multi-line literals
    // containing '/' as encoded path-like text.
    let raw = serde_json::json!([
        "short",
        "You have to set DONGNAE_SECRET_KEYS xxxxxxxx",
        "abc%2Bdef%2Fghi%3Djklmnopq",
        "abc%2Bdef%2Fghi%3Djklmnopq",
        "raw+key/with=plain0123456",
        "bad%ZZencodedkeyvalue1234",
        42,
        "   padded-but-short   "
    ])
    .to_string();
    assert_eq!(
        parse_keys(&raw),
        vec![
            "abc+def/ghi=jklmnopq".to_owned(),
            "raw+key/with=plain0123456".to_owned()
        ]
    );
    assert!(parse_keys("{}").is_empty());
    assert!(parse_keys("not json").is_empty());
    // Decoding happens once: an encoded percent sign stays a literal percent sign.
    assert_eq!(
        parse_keys(r#"["abc%2525def0123456789xyz"]"#),
        vec!["abc%25def0123456789xyz".to_owned()]
    );
    // Invalid UTF-8 after decoding is rejected like decodeURIComponent's URIError.
    assert!(parse_keys(r#"["abc%FFdef0123456789xyzab"]"#).is_empty());
}
