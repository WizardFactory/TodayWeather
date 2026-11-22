(function () {
  "use strict";

  var COPY = {
    ko: {
      pageTitle: "오늘날씨 — TodayWeather",
      eyebrow: "TodayWeather",
      title: "오늘날씨 열기",
      lead: "어제와 비교하는 시간별·주간 날씨와 미세먼지 정보를 앱 또는 웹에서 바로 확인하세요.",
      openWeb: "웹에서 바로 보기",
      openApp: "오늘날씨 앱에서 열기",
      inappHint:
        "카카오톡 등에서 앱이 열리지 않으면 브라우저 메뉴에서 Safari 또는 Chrome으로 열어 주세요.",
      appStore: "App Store (iOS)",
      googlePlay: "Google Play (Android)",
      privacy: "개인정보처리방침",
    },
    en: {
      pageTitle: "TodayWeather — Open App or Web",
      eyebrow: "TodayWeather",
      title: "Open TodayWeather",
      lead: "Check hourly and daily forecasts compared with yesterday, plus air quality, in the app or on the web.",
      openWeb: "Open in Web",
      openApp: "Open TodayWeather App",
      inappHint:
        "If TodayWeather does not open from an in-app browser, use its menu to open this page in Safari or Chrome.",
      appStore: "App Store (iOS)",
      googlePlay: "Google Play (Android)",
      privacy: "Privacy Policy",
    },
  };

  var params = new URLSearchParams(window.location.search);
  var queryLang = (params.get("lang") || "").trim().toLowerCase();
  var browserLang = (navigator.language || "ko").toLowerCase();
  var lang =
    queryLang === "ko" || queryLang === "en"
      ? queryLang
      : browserLang.indexOf("ko") === 0
        ? "ko"
        : "en";

  var strings = COPY[lang] || COPY.en;
  document.documentElement.lang = lang;
  document.title = strings.pageTitle;

  var nodes = document.querySelectorAll("[data-i18n]");
  for (var i = 0; i < nodes.length; i++) {
    var key = nodes[i].getAttribute("data-i18n");
    if (key && strings[key]) {
      nodes[i].textContent = strings[key];
    }
  }

  var ua = navigator.userAgent || "";
  var isAndroid = /Android/i.test(ua);
  var openAppEl = document.getElementById("open-app");
  if (openAppEl && isAndroid) {
    // Explicit Android intent URI helps KakaoTalk/in-app browsers hand off to the installed app
    // and falls back cleanly to Google Play if the app is not installed.
    var fallback = encodeURIComponent(
      "https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather",
    );
    openAppEl.setAttribute(
      "href",
      "intent://link.todayweather.ai/open#Intent;scheme=https;package=net.wizardfactory.todayweather;S.browser_fallback_url=" +
        fallback +
        ";end",
    );
    openAppEl.hidden = false;
  }
})();
