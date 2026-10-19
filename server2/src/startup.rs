//! Completeness policy for the production executable, separate from partial test factories.
use crate::gateway::{GatewayError, Version, runtime::NativeFamilies};

/// Reject an unserved production inventory before constructing services or binding listeners.
/// Explicit development coexistence retains the existing origin/provider validation in the
/// runtime factory. This checks selection only; it performs no credential or readiness probe.
pub fn validate_native_coverage(var: &dyn Fn(&str) -> Option<String>) -> Result<(), GatewayError> {
    let families = NativeFamilies::from_vars(var)?;
    if var("SERVER2_GATEWAY_LEGACY_URL").is_some_and(|v| !v.trim().is_empty()) {
        return Ok(());
    }
    if ![
        families.geocode,
        families.dsf,
        families.kma,
        families.kma_v000901,
        families.kma_v000902,
        families.town,
        families.push,
        families.notice,
    ]
    .into_iter()
    .all(|selected| selected)
    {
        return Err(GatewayError::InvalidConfiguration);
    }
    let versions = crate::world::runtime::selected_versions(var)?;
    if [Version::V000901, Version::V000902, Version::V000903]
        .iter()
        .all(|version| versions.contains(version))
    {
        Ok(())
    } else {
        Err(GatewayError::InvalidConfiguration)
    }
}
