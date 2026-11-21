// CloudFront Function (cloudfront-js-2.0) for link.todayweather.ai.
// Serves .well-known verification files from S3; redirects recognized deep links
// straight to https://app.todayweather.ai/... (or the OS app store when
// fallback=store is requested on mobile).
function handler(event) {
  var request = event.request;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return {
      statusCode: 405,
      statusDescription: "Method Not Allowed",
      headers: { allow: { value: "GET, HEAD" } },
    };
  }

  var uri;
  try {
    uri = decodeURIComponent(request.uri);
  } catch (_) {
    return { statusCode: 400, statusDescription: "Bad Request" };
  }

  if (
    uri.indexOf("..") !== -1 ||
    uri.indexOf("\\") !== -1 ||
    uri.indexOf("\u0000") !== -1
  ) {
    return { statusCode: 400, statusDescription: "Bad Request" };
  }

  if (
    uri === "/.well-known/apple-app-site-association" ||
    uri === "/.well-known/assetlinks.json"
  ) {
    request.uri = uri;
    return request;
  }

  var PWA_ORIGIN = "https://app.todayweather.ai";
  var APP_STORE_URL = "https://apps.apple.com/app/id1041700694";
  var PLAY_STORE_URL =
    "https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather";
  var qs = request.querystring || {};
  var headers = request.headers || {};
  var uaHeader = headers["user-agent"];
  var ua = uaHeader && typeof uaHeader.value === "string" ? uaHeader.value : "";

  function getParam(key) {
    var entry = qs[key];
    if (!entry || typeof entry.value !== "string") return null;
    try {
      return decodeURIComponent(entry.value.replace(/\+/g, " "));
    } catch (_) {
      return entry.value;
    }
  }

  var storeFallback = getParam("fallback") === "store";
  var storeLocation = null;
  if (storeFallback) {
    if (/iPhone|iPad|iPod/i.test(ua)) {
      storeLocation = APP_STORE_URL;
    } else if (/Android/i.test(ua)) {
      storeLocation = PLAY_STORE_URL;
    } else {
      var storeHint = getParam("store");
      if (storeHint === "ios") storeLocation = APP_STORE_URL;
      else if (storeHint === "android") storeLocation = PLAY_STORE_URL;
    }
  }

  function redirect302(pwaLocation) {
    var resHeaders = {
      location: { value: storeLocation || pwaLocation },
      "cache-control": { value: "no-store" },
    };
    if (storeFallback) {
      resHeaders.vary = { value: "User-Agent" };
    }
    return {
      statusCode: 302,
      statusDescription: "Found",
      headers: resHeaders,
    };
  }

  var trimmed =
    uri.length > 1 && uri.charAt(uri.length - 1) === "/"
      ? uri.slice(0, -1)
      : uri;

  if (uri === "/" || trimmed === "/open") {
    return redirect302(PWA_ORIGIN + "/");
  }

  function normalizeView(raw) {
    if (raw === "daily" || raw === "air" || raw === "hourly") return raw;
    return "hourly";
  }

  function normalizePollutant(raw) {
    if (
      raw === "aqi" ||
      raw === "pm25" ||
      raw === "pm10" ||
      raw === "o3" ||
      raw === "no2" ||
      raw === "so2" ||
      raw === "co"
    ) {
      return raw;
    }
    return "aqi";
  }

  function parseCoord(raw, min, max) {
    if (raw === null || raw === "") return null;
    var s = raw.trim();
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n) || n < min || n > max) return null;
    var rounded = Math.round(n * 1000) / 1000;
    return rounded === 0 ? 0 : rounded;
  }

  function sanitizeName(raw) {
    if (raw === null) return null;
    var cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!cleaned) return null;
    // Truncate to at most 80 Unicode scalar values without splitting surrogate pairs.
    var out = "";
    var count = 0;
    for (var i = 0; i < cleaned.length && count < 80; i++) {
      var code = cleaned.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < cleaned.length) {
        var next = cleaned.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += cleaned.slice(i, i + 2);
          i++;
          count++;
          continue;
        }
      }
      out += cleaned.charAt(i);
      count++;
    }
    return out;
  }

  if (trimmed === "/nation/weather") {
    return redirect302(PWA_ORIGIN + "/nation/weather?from=link");
  }
  if (trimmed === "/nation/air") {
    return redirect302(PWA_ORIGIN + "/nation/air?from=link");
  }
  if (trimmed === "/warnings") {
    return redirect302(PWA_ORIGIN + "/warnings?from=link");
  }

  var SLUG_RE = /^[a-z0-9-]{1,64}$/;

  if (trimmed.indexOf("/place/") === 0) {
    var placeSlug = trimmed.slice(7);
    if (!SLUG_RE.test(placeSlug)) {
      return { statusCode: 404, statusDescription: "Not Found" };
    }
    var placeView = normalizeView(getParam("view"));
    if (placeView === "air") {
      var placePollutant = normalizePollutant(getParam("pollutant"));
      var placeAirQ =
        placePollutant !== "aqi"
          ? "pollutant=" + placePollutant + "&from=link"
          : "from=link";
      return redirect302(PWA_ORIGIN + "/air/" + placeSlug + "?" + placeAirQ);
    }
    return redirect302(
      PWA_ORIGIN + "/weather/" + placeSlug + "/" + placeView + "?from=link",
    );
  }

  if (trimmed.indexOf("/air/") === 0) {
    var airSlug = trimmed.slice(5);
    if (!SLUG_RE.test(airSlug)) {
      return { statusCode: 404, statusDescription: "Not Found" };
    }
    var airPollutant = normalizePollutant(getParam("pollutant"));
    var airQ =
      airPollutant !== "aqi"
        ? "pollutant=" + airPollutant + "&from=link"
        : "from=link";
    return redirect302(PWA_ORIGIN + "/air/" + airSlug + "?" + airQ);
  }

  if (trimmed === "/loc") {
    var lat = parseCoord(getParam("lat"), -90, 90);
    var lon = parseCoord(getParam("lon"), -180, 180);
    if (lat === null || lon === null) {
      return redirect302(PWA_ORIGIN + "/");
    }
    var name = sanitizeName(getParam("name"));
    var locView = normalizeView(getParam("view"));
    var locPollutant =
      locView === "air" ? normalizePollutant(getParam("pollutant")) : null;
    var parts = ["lat=" + lat, "lon=" + lon];
    if (name) parts.push("name=" + encodeURIComponent(name));
    if (locView !== "hourly") parts.push("view=" + locView);
    if (locView === "air" && locPollutant && locPollutant !== "aqi") {
      parts.push("pollutant=" + locPollutant);
    }
    parts.push("from=link");
    return redirect302(PWA_ORIGIN + "/loc?" + parts.join("&"));
  }

  return { statusCode: 404, statusDescription: "Not Found" };
}
