use super::{GeoClient, GeocodeError};
use crate::cache::{ByteBudget, WeightedCache};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MONTH_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const PROJECTION_BYTES: usize = 16 * 1024;

/// Never Debug or Serialize: reverse request identity is volatile only.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) enum LookupKey {
    Coord {
        lat: u64,
        lon: u64,
        language: String,
    },
    Address(String),
}
impl LookupKey {
    fn bytes(&self) -> usize {
        match self {
            Self::Coord { language, .. } => 16 + language.len(),
            Self::Address(value) => value.len(),
        }
    }
}
#[derive(Clone)]
pub(super) struct Entry {
    pub geo: GeoClient,
    pub updated_unix_ms: u64,
}
pub(super) struct MemoryCache(WeightedCache<LookupKey, Entry>);
impl MemoryCache {
    pub fn new(bytes: usize) -> Result<Self, GeocodeError> {
        let budget = ByteBudget::new(bytes).map_err(|_| GeocodeError::InvalidConfiguration)?;
        Ok(Self(
            WeightedCache::new(budget, 1, 4096).map_err(|_| GeocodeError::InvalidConfiguration)?,
        ))
    }
    pub fn get(&self, key: &LookupKey) -> Option<GeoClient> {
        self.get_at(key, now_ms())
    }
    fn get_at(&self, key: &LookupKey, now: u64) -> Option<GeoClient> {
        let entry = self.0.get(key)?;
        if !fresh(entry.value.updated_unix_ms, now) {
            drop(entry);
            self.0.remove(key);
            return None;
        }
        Some(entry.value.geo.clone())
    }
    pub fn put(&self, key: LookupKey, geo: GeoClient) {
        let Ok(bytes) = serde_json::to_vec(&geo) else {
            return;
        };
        let weight = bytes.len().saturating_add(key.bytes()).saturating_add(512);
        let _ = self.0.insert(
            key,
            Entry {
                geo,
                updated_unix_ms: now_ms(),
            },
            weight,
        );
    }
    pub fn bytes(&self) -> usize {
        self.0.used_bytes()
    }
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}
pub fn fresh(updated: u64, now: u64) -> bool {
    updated != 0 && updated <= now && now - updated <= MONTH_MS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geocode::Location;

    #[test]
    fn review010_reverse_memory_ttl_boundary_expiry_and_future_timestamp() {
        let cache = MemoryCache::new(4096).unwrap();
        let key = LookupKey::Coord {
            lat: 37.566_f64.to_bits(),
            lon: 126.978_f64.to_bits(),
            language: "ko".into(),
        };
        let updated = MONTH_MS * 2;
        let geo = GeoClient {
            location: Some(Location {
                lat: 37.566,
                long: 126.978,
            }),
            ..GeoClient::default()
        };
        cache
            .0
            .insert(
                key.clone(),
                Entry {
                    geo: geo.clone(),
                    updated_unix_ms: updated,
                },
                1024,
            )
            .unwrap();
        assert!(fresh(updated, updated + MONTH_MS));
        assert!(cache.get_at(&key, updated + MONTH_MS).is_some());
        assert!(!fresh(updated, updated + MONTH_MS + 1));
        assert!(cache.get_at(&key, updated + MONTH_MS + 1).is_none());
        assert_eq!(cache.bytes(), 0);
        cache
            .0
            .insert(
                key.clone(),
                Entry {
                    geo,
                    updated_unix_ms: updated + 1,
                },
                1024,
            )
            .unwrap();
        assert!(!fresh(updated + 1, updated));
        assert!(cache.get_at(&key, updated).is_none());
        assert_eq!(cache.bytes(), 0);
        assert!(!fresh(0, updated));
    }
}
