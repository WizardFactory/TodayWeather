//! S15b-3c: the keyless AirKorea forecast-image acquisition, as legacy master `1d60f728` (#2757, #2762)
//! collects the images. `AirkoreaHourlyForecastController._getImgPaths` (L67-L93) takes the
//! announcement's first PM10 document's `imageUrl[6]` and first PM2.5 document's `imageUrl[7]`;
//! `getDustImage` (`airkorea.dust.image.controller` L256-L305) requires both to pass
//! `airkoreaImageLayout.frameStart` (the characterized six-hour `/dustImage/YYYY/MM/DD/HH/09km/` cycles, #2762) and
//! has get-pixels fetch both; any failure stores nothing for the run.
//!
//! The provider-supplied URLs are never fetched as given: their validated path is fetched on the
//! built-in image origin ([`crate::domestic::family::Endpoints::image_url`]). One acquisition is
//! one group dated by the announcement: page 1 the PM10 GIF, page 2 the PM2.5 GIF, page 3 a JSON
//! manifest of the two URLs (their path dates the frames).
use super::kma::source::air_forecast::{Calibration, frame_start, image_shape_ok};
use super::publication::Publication;
use crate::storage::{Period, ProviderKey};

pub const SOURCE: &str = "airkorea-image";
pub const KIND: &str = "airkorea-forecast-image";
/// The host part the characterized image URLs carry.
const PREFIXES: [&str; 2] = ["https://www.airkorea.or.kr", "http://www.airkorea.or.kr"];

/// The two images of one dust-forecast announcement.
#[derive(Debug, Clone, PartialEq)]
pub struct AirKoreaImageRequest {
    announcement: Publication,
    /// PM10 then PM2.5, as the documents name them.
    urls: [String; 2],
    calibration: Calibration,
}
impl AirKoreaImageRequest {
    /// Both URLs must be characterized animation paths of their pollutant (`frameStart`); legacy
    /// rejects the pair otherwise, before any download.
    pub fn new(
        announcement: Publication,
        pm10: &str,
        pm25: &str,
        calibration: Calibration,
    ) -> Result<Self, super::DomesticError> {
        if announcement.minute() != 0
            || frame_start(pm10, "PM10").is_err()
            || frame_start(pm25, "PM25").is_err()
        {
            return Err(super::DomesticError::Invalid("image path"));
        }
        Ok(Self {
            announcement,
            urls: [pm10.to_owned(), pm25.to_owned()],
            calibration,
        })
    }
    pub fn announcement(&self) -> Publication {
        self.announcement
    }
    /// The URLs as the documents name them, PM10 then PM2.5.
    pub fn urls(&self) -> [&str; 2] {
        [&self.urls[0], &self.urls[1]]
    }
    /// The URL paths (`/dustImage/…`) fetched on the built-in origin, PM10 then PM2.5.
    pub fn paths(&self) -> [&str; 2] {
        self.urls
            .each_ref()
            .map(|u| PREFIXES.iter().find_map(|p| u.strip_prefix(p)).unwrap_or(u))
    }
    /// The image shape the decoder accepts.
    pub fn shape_ok(&self, gif: &[u8]) -> bool {
        image_shape_ok(gif, &self.calibration)
    }
    /// The manifest record body: `{"pm10": url, "pm25": url}`.
    pub fn manifest(&self) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"pm10": self.urls[0], "pm25": self.urls[1]}))
            .expect("JSON of two strings")
    }
    pub fn provider_key() -> ProviderKey {
        ProviderKey::Named {
            id: "national".into(),
        }
    }
    pub fn period(&self) -> Period {
        self.announcement.period()
    }
    /// Catalog partition: the announcement's KST day.
    pub fn partition(&self) -> String {
        self.announcement.base_date()
    }
}
/// The two URLs of a stored manifest record, PM10 then PM2.5.
pub fn manifest_urls(body: &[u8]) -> Option<[String; 2]> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    Some([
        v.get("pm10")?.as_str()?.to_owned(),
        v.get("pm25")?.as_str()?.to_owned(),
    ])
}
