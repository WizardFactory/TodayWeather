//! The legacy registration handlers, step for step: `routes/v000705/routePushNotification.js`
//! (POST/PUT/DELETE, mounted at `/v000705/push` and `/v000902/push`), `routes/v000902/
//! route.push.update.list.js` (POST `/v000902/push-list`), `controllers/controllerPush.js`
//! (`updatePushInfo`, `makeRemoveSelector`), `controllers/alert.push.controller.js`
//! (`updateAlertPush`), `lib/pushStore/mongo.js` and `lib/unitConverter.js` (`initUnits`).
use super::js::{self, Thrown, has_own, prop, stringify};
use super::mongoose::{self, cast_query, cast_set};
use super::store::{Coll, Cond, Record, Txn, oid_hex};
use crate::world::js::{Obj, Val};

/// The error message a store call reports when the S3 write of the request's changes fails.
pub const STORAGE_FAILURE: &str = "push state storage unavailable";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// `router.post('/')` of routePushNotification.js.
    Post,
    /// `router.put('/')`.
    Put,
    /// `router.delete('/')`.
    Delete,
    /// `router.post('/')` of route.push.update.list.js.
    List,
}

/// A parsed request body. `form` marks a `querystring.parse` object (null prototype).
#[derive(Clone, Debug)]
pub struct Body {
    pub value: Val,
    pub form: bool,
}

/// What the legacy handler sends.
#[derive(Clone, Debug, PartialEq)]
pub enum Reply {
    /// `res.send(object)`: status 200 JSON.
    Json(Vec<u8>),
    /// `res.status(code).send(string)`.
    Text(u16, String),
    /// An exception that reached Express's final handler (status text body).
    Final(u16),
}

/// A store call failure: the error and the result value the legacy callback still receives
/// (`Model.update` passes `{ok: 0, n: 0, nModified: 0}` with a cast error; `Undef` otherwise).
#[derive(Clone, Debug, PartialEq)]
pub struct StoreError {
    pub message: String,
    pub result: Val,
}
impl From<String> for StoreError {
    fn from(message: String) -> Self {
        Self {
            message,
            result: Val::Undef,
        }
    }
}
impl From<super::ejson::DecodeError> for StoreError {
    fn from(_: super::ejson::DecodeError) -> Self {
        STORAGE_FAILURE.to_owned().into()
    }
}
pub(crate) type StoreResult = Result<Val, StoreError>;

/// Store calls the handlers make; implemented over a transaction and, for the response after a
/// failed S3 write, by a backend that casts and then fails every call.
pub trait Backend {
    /// The request clock (`new Date()` in the handlers), in ms.
    fn now(&self) -> f64;
    fn upsert_alarm(&mut self, info: &Obj) -> StoreResult;
    fn upsert_alert(&mut self, info: &Obj) -> StoreResult;
    fn update_token(&mut self, c: Coll, kind: &str, new: &Val, old: &Val) -> StoreResult;
    fn remove(&mut self, c: Coll, filter: &[(String, Val)]) -> StoreResult;
}

/// `accept-language` handling of both POST handlers.
pub fn language(header: Option<&str>) -> String {
    let Some(header) = header.filter(|h| !h.is_empty()) else {
        return "en".into();
    };
    let first = header.split(',').next().unwrap_or_default();
    if first.is_empty() {
        return "en".into();
    }
    if ["ko", "en", "ja", "de"].iter().any(|t| first.contains(t)) {
        let units: Vec<u16> = first.encode_utf16().take(2).collect();
        return String::from_utf16_lossy(&units);
    }
    first.to_owned()
}

pub fn handle(route: Route, body: &Body, lang_header: Option<&str>, be: &mut dyn Backend) -> Reply {
    match route {
        Route::Post => post(body, lang_header, be),
        Route::Put => put(body, be),
        Route::Delete => delete(body, be),
        Route::List => list(body, lang_header, be),
    }
}

/// `!x.hasOwnProperty(k) || x[k].length === 0`.
fn missing_or_empty(expr: &str, v: &Val, key: &str, form: bool) -> Result<bool, Thrown> {
    if !has_own(expr, v, key, form)? {
        return Ok(true);
    }
    Ok(js::is_zero(&prop(&prop(v, key)?, "length")?))
}

fn object(v: &Val) -> Obj {
    match v {
        Val::Obj(o) => o.clone(),
        _ => Obj::new(),
    }
}

fn post(body: &Body, lang_header: Option<&str>, be: &mut dyn Backend) -> Reply {
    let lang = language(lang_header);
    let checked = (|| -> Result<Obj, Thrown> {
        let info = &body.value;
        if missing_or_empty("pushInfo", info, "fcmToken", body.form)?
            && missing_or_empty("pushInfo", info, "registrationId", body.form)?
        {
            return Err("invalid push info registrationId and fcmToken".into());
        }
        if !has_own("pushInfo", info, "location", body.form)?
            && !has_own("pushInfo", info, "town", body.form)?
        {
            return Err("invalid push info location or town is empty".into());
        }
        let mut info = object(info);
        info.set("lang", lang.as_str());
        let location = info.get("location").clone();
        if location.truthy()
            && has_own("pushInfo.location", &location, "long", false)?
            && has_own("pushInfo.location", &location, "lat", false)?
        {
            let geo = vec![prop(&location, "long")?, prop(&location, "lat")?];
            info.set("geo", Val::Arr(geo));
        }
        if info.get("category").is_nullish() {
            info.set("category", "alarm");
        }
        if info.get("package").is_nullish() {
            info.set("package", "todayWeather");
        }
        Ok(info)
    })();
    let mut info = match checked {
        Ok(info) => info,
        Err(message) => return Reply::Text(403, message),
    };
    match update_push_info(&mut info, be) {
        Err(_) => Reply::Final(500),
        Ok(Err(e)) => Reply::Text(500, e.message),
        Ok(Ok(result)) => Reply::Json(result.to_json()),
    }
}

/// `ControllerPush.prototype.updatePushInfo`: Err is an exception thrown to Express.
/// `ControllerPush.prototype.updatePushInfo` (also the alarm worker's `updatedAt` stamp).
pub(crate) fn update_push_info(
    info: &mut Obj,
    be: &mut dyn Backend,
) -> Result<StoreResult, Thrown> {
    let now = Val::Date(be.now());
    info.set("updatedAt", now);
    info.set("updatedBy", "user");
    if let Some(message) = location_error(info, "pushInfo")? {
        return Ok(Err(message.into()));
    }
    if info.get("id").is_nullish() {
        let city = info.get("cityIndex").clone();
        info.set("id", city);
    }
    Ok(be.upsert_alarm(info))
}

/// `AlertPushController.prototype.updateAlertPush`.
fn update_alert_push(info: &mut Obj, be: &mut dyn Backend) -> Result<StoreResult, Thrown> {
    if let Some(message) = location_error(info, "alertPush")? {
        return Ok(Err(message.into()));
    }
    info.set("updatedAt", Val::Date(be.now()));
    info.set("updatedBy", "user");
    let reverse = js::greater(info.get("startTime"), info.get("endTime"));
    info.set("reverseTime", reverse);
    Ok(be.upsert_alert(info))
}

/// The shared geo/town checks of both controllers.
fn location_error(info: &Obj, name: &str) -> Result<Option<String>, Thrown> {
    let value = Val::Obj(info.clone());
    if has_own(name, &value, "geo", false)? {
        let geo = info.get("geo");
        let (a, b) = (prop(geo, "0")?, prop(geo, "1")?);
        if !js::is_number(&a) || !js::is_number(&b) {
            return Ok(Some(format!(
                "invalid geo info {name}:{}",
                stringify(&value)
            )));
        }
    } else if has_own(name, &value, "town", false)? {
        let town = info.get("town");
        if !has_own(&format!("{name}.town"), town, "first", false)?
            || js::less(&prop(&prop(town, "first")?, "length")?, &Val::Num(1.))
        {
            return Ok(Some(format!(
                "invalid town info {name}:{}",
                stringify(&value)
            )));
        }
    } else {
        return Ok(Some(format!("invalid info {name}:{}", stringify(&value))));
    }
    Ok(None)
}

fn put(body: &Body, be: &mut dyn Backend) -> Reply {
    let v = &body.value;
    let field = |k: &str| v.get(k).clone();
    let (kind, new, old) = if field("newToken").truthy() && field("oldToken").truthy() {
        ("fcmToken", field("newToken"), field("oldToken"))
    } else if field("newRegId").truthy() && field("oldRegId").truthy() {
        ("registrationId", field("newRegId"), field("oldRegId"))
    } else {
        return Reply::Text(403, "invalid body".into());
    };
    let results = [Coll::Alarm, Coll::Alert].map(|c| be.update_token(c, kind, &new, &old));
    respond_all(results.into_iter().collect(), 500)
}

fn respond_all(results: Vec<StoreResult>, status: u16) -> Reply {
    let mut out = Vec::new();
    for r in results {
        match r {
            Ok(v) => out.push(v),
            Err(e) => return Reply::Text(status, e.message),
        }
    }
    Reply::Json(Val::Arr(out).to_json())
}

fn delete(body: &Body, be: &mut dyn Backend) -> Reply {
    let info = &body.value;
    let checked = (|| -> Result<(), Thrown> {
        if missing_or_empty("pushInfo", info, "fcmToken", body.form)?
            && missing_or_empty("pushInfo", info, "registrationId", body.form)?
        {
            return Err("invalid push info registrationId and fcmToken".into());
        }
        for key in ["cityIndex", "id", "category"] {
            has_own("pushInfo", info, key, body.form)?;
        }
        Ok(())
    })();
    if let Err(message) = checked {
        return Reply::Text(403, message);
    }
    let category = info.get("category");
    let mut tasks = Vec::new();
    if category.is_nullish() || *category == Val::Str("alert".into()) {
        tasks.push(Coll::Alert);
    }
    if category.is_nullish() || *category == Val::Str("alarm".into()) {
        tasks.push(Coll::Alarm);
    }
    if tasks.is_empty() {
        return Reply::Text(403, "invalid push info category".into());
    }
    let results = tasks
        .into_iter()
        .map(|c| match remove_selector(info) {
            None => Err(StoreError::from(format!(
                "unknown fcm token or registrationId pushInfo:{}",
                stringify(info)
            ))),
            Some(filter) => be.remove(c, &filter),
        })
        .collect();
    respond_all(results, 501)
}

/// `makeRemoveSelector` + `tokenQuery`.
pub(crate) fn remove_selector(info: &Val) -> Option<Vec<(String, Val)>> {
    let mut filter = Vec::new();
    if info.get("fcmToken").truthy() {
        filter.push(("fcmToken".to_owned(), info.get("fcmToken").clone()));
    } else if info.get("registrationId").truthy() {
        filter.push((
            "registrationId".to_owned(),
            info.get("registrationId").clone(),
        ));
    } else {
        return None;
    }
    if !info.get("cityIndex").is_nullish() {
        filter.push(("cityIndex".to_owned(), info.get("cityIndex").clone()));
        if !info.get("id").is_nullish() {
            filter.push(("id".to_owned(), info.get("id").clone()));
        }
    }
    Some(filter)
}

fn list(body: &Body, lang_header: Option<&str>, be: &mut dyn Backend) -> Reply {
    let lang = language(lang_header);
    let items = match &body.value {
        Val::Arr(items) if !body.form => items.clone(),
        _ => return Reply::Text(403, "pushList.forEach is not a function".into()),
    };
    let checked = (|| -> Result<(), Thrown> {
        for obj in &items {
            if missing_or_empty("obj", obj, "type", false)? {
                return Err("invalid push info type".into());
            }
            if missing_or_empty("obj", obj, "fcmToken", false)?
                && missing_or_empty("obj", obj, "registrationId", false)?
            {
                return Err("invalid push info registrationId and fcmToken".into());
            }
            if !has_own("obj", obj, "location", false)? && !has_own("obj", obj, "town", false)? {
                return Err("invalid push info location or town is empty".into());
            }
            let category = obj.get("category");
            if !category.is_undef()
                && *category != Val::Str("alarm".into())
                && *category != Val::Str("alert".into())
            {
                return Err("invalid push info category".into());
            }
        }
        Ok(())
    })();
    if let Err(message) = checked {
        return Reply::Text(403, message);
    }
    // updatePushInfoList: async.map starts every item in order; an error inside the per-item
    // `try` answers 500 at once while the remaining items are still stored; a store error is
    // logged and the item's result is `undefined` (JSON `null`).
    let mut results = Vec::with_capacity(items.len());
    let mut first_error: Option<String> = None;
    for item in &items {
        let mut info = object(item);
        let prepared = (|| -> Result<(), Thrown> {
            info.set("lang", lang.as_str());
            let location = info.get("location").clone();
            if location.truthy() && has_own("pushInfo.location", &location, "lat", false)? {
                let geo = vec![prop(&location, "long")?, prop(&location, "lat")?];
                info.set("geo", Val::Arr(geo));
            }
            if info.get("category").is_nullish() {
                info.set("category", "alarm");
            }
            if info.get("package").is_nullish() {
                info.set("package", "todayWeather");
            }
            let units = init_units(info.get("units"))?;
            info.set("units", units);
            Ok(())
        })();
        if let Err(message) = prepared {
            first_error.get_or_insert(message);
            results.push(Val::Undef);
            continue;
        }
        let outcome = if *info.get("category") == Val::Str("alarm".into()) {
            update_push_info(&mut info, be)
        } else {
            update_alert_push(&mut info, be)
        };
        match outcome {
            // An exception escapes `async.map` to Express; later items never start.
            Err(_) => {
                return match first_error {
                    Some(message) => Reply::Text(500, message),
                    None => Reply::Final(500),
                };
            }
            Ok(r) => results.push(r.unwrap_or_else(|e| e.result)),
        }
    }
    match first_error {
        Some(message) => Reply::Text(500, message),
        None => Reply::Json(Val::Arr(results).to_json()),
    }
}

/// `UnitConverter.initUnits` (strict mode).
pub(crate) fn init_units(units: &Val) -> Result<Val, Thrown> {
    const DEFAULTS: [(&str, &str); 7] = [
        ("temperatureUnit", "C"),
        ("windSpeedUnit", "m/s"),
        ("pressureUnit", "hPa"),
        ("distanceUnit", "km"),
        ("precipitationUnit", "mm"),
        ("airUnit", "airkorea"),
        ("airForecastSource", "airkorea"),
    ];
    let units = if units.truthy() {
        units.clone()
    } else {
        Val::Obj(Obj::new())
    };
    match units {
        Val::Obj(mut o) => {
            for (k, d) in DEFAULTS {
                if !o.get(k).truthy() {
                    o.set(k, d);
                }
            }
            Ok(Val::Obj(o))
        }
        // Properties added to an array are not part of its JSON or BSON form.
        Val::Arr(a) => Ok(Val::Arr(a)),
        other => Err(js::create_property_error(DEFAULTS[0].0, &other)),
    }
}

/// `keyQuery` of lib/pushStore/mongo.js.
fn key_filter(info: &Obj) -> Vec<(String, Val)> {
    let mut filter = vec![
        ("type".to_owned(), info.get("type").clone()),
        ("cityIndex".to_owned(), info.get("cityIndex").clone()),
        ("id".to_owned(), info.get("id").clone()),
    ];
    if info.get("registrationId").truthy() {
        filter.push(("registrationId".into(), info.get("registrationId").clone()));
    } else if info.get("fcmToken").truthy() {
        filter.push(("fcmToken".into(), info.get("fcmToken").clone()));
    }
    filter
}

fn write_result(n: usize, modified: usize, upserted: Option<String>) -> Val {
    let mut r = Obj::new();
    r.set("n", n as f64);
    if let Some(id) = upserted {
        let mut u = Obj::new();
        u.set("index", 0.);
        u.set("_id", id);
        r.set("upserted", Val::Arr(vec![Val::Obj(u)]));
    }
    r.set("nModified", modified as f64);
    r.set("ok", 1.);
    Val::Obj(r)
}
/// `Model.update`'s callback value when the update fails before reaching the server.
fn update_default() -> Val {
    let mut r = Obj::new();
    r.set("ok", 0.);
    r.set("n", 0.);
    r.set("nModified", 0.);
    Val::Obj(r)
}
fn remove_result(n: usize) -> Val {
    let mut r = Obj::new();
    r.set("n", n as f64);
    r.set("ok", 1.);
    Val::Obj(r)
}

/// The store over one request's transaction.
pub struct TxnBackend<'t, 'a> {
    pub txn: &'t mut Txn<'a>,
}
impl Backend for TxnBackend<'_, '_> {
    fn now(&self) -> f64 {
        self.txn.now_ms
    }
    fn upsert_alarm(&mut self, info: &Obj) -> StoreResult {
        let query =
            cast_query(Coll::Alarm, &key_filter(info)).map_err(|e| StoreError::from(e.message))?;
        let set = cast_set(Coll::Alarm, info, true).map_err(|e| StoreError::from(e.message))?;
        if let Some(conflict) = mongoose::set_conflict(&set) {
            return Err(conflict.into());
        }
        let found = self.txn.find(Coll::Alarm, &query)?;
        if let Some(n) = found.first() {
            let mut record = self
                .txn
                .get(Coll::Alarm, *n)?
                .ok_or(super::ejson::DecodeError("missing record"))?;
            let before = record.doc.clone();
            mongoose::apply_set(&mut record.doc, &set);
            if let Some(e) = mongoose::geo_index_error(&record.doc) {
                return Err(e.into());
            }
            let modified = !super::store::same_doc(&before, &record.doc);
            self.txn.put(Coll::Alarm, *n, record)?;
            return Ok(write_result(1, usize::from(modified), None));
        }
        // Upsert: _id, the query's equality fields, `$setOnInsert: {__v: 0}`, then `$set`.
        let oid = self.txn.new_oid();
        let mut doc = Obj::new();
        for (k, cond) in &query {
            if let Cond::Eq(v) = cond {
                doc.set(k, mongoose::stored(v));
            }
        }
        doc.set("__v", 0.);
        mongoose::apply_set(&mut doc, &set);
        if let Some(e) = mongoose::geo_index_error(&doc) {
            return Err(e.into());
        }
        self.txn.insert(Coll::Alarm, Record { oid, doc })?;
        Ok(write_result(1, 0, Some(oid_hex(&oid))))
    }
    fn upsert_alert(&mut self, info: &Obj) -> StoreResult {
        let query =
            cast_query(Coll::Alert, &key_filter(info)).map_err(|e| StoreError::from(e.message))?;
        let found = self.txn.find(Coll::Alert, &query)?;
        let Some(n) = found.first() else {
            let oid = self.txn.new_oid();
            let (doc, json) = mongoose::new_document(Coll::Alert, info, oid)
                .ok_or_else(|| StoreError::from("AlertPush validation failed".to_owned()))?;
            if let Some(e) = mongoose::geo_index_error(&doc) {
                return Err(e.into());
            }
            self.txn.insert(Coll::Alert, Record { oid, doc })?;
            return Ok(Val::Obj(json));
        };
        let set = cast_set(Coll::Alert, info, false)
            .map_err(|e| e.message)
            .and_then(|set| match mongoose::set_conflict(&set) {
                Some(conflict) => Err(conflict),
                None => Ok(set),
            })
            .map_err(|message| StoreError {
                message,
                result: update_default(),
            })?;
        let mut record = self
            .txn
            .get(Coll::Alert, *n)?
            .ok_or(super::ejson::DecodeError("missing record"))?;
        let before = record.doc.clone();
        mongoose::apply_set(&mut record.doc, &set);
        if let Some(message) = mongoose::geo_index_error(&record.doc) {
            return Err(StoreError {
                message,
                result: update_default(),
            });
        }
        let modified = !super::store::same_doc(&before, &record.doc);
        self.txn.put(Coll::Alert, *n, record)?;
        Ok(write_result(1, usize::from(modified), None))
    }
    fn update_token(&mut self, c: Coll, kind: &str, new: &Val, old: &Val) -> StoreResult {
        let query = cast_query(c, &[(kind.to_owned(), old.clone())])
            .map_err(|e| StoreError::from(e.message))?;
        let mut set_obj = Obj::new();
        set_obj.set(kind, new.clone());
        let set = cast_set(c, &set_obj, false).map_err(|e| StoreError::from(e.message))?;
        let found = self.txn.find(c, &query)?;
        let mut modified = 0;
        for n in &found {
            let mut record = self
                .txn
                .get(c, *n)?
                .ok_or(super::ejson::DecodeError("missing record"))?;
            let before = record.doc.clone();
            mongoose::apply_set(&mut record.doc, &set);
            if !super::store::same_doc(&before, &record.doc) {
                modified += 1;
            }
            self.txn.put(c, *n, record)?;
        }
        Ok(write_result(found.len(), modified, None))
    }
    fn remove(&mut self, c: Coll, filter: &[(String, Val)]) -> StoreResult {
        let query = cast_query(c, filter).map_err(|e| StoreError::from(e.message))?;
        let found = self.txn.find(c, &query)?;
        for n in &found {
            self.txn.remove(c, *n)?;
        }
        Ok(remove_result(found.len()))
    }
}

/// The store after a failed S3 write: casts as before (cast errors keep their messages), then
/// fails every call with [`STORAGE_FAILURE`].
pub struct FailedBackend {
    pub now: f64,
}
impl Backend for FailedBackend {
    fn now(&self) -> f64 {
        self.now
    }
    fn upsert_alarm(&mut self, info: &Obj) -> StoreResult {
        cast_query(Coll::Alarm, &key_filter(info)).map_err(|e| StoreError::from(e.message))?;
        cast_set(Coll::Alarm, info, true).map_err(|e| StoreError::from(e.message))?;
        Err(STORAGE_FAILURE.to_owned().into())
    }
    fn upsert_alert(&mut self, info: &Obj) -> StoreResult {
        cast_query(Coll::Alert, &key_filter(info)).map_err(|e| StoreError::from(e.message))?;
        Err(STORAGE_FAILURE.to_owned().into())
    }
    fn update_token(&mut self, c: Coll, kind: &str, new: &Val, old: &Val) -> StoreResult {
        cast_query(c, &[(kind.to_owned(), old.clone())])
            .map_err(|e| StoreError::from(e.message))?;
        let mut set_obj = Obj::new();
        set_obj.set(kind, new.clone());
        cast_set(c, &set_obj, false).map_err(|e| StoreError::from(e.message))?;
        Err(STORAGE_FAILURE.to_owned().into())
    }
    fn remove(&mut self, c: Coll, filter: &[(String, Val)]) -> StoreResult {
        cast_query(c, filter).map_err(|e| StoreError::from(e.message))?;
        Err(STORAGE_FAILURE.to_owned().into())
    }
}
