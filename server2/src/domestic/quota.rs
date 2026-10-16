//! data.go.kr daily quotas per API and key (AK decision 5, 2026-10-16).
//!
//! data.go.kr allocates its daily traffic per API (one dataset, all of its operations) and per
//! key: every API page lists "개발계정 : N" for a development key and lets an operating account
//! raise it after a use case is registered. S08 therefore keeps one quota owner per key, API and
//! KST day ([`quota_owner`]). The default limit is the documented development allowance of the
//! API. [`OPERATING_UNITS`] holds the approved operating allowances: AK supplies them
//! later, and an entry there replaces the development allowance of that API.
use std::fmt;

/// One data.go.kr API that server2 calls with a key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DataGoKrApi {
    /// 기상청_단기예보 조회서비스: current, ultra-short and short grids.
    VilageFcst,
    /// 기상청_중기예보 조회서비스.
    MidFcst,
    /// 기상청_예보구역정보 조회서비스.
    FcstZone,
    /// 기상청_기상특보 조회서비스.
    WthrWrn,
    /// 기상청_지상(종관, ASOS) 시간자료 조회서비스.
    AsosHourly,
    /// 기상청_지상(종관, ASOS) 일자료 조회서비스.
    AsosDaily,
    /// 기상청_생활기상지수 조회서비스 (UV V5).
    LivingWthrIdx,
    /// 기상청_꽃가루농도위험지수 조회서비스(3.0).
    HealthWthrIdx,
    /// 한국천문연구원_출몰시각 정보.
    RiseSet,
    /// 한국환경공단_에어코리아_대기오염정보 (real-time measurements, dust forecast).
    AirKoreaArpltn,
    /// 한국환경공단_에어코리아_측정소정보 (station list).
    AirKoreaMsrstn,
}
/// Approved operating allowances per API (units per key and KST day). Empty until AK supplies
/// the values; an entry replaces that API's development allowance.
pub const OPERATING_UNITS: &[(DataGoKrApi, u64)] = &[];

impl DataGoKrApi {
    pub const ALL: [Self; 11] = [
        Self::VilageFcst,
        Self::MidFcst,
        Self::FcstZone,
        Self::WthrWrn,
        Self::AsosHourly,
        Self::AsosDaily,
        Self::LivingWthrIdx,
        Self::HealthWthrIdx,
        Self::RiseSet,
        Self::AirKoreaArpltn,
        Self::AirKoreaMsrstn,
    ];
    /// The API's path below the data.go.kr root (its operations follow it).
    pub fn path(self) -> &'static str {
        match self {
            Self::VilageFcst => "1360000/VilageFcstInfoService_2.0",
            Self::MidFcst => "1360000/MidFcstInfoService",
            Self::FcstZone => "1360000/FcstZoneInfoService",
            Self::WthrWrn => "1360000/WthrWrnInfoService",
            Self::AsosHourly => "1360000/AsosHourlyInfoService",
            Self::AsosDaily => "1360000/AsosDalyInfoService",
            Self::LivingWthrIdx => "1360000/LivingWthrIdxServiceV5",
            Self::HealthWthrIdx => "1360000/HealthWthrIdxServiceV3",
            Self::RiseSet => "B090041/openapi/service/RiseSetInfoService",
            Self::AirKoreaArpltn => "B552584/ArpltnInforInqireSvc",
            Self::AirKoreaMsrstn => "B552584/MsrstnInfoInqireSvc",
        }
    }
    /// The data.go.kr dataset page that documents the API and its allowance.
    pub fn dataset(self) -> u32 {
        match self {
            Self::VilageFcst => 15084084,
            Self::MidFcst => 15059468,
            Self::FcstZone => 15057111,
            Self::WthrWrn => 15000415,
            Self::AsosHourly => 15057210,
            Self::AsosDaily => 15059093,
            Self::LivingWthrIdx => 15085288,
            Self::HealthWthrIdx => 15085289,
            Self::RiseSet => 15012688,
            Self::AirKoreaArpltn => 15073861,
            Self::AirKoreaMsrstn => 15073877,
        }
    }
    /// The documented development allowance ("개발계정", read 2026-10-15/16 on the dataset page).
    pub fn development_units(self) -> u64 {
        match self {
            Self::AirKoreaArpltn | Self::AirKoreaMsrstn => 500,
            _ => 10_000,
        }
    }
    /// Units per key and KST day: the approved operating allowance when one is recorded in
    /// [`OPERATING_UNITS`], otherwise the development allowance.
    pub fn daily_units(self) -> u64 {
        OPERATING_UNITS
            .iter()
            .find(|(api, _)| *api == self)
            .map_or_else(|| self.development_units(), |(_, units)| *units)
    }
    /// The API a request URL calls (any root, including a loopback test root; None outside
    /// these APIs).
    pub fn of_url(url: &reqwest::Url) -> Option<Self> {
        let path = url.path();
        Self::ALL.into_iter().find(|api| {
            path.split_once(&format!("/{}/", api.path()))
                .is_some_and(|(root, _)| root.is_empty() || root.starts_with('/'))
        })
    }
}
impl fmt::Display for DataGoKrApi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.path())
    }
}
/// The S08 quota owner of one key and API: a domain-separated SHA-256 (the key never leaves).
/// `domain` separates key lists that legacy configures apart (`DONGNAE_SECRET_KEYS`,
/// `AIRKOREA_SECRET_KEYS`).
pub fn quota_owner(domain: &str, key: &str, api: DataGoKrApi) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"server2-data-go-kr-api-quota-v2");
    hash.update([0u8]);
    hash.update(domain.as_bytes());
    hash.update([0u8]);
    hash.update(api.path().as_bytes());
    hash.update([0u8]);
    hash.update(key.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domestic::family::{DataGoKrFamily as F, Service};

    fn url(root: &str, path: &str) -> reqwest::Url {
        reqwest::Url::parse(root).unwrap().join(path).unwrap()
    }
    /// Every operation server2 calls with a data.go.kr key maps to one API of its service.
    #[test]
    fn every_keyed_operation_maps_to_an_api_of_its_service() {
        let operations: Vec<(&str, Service)> = [
            F::UltraSrtNcst,
            F::UltraSrtFcst,
            F::VilageFcst,
            F::MidFcst,
            F::MidLandFcst,
            F::MidTa,
            F::MidSeaFcst,
            F::UvIdxV5,
            F::OakPollenV3,
            F::PinePollenV3,
            F::WeedsPollenV3,
        ]
        .into_iter()
        .map(|f| (f.operation(), f.service()))
        .chain([
            (
                "1360000/AsosHourlyInfoService/getWthrDataList",
                Service::Asos,
            ),
            ("1360000/AsosDalyInfoService/getWthrDataList", Service::Asos),
            (
                "1360000/FcstZoneInfoService/getFcstZoneCd",
                Service::ForecastZone,
            ),
            (
                "B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo",
                Service::RiseSet,
            ),
            (
                "B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty",
                Service::AirKorea,
            ),
            (
                "B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth",
                Service::AirKorea,
            ),
            (
                "B552584/MsrstnInfoInqireSvc/getMsrstnList",
                Service::AirKorea,
            ),
        ])
        .collect();
        for root in ["https://apis.data.go.kr/", "http://127.0.0.1:9/"] {
            for (path, service) in &operations {
                let api = DataGoKrApi::of_url(&url(root, path)).unwrap_or_else(|| panic!("{path}"));
                assert!(service.apis().contains(&api), "{path}: {api}");
            }
            let warn = url(root, "1360000/WthrWrnInfoService/getPwnStatus");
            assert_eq!(DataGoKrApi::of_url(&warn), Some(DataGoKrApi::WthrWrn));
        }
        // A path outside the APIs, or an API name inside another segment, maps to none.
        assert_eq!(
            DataGoKrApi::of_url(&url("http://x/", "wid/queryDFS.jsp")),
            None
        );
        assert_eq!(
            DataGoKrApi::of_url(&url("http://x/", "x1360000/MidFcstInfoService/getMidTa")),
            None
        );
    }
    #[test]
    fn allowances_are_the_documented_development_units_until_operating_values_are_recorded() {
        assert!(OPERATING_UNITS.is_empty());
        for api in DataGoKrApi::ALL {
            assert_eq!(api.daily_units(), api.development_units());
        }
        assert_eq!(DataGoKrApi::VilageFcst.daily_units(), 10_000);
        assert_eq!(DataGoKrApi::AirKoreaArpltn.daily_units(), 500);
        assert_eq!(DataGoKrApi::AirKoreaMsrstn.daily_units(), 500);
    }
    #[test]
    fn each_key_and_api_has_its_own_quota_owner() {
        let mut owners = std::collections::HashSet::new();
        for domain in ["DONGNAE_SECRET_KEYS", "AIRKOREA_SECRET_KEYS"] {
            for key in ["key-a", "key-b"] {
                for api in DataGoKrApi::ALL {
                    let owner = quota_owner(domain, key, api);
                    assert_eq!(owner.len(), 64);
                    assert!(!owner.contains(key));
                    assert!(owners.insert(owner));
                }
            }
        }
    }
}
