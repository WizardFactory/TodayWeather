//! Typed worker fetches over shared native handles; the logical origin is never contacted.
use super::weather::{Fetch, Servers};
use crate::gateway::{
    BoxFuture, Family, GatewayError, OrderedJson, Version, backend::backend_path, input,
    runtime::NativeHandles,
};
use std::{sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::Instant};

pub const INTERNAL_ORIGIN: &str = "http://server2.internal";
/// One native acquisition wait; caller delivery deadlines may be shorter.
pub const DEADLINE: Duration = Duration::from_secs(3);
#[derive(Clone)]
pub struct NativeFetch {
    handles: NativeHandles,
    slots: Arc<Semaphore>,
}
impl NativeFetch {
    pub fn new(handles: NativeHandles) -> Self {
        Self {
            handles,
            slots: Arc::new(Semaphore::new(40)),
        }
    }
    pub fn servers() -> Servers {
        Servers {
            service: INTERNAL_ORIGIN.into(),
            api: INTERNAL_ORIGIN.into(),
        }
    }
    async fn dispatch(
        &self,
        target: &str,
        language: Option<String>,
        deadline: Instant,
    ) -> Result<OrderedJson, GatewayError> {
        // Parse the original target, not a URL-normalized path (which could erase traversal).
        let target = target
            .strip_prefix(INTERNAL_ORIGIN)
            .ok_or(GatewayError::BadRequest)?;
        if !target.starts_with('/') || target.contains('#') || target.contains('\\') {
            return Err(GatewayError::BadRequest);
        }
        let uri: axum::http::Uri = target.parse().map_err(|_| GatewayError::BadRequest)?;
        if uri.scheme().is_some() || uri.authority().is_some() {
            return Err(GatewayError::BadRequest);
        }
        let path = uri.path();
        for part in path.split('/') {
            let decoded = input::decode(part, false)?;
            if decoded == "." || decoded == ".." || decoded.contains(['/', '\\']) {
                return Err(GatewayError::BadRequest);
            }
        }
        // Weather's direct routers consume the whole language preference list (i18n).
        // Geocode alone uses the original GeoController header normalization.
        let geo_lang = input::language(language.as_deref());
        let lang = language.unwrap_or_default();
        let query = input::build_query(target);
        if let Some(raw) = path.strip_prefix("/v000902/dsf/coord/") {
            input::parse_loc(raw)?;
            let handler = self
                .handles
                .dsf
                .as_ref()
                .ok_or(GatewayError::InvalidConfiguration)?;
            return handler
                .fetch(format!("{path}{query}"), lang, deadline)
                .await;
        }
        if path.starts_with("/v000902/kma/addr/") {
            let target = format!("{path}{query}");
            crate::domestic::kma::backend::parse_path(&target, &lang)
                .map_err(|_| GatewayError::BadRequest)?;
            let handler = self
                .handles
                .kma
                .as_ref()
                .ok_or(GatewayError::InvalidConfiguration)?;
            return handler.fetch(target, lang, deadline).await;
        }
        if let Some(raw) = path.strip_prefix("/v000902/kma/coord/") {
            let loc = input::parse_loc(raw)?;
            let geo = self
                .handles
                .geocoder
                .as_ref()
                .ok_or(GatewayError::InvalidConfiguration)?
                .coord(loc, geo_lang.clone())
                .await?;
            let (family, path) = backend_path(Version::V000902, &geo)?;
            if family != Family::Kma {
                return Err(GatewayError::Provider);
            }
            return self
                .handles
                .kma
                .as_ref()
                .ok_or(GatewayError::InvalidConfiguration)?
                .fetch(format!("{path}{query}"), lang, deadline)
                .await;
        }
        if path.starts_with("/geocode/v000903/") && uri.query().is_none() {
            let geo = self
                .handles
                .geocoder
                .as_ref()
                .ok_or(GatewayError::InvalidConfiguration)?;
            return match input::route(path)? {
                input::Route::Coord(loc) => {
                    OrderedJson::from_serde(&geo.coord(loc, geo_lang).await?)
                }
                input::Route::Address(addr) => {
                    OrderedJson::from_serde(&geo.addr(addr, geo_lang).await?)
                }
                _ => Err(GatewayError::NotFound),
            };
        }
        Err(GatewayError::NotFound)
    }
}
impl Fetch for NativeFetch {
    fn get(
        &self,
        url: String,
        lang: Option<String>,
    ) -> BoxFuture<'_, Result<(u16, Vec<u8>), String>> {
        Box::pin(async move {
            let _permit = self
                .slots
                .try_acquire()
                .map_err(|_| "native capacity unavailable".to_owned())?;
            let deadline = Instant::now() + DEADLINE;
            let value = tokio::time::timeout_at(deadline, self.dispatch(&url, lang, deadline))
                .await
                .map_err(|_| "native deadline".to_owned())?
                .map_err(|_| "native request failed".to_owned())?;
            Ok((200, value.to_bytes()))
        })
    }
}
