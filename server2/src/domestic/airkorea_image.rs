//! S15b-3c: the keyless AirKorea forecast-image acquisition. Legacy
//! `AirkoreaHourlyForecastController._getImgPaths` (L64-L88) takes the announcement's first PM10
//! document's `imageUrl[6]` and first PM2.5 document's `imageUrl[7]`, and `getDustImage`
//! (`airkorea.dust.image.controller` L405-L455) has get-pixels fetch both; an image that does not
//! decode or has another size is an error and nothing is stored (`INVALID_IMAGE`). One acquisition
//! is the pair as one group (page 1 PM10, page 2 PM2.5), dated by the announcement.
use super::publication::Publication;
use crate::storage::{Period, ProviderKey};
use reqwest::Url;

pub const SOURCE: &str = "airkorea-image";
pub const KIND: &str = "airkorea-forecast-image";
/// The provider host of the images (`imageUrl1..9` of `getMinuDustFrcstDspth`).
pub const HOST: &str = "www.airkorea.or.kr";

/// The two images of one dust-forecast announcement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirKoreaImageRequest {
    announcement: Publication,
    pm10: Url,
    pm25: Url,
    /// The GIF logical screen the decoder accepts (`isValidImage`).
    size: (usize, usize),
}
/// An image URL from the provider: HTTPS on the AirKorea host, or a loopback test peer.
fn image_url(text: &str) -> Result<Url, super::DomesticError> {
    let url = Url::parse(text).map_err(|_| super::DomesticError::Invalid("image url"))?;
    let loopback = url
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    let production = url.scheme() == "https" && url.host_str() == Some(HOST);
    if !(production || loopback) || crate::providers::PublicRequest::new(url.clone()).is_err() {
        return Err(super::DomesticError::Invalid("image url"));
    }
    Ok(url)
}
impl AirKoreaImageRequest {
    pub fn new(
        announcement: Publication,
        pm10: &str,
        pm25: &str,
        size: (usize, usize),
    ) -> Result<Self, super::DomesticError> {
        if announcement.minute() != 0 {
            return Err(super::DomesticError::Invalid("announcement"));
        }
        Ok(Self {
            announcement,
            pm10: image_url(pm10)?,
            pm25: image_url(pm25)?,
            size,
        })
    }
    pub fn announcement(&self) -> Publication {
        self.announcement
    }
    /// PM10 then PM2.5.
    pub fn urls(&self) -> [&Url; 2] {
        [&self.pm10, &self.pm25]
    }
    pub fn size(&self) -> (usize, usize) {
        self.size
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
/// Whether `bytes` is a GIF of the accepted logical screen (legacy `isValidImage` after
/// get-pixels decoded it).
pub fn valid_image(bytes: &[u8], size: (usize, usize)) -> bool {
    crate::domestic::kma::source::gif::GifReader::new(bytes)
        .is_ok_and(|r| (r.width, r.height) == size && r.num_frames() > 0)
}
