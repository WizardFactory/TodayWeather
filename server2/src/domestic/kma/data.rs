//! `getAllDataFromDb` and the legacy store readers of both DB data versions
//! (`kma.town.*.controller.js` `get*FromDB` for 2.0, `_getTownDataFromDB`/`_getMidDataFromDB`
//! for 1.0).
use super::chain::{Cx, Flow};
use super::js::{Arr, V, add, from_store, obj, to_str};
use super::{DbVersion, MidModel, TownModel, policy, precip, time};

pub const CUR_STRING: [&str; 10] = [
    "t1h", "rn1", "sky", "uuu", "vvv", "reh", "pty", "lgt", "vec", "wsd",
];
pub const SHORT_STRING: [&str; 14] = [
    "pop", "pty", "r06", "reh", "s06", "sky", "t3h", "tmn", "tmx", "uuu", "vvv", "wav", "vec",
    "wsd",
];
pub const SHORTEST_STRING: [&str; 11] = [
    "pty", "rn1", "sky", "lgt", "t1h", "uuu", "vvv", "reh", "vec", "wsd", "pop",
];
pub const RSS_STRING: [&str; 19] = [
    "ftm", "date", "temp", "tmx", "tmn", "sky", "pty", "wfKor", "wfEn", "pop", "r12", "s12", "ws",
    "wd", "wdKor", "wdEn", "reh", "r06", "s06",
];
const COMMON_STRING: [&str; 2] = ["date", "time"];

fn project(src: &V, fields: &[&str], into: &V) {
    for f in fields {
        into.set(f, src.get(f));
    }
}
fn new_row() -> V {
    V::Obj(super::js::Ob::new())
}

/// The cached `req[model]` or a fresh read of a town collection.
pub fn read_town(cx: &Cx, model: TownModel, coord: &V, use_cache: bool) -> Result<V, ()> {
    if use_cache {
        let cached = cx.r(model.req_name());
        if !cached.nullish() {
            return Ok(cached);
        }
    }
    let docs = cx
        .store
        .town_model(
            model,
            &super::to_store(&coord.get("mx")),
            &super::to_store(&coord.get("my")),
        )
        .map_err(|_| ())?;
    let docs = from_store(&docs);
    let list = docs.a().clone();
    if list.is_empty() {
        return Err(());
    }
    match cx.store.db_version() {
        DbVersion::V2 => Ok(read_town_v2(model, &list)),
        DbVersion::V1 => read_town_v1(&list.at(0)),
    }
}
fn read_town_v2(model: TownModel, docs: &Arr) -> V {
    let items = docs.items();
    let pub_date = time::korea_time_string(&items[items.len() - 1].get("pubDate"));
    let ret = Arr::new();
    let daily = Arr::new();
    for item in &items {
        let row = new_row();
        match model {
            TownModel::Short => {
                let data = item.get("shortData");
                daily.push(policy::short_daily_snapshot(&data, &item.get("pubDate")));
                project(&data, &COMMON_STRING, &row);
                project(&data, &SHORT_STRING, &row);
                precip::copy_text(&data, &row, &["r06", "s06"]);
            }
            TownModel::Current => {
                let data = item.get("currentData");
                project(&data, &COMMON_STRING, &row);
                project(&data, &CUR_STRING, &row);
            }
            TownModel::Shortest => {
                let data = item.get("shortestData");
                project(&data, &COMMON_STRING, &row);
                project(&data, &SHORTEST_STRING, &row);
                precip::read_shortest(&row, &data);
                row.set("pubDate", time::korea_time_string(&item.get("pubDate")));
            }
            TownModel::ShortRss => {
                let data = item.get("shortData");
                project(&data, &RSS_STRING, &row);
            }
        }
        ret.push(row);
    }
    let info = obj(vec![("pubDate", V::from(pub_date)), ("ret", V::Arr(ret))]);
    if model == TownModel::Short {
        info.set("dailyRows", V::Arr(daily));
    }
    V::Obj(info)
}
/// `_getTownDataFromDB` result conversion of `result[0]`.
fn read_town_v1(doc: &V) -> Result<V, ()> {
    let ret = Arr::new();
    let short = doc.get("shortData");
    if short.truthy() {
        if short.get("0").get("ftm").truthy() {
            for item in short.a().items() {
                let row = new_row();
                project(&item, &RSS_STRING, &row);
                ret.push(row);
            }
        } else {
            for item in short.a().items() {
                let row = new_row();
                project(&item, &COMMON_STRING, &row);
                project(&item, &SHORT_STRING, &row);
                precip::copy_text(&item, &row, &["r06", "s06"]);
                ret.push(row);
            }
        }
    } else if doc.get("currentData").truthy() {
        for item in doc.get("currentData").a().items() {
            let row = new_row();
            project(&item, &COMMON_STRING, &row);
            project(&item, &CUR_STRING, &row);
            ret.push(row);
        }
    } else if doc.get("shortestData").truthy() {
        for item in doc.get("shortestData").a().items() {
            let row = new_row();
            project(&item, &COMMON_STRING, &row);
            project(&item, &SHORTEST_STRING, &row);
            precip::read_shortest(&row, &item);
            ret.push(row);
        }
    } else {
        return Err(());
    }
    let source = doc.get("dailySource");
    let daily = Arr::new();
    if source.truthy() && source.get("rows").as_arr().is_some() {
        for row in source.get("rows").a().items() {
            daily.push(policy::short_daily_snapshot(&row, &source.get("pubDate")));
        }
    }
    Ok(V::Obj(obj(vec![
        ("pubDate", doc.get("pubDate")),
        ("ret", V::Arr(ret)),
        ("dailyRows", V::Arr(daily)),
    ])))
}

/// The cached `req[model]` (when `use_cache`) or a fresh read of a medium-range collection.
pub fn read_mid(cx: &Cx, model: MidModel, indicator: &V, use_cache: bool) -> Result<V, ()> {
    if use_cache {
        let cached = cx.r(model.req_name());
        if !cached.nullish() {
            return Ok(cached);
        }
    }
    let docs = cx
        .store
        .mid_model(model, &super::to_store(indicator))
        .map_err(|_| ())?;
    let docs = from_store(&docs);
    let list = docs.a().clone();
    if list.is_empty() {
        return Err(());
    }
    let doc = list.at(0);
    let v1 = cx.store.db_version() == DbVersion::V1;
    let data = doc.get("data");
    let probe = if v1 { data.get("0") } else { data.clone() };
    let private: Vec<&str> = if probe.has("wfsv") {
        vec!["cnt", "wfsv"]
    } else if probe.has("wh10B") {
        // Sea forecasts are never requested by the v000903 chain.
        return Err(());
    } else if policy::TEMP_FIELDS.iter().any(|k| !probe.get(k).is_undef()) {
        policy::TEMP_FIELDS.to_vec()
    } else if policy::LAND_FIELDS.iter().any(|k| !probe.get(k).is_undef()) {
        policy::LAND_FIELDS.to_vec()
    } else {
        return Err(());
    };
    let ret = Arr::new();
    if v1 {
        for item in data.a().items() {
            let row = obj(vec![
                ("regId", doc.get("regId")),
                ("pubDate", add(&item.get("date"), &item.get("time"))),
            ]);
            let row = V::Obj(row);
            project(&item, &COMMON_STRING, &row);
            project(&item, &private, &row);
            ret.push(row);
        }
    } else {
        let row = V::Obj(obj(vec![
            ("regId", doc.get("regId")),
            ("pubDate", doc.get("pubDate")),
        ]));
        project(&data, &COMMON_STRING, &row);
        project(&data, &private, &row);
        ret.push(row);
    }
    Ok(V::Obj(obj(vec![
        ("pubDate", doc.get("pubDate")),
        ("ret", V::Arr(ret)),
    ])))
}

/// `manager.getRegIdByTown` → `{pointNumber, cityCode}`.
pub fn region_code(cx: &Cx) -> Result<V, ()> {
    let region = to_str(&cx.param("region"));
    let city = to_str(&cx.param("city"));
    cx.store
        .region_code(&region, &city)
        .map(|v| from_store(&v))
        .map_err(|_| ())
}
/// `_findForecastZoneByName(region, city)`: the single regId, or Err.
pub fn forecast_zone(cx: &Cx) -> Result<V, ()> {
    let region = to_str(&cx.param("region"));
    let city = to_str(&cx.param("city"));
    let list = cx.store.forecast_zone(&region, &city).map_err(|_| ())?;
    let list = from_store(&list);
    let a = list.a();
    if a.len() == 1 {
        Ok(a.at(0).get("regId"))
    } else {
        Err(())
    }
}
/// The land area code derived from the city code.
pub fn land_area_code(city_code: &V) -> String {
    let code = super::js::sv(city_code);
    let head3 = super::js::slice(&code, 0, Some(3));
    if head3 == "11B" {
        "11B00000".into()
    } else if head3 == "21F" {
        "11F10000".into()
    } else {
        format!("{}0000", super::js::slice(&code, 0, Some(4)))
    }
}

/// `getAllDataFromDb`.
pub fn get_all_data_from_db(cx: &mut Cx) -> Flow {
    let params = cx.r("params");
    if params.get("city").is_undef() {
        params.set("city", "");
    }
    if params.get("town").is_undef() {
        params.set("town", "");
    }
    // `log.info('## + ' + decodeURI(req.originalUrl) ...)` runs before the `try`: a malformed
    // escape or invalid UTF-8 anywhere in the URL throws URIError (Express answers 500).
    if !super::js::decode_uri_ok(&to_str(&cx.r("originalUrl"))) {
        super::js::throw("URIError: URI malformed");
    }
    let r = super::js::catch(|| -> Option<()> {
        let (coord, g_coord) = cx.coord().ok()?;
        let lat = super::js::to_number(&g_coord.get("lat"));
        let lon = super::js::to_number(&g_coord.get("lon"));
        if !((32.6942..=39.3769).contains(&lat) && (123.9523..=131.88).contains(&lon)) {
            // `res.redirect(self._getUrlWithCoord(lat, lon, req.query))`: Express answers 302
            // (the gateway treats any non-200 backend reply as a dependency failure).
            super::js::reply(
                302,
                format!(
                    "Found. Redirecting to {}",
                    super::js::redirect_url(
                        &g_coord.get("lat"),
                        &g_coord.get("lon"),
                        &cx.r("query")
                    )
                ),
            );
        }
        cx.set("coord", coord.clone());
        if g_coord.truthy() {
            cx.set("gCoord", g_coord);
        }
        for model in [
            TownModel::Short,
            TownModel::Current,
            TownModel::Shortest,
            TownModel::ShortRss,
        ] {
            if let Ok(data) = read_town(cx, model, &coord, false) {
                cx.set(model.req_name(), data);
            }
        }
        let code = region_code(cx).ok()?;
        // async.mapSeries stops at the first error.
        let forecast = read_mid(cx, MidModel::Forecast, &code.get("pointNumber"), false).ok()?;
        cx.set(MidModel::Forecast.req_name(), forecast);
        let land = read_mid(
            cx,
            MidModel::Land,
            &V::from(land_area_code(&code.get("cityCode"))),
            false,
        )
        .ok()?;
        cx.set(MidModel::Land.req_name(), land);
        let mut parm = code.get("cityCode");
        if let Ok(reg_id) = forecast_zone(cx) {
            cx.set("regId", reg_id.clone());
            parm = reg_id;
        }
        let temp = read_mid(cx, MidModel::Temp, &parm, false).ok()?;
        cx.set(MidModel::Temp.req_name(), temp);
        Some(())
    });
    let _ = r;
    Flow::Next
}
