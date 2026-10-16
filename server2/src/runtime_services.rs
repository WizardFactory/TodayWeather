//! Shared production construction. Workers are prepared here and started by the bound process.
use crate::{
    gateway::{
        self, Gateway, GatewayError,
        runtime::{Builtins, NativeFamilies},
    },
    storage::HttpS3Transport,
    world::BoundedS3,
};
use axum::{Router, extract::Request, http::StatusCode, response::IntoResponse};
use std::sync::Arc;

pub type ProcessS3 = BoundedS3<HttpS3Transport>;
pub type ProcessWarnings = crate::warnings::store::WarningStore<ProcessS3>;
pub type ProcessFeed = crate::push::deliver::warning_feed::WarningFeed<ProcessS3>;
#[derive(Clone)]
pub struct RuntimeServices {
    pub gateway: Option<Arc<Gateway>>,
    pub push: Option<Arc<crate::push::PushService>>,
    pub notices: Option<Arc<crate::notice::store::NoticeStore<ProcessS3>>>,
    pub warning_store: Option<Arc<ProcessWarnings>>,
    pub warning_feed: Option<Arc<ProcessFeed>>,
    pub warning_acquire: Option<Arc<dyn crate::domestic::kma::source::fetch::ForecastAcquire>>,
    pub native_fetch: crate::push::deliver::native_fetch::NativeFetch,
    pub s3: Option<ProcessS3>,
    pub delivery: Option<Arc<crate::push::deliver::supervisor::Workers<ProcessS3>>>,
}
impl RuntimeServices {
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Result<Self, GatewayError> {
        Self::from_vars_at(var, &Builtins::production())
    }
    pub fn from_vars_at(
        var: &dyn Fn(&str) -> Option<String>,
        builtins: &Builtins,
    ) -> Result<Self, GatewayError> {
        Self::from_vars_with_fcm(var, builtins, crate::push::deliver::Endpoints::production())
    }
    /// Code-injected endpoints for owned loopback peers; no environment override exists.
    pub fn from_vars_with_fcm(
        var: &dyn Fn(&str) -> Option<String>,
        builtins: &Builtins,
        endpoints: crate::push::deliver::Endpoints,
    ) -> Result<Self, GatewayError> {
        Self::from_vars_with_delivery(
            var,
            builtins,
            endpoints,
            Arc::new(crate::budget::SystemClock),
            None,
        )
    }
    /// Test dependency injection uses the same factory and native adapter, never settings/modes.
    pub fn from_vars_with_delivery(
        var: &dyn Fn(&str) -> Option<String>,
        builtins: &Builtins,
        endpoints: crate::push::deliver::Endpoints,
        clock: Arc<dyn crate::budget::Clock>,
        native: Option<crate::push::deliver::native_fetch::NativeFetch>,
    ) -> Result<Self, GatewayError> {
        let base = var("SERVER2_GATEWAY_LEGACY_URL");
        let families = NativeFamilies::from_vars(var)?;
        let s3 = if families.any() {
            Some(gateway::runtime::shared_s3(var, builtins)?)
        } else {
            None
        };
        let warning_store = if families.kma_source() || families.push {
            Some(Arc::new(
                ProcessWarnings::new(
                    s3.clone().ok_or(GatewayError::InvalidConfiguration)?,
                    crate::storage::CatalogLimits::default(),
                    crate::warnings::store::StoreConfig::default(),
                )
                .map_err(|_| GatewayError::InvalidConfiguration)?,
            ))
        } else {
            None
        };
        let warning_feed = warning_store.as_ref().map(|_| {
            Arc::new(ProcessFeed::new(
                Arc::new(s3.clone().expect("warning storage constructed")),
                Arc::new(crate::budget::SystemClock),
            ))
        });
        let built = gateway::runtime::build_shared(
            var,
            builtins,
            families,
            base,
            s3.clone(),
            warning_store.clone(),
            warning_feed
                .clone()
                .map(|f| f as Arc<dyn crate::warnings::collector::PersistedWarningFeed>),
        )?;
        // Construct all dependencies before spawning the registration writer. No worker run().
        let notices = if families.notice {
            Some(Arc::new(crate::notice::store::NoticeStore::new(
                s3.clone().ok_or(GatewayError::InvalidConfiguration)?,
            )))
        } else {
            None
        };
        let push = if families.push {
            Some(crate::push::PushService::start(
                Arc::new(s3.clone().ok_or(GatewayError::InvalidConfiguration)?),
                Arc::new(crate::budget::SystemClock),
                Box::new(crate::push::ObjectIds::new()),
                crate::push::PushConfig::default(),
            ))
        } else {
            None
        };
        let native_fetch = native
            .unwrap_or_else(|| crate::push::deliver::native_fetch::NativeFetch::new(built.native));
        let delivery = if let Some(push) = &push {
            use crate::push::deliver::{self, native_fetch::NativeFetch, supervisor::Workers};
            let transport = Arc::new(s3.clone().ok_or(GatewayError::InvalidConfiguration)?);
            let fetch = Arc::new(native_fetch.clone());
            let fcm = Arc::new(
                deliver::Fcm::from_vars(var, endpoints)
                    .map_err(|_| GatewayError::InvalidConfiguration)?,
            );
            let diagnostics: Arc<dyn deliver::Diagnostics> = Arc::new(deliver::StderrDiagnostics);
            let servers = NativeFetch::servers();
            Some(Arc::new(Workers {
                alarm: Arc::new(deliver::AlarmWorker::new(
                    push.clone(),
                    transport.clone(),
                    fetch.clone(),
                    fcm.clone(),
                    servers.clone(),
                    clock.clone(),
                    diagnostics.clone(),
                )),
                alerts: Arc::new(deliver::alerts::AlertWorker::new(
                    push.clone(),
                    transport.clone(),
                    fetch.clone(),
                    fcm.clone(),
                    servers.clone(),
                    clock.clone(),
                    diagnostics.clone(),
                )),
                warnings: Arc::new(deliver::warnings::WarningWorker::new(
                    push.clone(),
                    transport,
                    warning_feed
                        .clone()
                        .ok_or(GatewayError::InvalidConfiguration)?,
                    warning_store
                        .clone()
                        .ok_or(GatewayError::InvalidConfiguration)?,
                    Arc::new(deliver::warnings::ApiLocations::new(fetch, servers)),
                    fcm.clone(),
                    clock.clone(),
                    diagnostics.clone(),
                )),
                fcm,
                clock,
                diagnostics,
            }))
        } else {
            None
        };
        Ok(Self {
            delivery,
            warning_acquire: built.warning_acquire,
            gateway: built.gateway,
            push,
            notices,
            warning_store,
            warning_feed,
            native_fetch,
            s3,
        })
    }
    pub fn public_router(self, state: Arc<crate::SharedState>) -> Router {
        if self.gateway.is_none() && self.push.is_none() && self.notices.is_none() {
            return crate::public_router(state);
        }
        let notices = self.notices.clone();
        let services = self.clone();
        let mut routes = Router::new().fallback(move |request: Request| {
            let services = services.clone();
            async move {
                if let Some(push) = &services.push
                    && crate::push::PushService::matches(request.uri().path())
                {
                    return push.handle(request).await.expect("claimed push mount");
                }
                match &services.gateway {
                    Some(gateway) => gateway.handle(request).await,
                    None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
                }
            }
        });
        if let Some(notices) = notices {
            routes = routes.merge(
                crate::notice::api::router(notices).layer(axum::middleware::from_fn(crate::cors)),
            );
        }
        crate::public_router_with_routes(state, routes)
    }
}
