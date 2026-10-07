use crate::storage::{Error, sha256};
use serde::Serialize;
use std::collections::BTreeMap;

/// Exact output semantics; never reduce the final response key to a provider grid.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResponseKey {
    route: String,
    version: String,
    location: String,
    locale: String,
    units: String,
    air_units: String,
    parser_revision: String,
    parameters: BTreeMap<String, String>,
}
impl ResponseKey {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        route: &str,
        version: &str,
        location: &str,
        locale: &str,
        units: &str,
        air_units: &str,
        parser_revision: &str,
        parameters: BTreeMap<String, String>,
    ) -> Result<Self, Error> {
        let strings = [
            route,
            version,
            location,
            locale,
            units,
            air_units,
            parser_revision,
        ];
        if strings
            .iter()
            .any(|s| s.is_empty() || s.len() > 1024 || s.chars().any(char::is_control))
            || parameters.len() > 32
            || parameters.iter().any(|(k, v)| {
                k.is_empty()
                    || k.len() > 128
                    || v.len() > 1024
                    || k.chars().chain(v.chars()).any(char::is_control)
            })
        {
            return Err(Error::Invalid("response identity"));
        }
        let out = Self {
            route: route.into(),
            version: version.into(),
            location: location.into(),
            locale: locale.into(),
            units: units.into(),
            air_units: air_units.into(),
            parser_revision: parser_revision.into(),
            parameters,
        };
        if out.canonical()?.len() > 8192 {
            return Err(Error::Invalid("response key size"));
        }
        Ok(out)
    }
    pub fn canonical(&self) -> Result<Vec<u8>, Error> {
        serde_json::to_vec(self).map_err(|_| Error::Invalid("response key"))
    }
    pub fn fingerprint(&self) -> Result<String, Error> {
        Ok(sha256(&self.canonical()?))
    }
    pub fn route(&self) -> &str {
        &self.route
    }
    pub fn version(&self) -> &str {
        &self.version
    }
    pub fn units(&self) -> &str {
        &self.units
    }
    pub fn air_units(&self) -> &str {
        &self.air_units
    }
    pub fn parameters(&self) -> &BTreeMap<String, String> {
        &self.parameters
    }
    pub fn parser_revision(&self) -> &str {
        &self.parser_revision
    }
    pub fn location(&self) -> &str {
        &self.location
    }
    pub fn locale(&self) -> &str {
        &self.locale
    }
}

/// Intentionally neither Debug nor Serialize: exact reverse queries live only in memory.
#[derive(Clone, PartialEq, Eq)]
pub struct GeocodeMemoryKey {
    query: String,
    locale: String,
}
impl GeocodeMemoryKey {
    pub fn coordinates(latitude: &str, longitude: &str, locale: &str) -> Result<Self, Error> {
        let lat = latitude
            .parse::<f64>()
            .map_err(|_| Error::Invalid("latitude"))?;
        let lon = longitude
            .parse::<f64>()
            .map_err(|_| Error::Invalid("longitude"))?;
        if !lat.is_finite()
            || !lon.is_finite()
            || !(-90.0..=90.0).contains(&lat)
            || !(-180.0..=180.0).contains(&lon)
            || latitude.len() > 32
            || longitude.len() > 32
        {
            return Err(Error::Invalid("geocode coordinates"));
        }
        Self::new(format!("coord:{latitude},{longitude}"), locale)
    }
    pub fn address(address: &str, locale: &str) -> Result<Self, Error> {
        Self::new(format!("addr:{address}"), locale)
    }
    fn new(query: String, locale: &str) -> Result<Self, Error> {
        if query.len() > 1024
            || query.len() <= 5
            || locale.is_empty()
            || locale.len() > 32
            || query.chars().chain(locale.chars()).any(char::is_control)
        {
            return Err(Error::Invalid("geocode key"));
        }
        Ok(Self {
            query,
            locale: locale.into(),
        })
    }
    pub fn fingerprint(&self) -> String {
        sha256(
            &serde_json::to_vec(&(&self.query, &self.locale)).expect("string tuple serialization"),
        )
    }
    /// This validates identity policy only, not a persistent geocoder body or label proof.
    pub fn authorize_projection_identity(&self) -> Result<(), Error> {
        Err(Error::Invalid("exact geocode queries are volatile only"))
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct ParsedKey {
    pub record_object_key: String,
    pub parser_revision: String,
}
impl ParsedKey {
    pub fn new(record: &crate::storage::RecordId, revision: &str) -> Result<Self, Error> {
        if revision.is_empty() || revision.len() > 128 || revision.chars().any(char::is_control) {
            return Err(Error::Invalid("parser revision"));
        }
        Ok(Self {
            record_object_key: record.object_key()?,
            parser_revision: revision.into(),
        })
    }
}
