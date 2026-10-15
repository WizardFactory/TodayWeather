//! S15b-3c: the keyless AirKorea forecast-image acquisition. Legacy
//! `AirkoreaHourlyForecastController._getImgPaths` (L64-L88) takes the announcement's first PM10
//! document's `imageUrl[6]` and first PM2.5 document's `imageUrl[7]`, and `getDustImage`
//! (`airkorea.dust.image.controller` L405-L455) has get-pixels fetch both; an image that does not
//! decode or has another size is an error and nothing is stored (`INVALID_IMAGE`). A document
//! without its image URL skips that pollutant (`imgPaths.pm10 == undefined`, L412/L429) while the
//! other one is stored. One acquisition is the pair as one group (page 1 PM10, page 2 PM2.5),
//! dated by the announcement; a skipped pollutant is an empty record with status 204.
use super::publication::Publication;
use crate::storage::{Period, ProviderKey};
use reqwest::Url;

pub const SOURCE: &str = "airkorea-image";
pub const KIND: &str = "airkorea-forecast-image";

/// The images of one dust-forecast announcement (at least one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AirKoreaImageRequest {
    announcement: Publication,
    pm10: Option<Url>,
    pm25: Option<Url>,
    /// The GIF logical screen the decoder accepts (`isValidImage`).
    size: (usize, usize),
}
/// An image URL from the provider. The acquirer fetches it only on its built-in image origin
/// ([`crate::domestic::family::Endpoints::image_allowed`]).
fn image_url(text: &str) -> Result<Url, super::DomesticError> {
    let url = Url::parse(text).map_err(|_| super::DomesticError::Invalid("image url"))?;
    if crate::providers::PublicRequest::new(url.clone()).is_err() {
        return Err(super::DomesticError::Invalid("image url"));
    }
    Ok(url)
}
impl AirKoreaImageRequest {
    /// `pm10`/`pm25`: the image URL, or None when the document names none (that pollutant is
    /// skipped). At least one is required.
    pub fn new(
        announcement: Publication,
        pm10: Option<&str>,
        pm25: Option<&str>,
        size: (usize, usize),
    ) -> Result<Self, super::DomesticError> {
        if announcement.minute() != 0 || (pm10.is_none() && pm25.is_none()) {
            return Err(super::DomesticError::Invalid("announcement"));
        }
        Ok(Self {
            announcement,
            pm10: pm10.map(image_url).transpose()?,
            pm25: pm25.map(image_url).transpose()?,
            size,
        })
    }
    pub fn announcement(&self) -> Publication {
        self.announcement
    }
    /// PM10 then PM2.5 (None: skipped).
    pub fn urls(&self) -> [Option<&Url>; 2] {
        [self.pm10.as_ref(), self.pm25.as_ref()]
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
/// The status of the empty record of a skipped pollutant.
pub const SKIPPED: u16 = 204;
/// Whether `bytes` is a GIF of the accepted logical screen (legacy `isValidImage` after
/// get-pixels decoded it).
pub fn valid_image(bytes: &[u8], size: (usize, usize)) -> bool {
    crate::domestic::kma::source::gif::GifReader::new(bytes)
        .is_ok_and(|r| (r.width, r.height) == size && r.num_frames() > 0)
}
