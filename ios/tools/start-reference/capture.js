// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-10 (#2959): it records the start page S01 of a first launch with its access notice O01 (manual
// page 1) and after the notice was closed (manual page 2), and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - StartCtrl loads the Google Maps JavaScript API (`$ocLazyLoad`, a script element) unless `window.google` exists; an
//   inert stand-in is defined first, so no script is fetched from Google. The page's script elements are recorded and
//   capture.py fails on any for another host.
// - The Ads SDK is not started: no UMP form or ATT prompt over the page (#2945). S01 hides the banner anyway.
// - O01 is closed through its own handler (`$buttonTapped`, what its button's ng-click calls); Ionic ignores synthetic
//   clicks.
(function () {
    'use strict';
    var server = window.TW_SERVER;
    var lang = window.TW_LANG;

    window.google = {maps: {places: {
        AutocompleteService: function () { this.getPlacePredictions = function () { }; },
        PlacesServiceStatus: {OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS'}
    }}};

    function request(method, path, body) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, server + path, true);
            xhr.setRequestHeader('Content-Type', 'text/plain'); // a simple request: no CORS preflight
            xhr.timeout = 120000;
            xhr.onload = function () {
                if (xhr.status !== 200) { return reject(new Error(path + ': HTTP ' + xhr.status + ' ' + xhr.responseText)); }
                resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
            };
            xhr.onerror = function () { reject(new Error(path + ': network error')); };
            xhr.ontimeout = function () { reject(new Error(path + ': timeout')); };
            xhr.send(body === undefined ? null : JSON.stringify(body));
        });
    }
    function post(path, body) { return request('POST', path, body); }

    function guard(kind, method, url) {
        var href;
        try { href = new URL(String(url), location.href).href; } catch (e) { href = String(url); }
        if (href.indexOf(server + '/__tw/') === 0) { return url; }
        var local = /^(app:\/\/localhost|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/|$)/.test(href) ||
            /^(data|blob):/.test(href);
        post('/__tw/observed', {kind: kind, method: method, url: href, blocked: !local}).catch(function () { });
        return local ? url : server + '/__tw/blocked?url=' + encodeURIComponent(href);
    }
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        args[1] = guard('xhr', method, url);
        return open.apply(this, args);
    };
    if (window.fetch) {
        var fetch0 = window.fetch;
        window.fetch = function (input, init) {
            var url = input && input.url ? input.url : input;
            return fetch0.call(this, guard('fetch', (init && init.method) || 'GET', url), init);
        };
    }
    if (navigator.sendBeacon) {
        var beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) { return beacon(guard('beacon', 'POST', url), data); };
    }

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function frames() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }

    document.addEventListener('deviceready', function () {
        var admob = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        if (admob) { admob.initialize = function () { }; }
    }, false);

    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    var PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'opacity',
        'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom', 'margin-left',
        'margin-right', 'border-top-width', 'border-bottom-width', 'border-left-width', 'border-top-color',
        'border-radius', 'text-align', 'visibility', 'white-space', 'min-height', 'height'];
    function style(el) {
        var cs = getComputedStyle(el), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
    function part(el) { return el ? {rect: rect(el), style: style(el), className: String(el.getAttribute('class') || '')} : null; }
    // Every element of a block with a box, its own text, an image or a glyph; rects in the WebView's coordinates.
    function elements(block) {
        return Array.prototype.filter.call(block.querySelectorAll('*'), function (e) {
            var r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        }).map(function (e) {
            var out = part(e);
            out.tag = e.tagName.toLowerCase();
            out.text = ownText(e);
            if (e.tagName === 'IMG') { out.src = e.getAttribute('src'); out.natural = {w: e.naturalWidth, h: e.naturalHeight}; }
            if (e.tagName === 'INPUT') {
                out.placeholder = e.getAttribute('placeholder');
                out.placeholderStyle = (function () {
                    var cs = getComputedStyle(e, '::placeholder');
                    return {color: cs.color, fontSize: cs.fontSize};
                })();
            }
            if (e.tagName === 'I') { out.glyph = getComputedStyle(e, '::before').content; out.glyphFont = getComputedStyle(e, '::before').fontFamily; }
            return out;
        });
    }

    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        var popup = shown('.popup-container .popup');
        if (inj && shown('ion-content.main-content') && popup && document.body.classList.contains('start')) { return wait(2500); }
        if (i > 240) { return Promise.reject(new Error('the start page did not open')); }
        return wait(500).then(function () { return ready(i + 1); });
    }

    // Asks the host to screenshot and crop `rects` (name -> CSS rect, or 'above' for the status bar over the WebView): a
    // first screenshot with a calibration marker finds the WebView's origin on the screen, the second, without it, is
    // cropped.
    function shoot(prefix, rects, markerTop) {
        var m = document.createElement('div');
        m.style.cssText = 'position:fixed;left:' + (innerWidth - 20) + 'px;top:' + markerTop + 'px;width:20px;height:20px;' +
            'background:#ff00ff;z-index:2147483647';
        document.body.appendChild(m);
        return frames().then(function () { return wait(300); }).then(function () {
            return post('/__tw/origin', {name: prefix, dpr: devicePixelRatio, marker: {left: innerWidth - 20, top: markerTop, size: 20}});
        }).then(function () {
            m.remove();
            return frames().then(function () { return wait(300); });
        }).then(function () {
            return post('/__tw/shot', {name: prefix, rects: rects, dpr: devicePixelRatio});
        });
    }

    function env() {
        var Util = angular.element(document.body).injector().get('Util');
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            region: Util.region, body: document.body.className, state: angular.element(document.body).scope().$root.state};
    }

    function record(name) {
        var c = shown('ion-content.main-content');
        var popup = shown('.popup-container .popup');
        var scope = angular.element(c).scope();
        var out = {name: name, env: env(), content: part(c), elements: elements(c),
            shortcuts: (scope.favoriteCityList || []).map(function (f) { return f.name; }),
            scripts: Array.prototype.map.call(document.scripts, function (s) { return s.src || null; }).filter(function (s) { return s; })};
        if (popup) {
            out.popup = {box: part(popup), title: part(popup.querySelector('.popup-title')),
                body: part(popup.querySelector('.popup-body')), bodyText: popup.querySelector('.popup-body').innerText,
                buttons: Array.prototype.map.call(popup.querySelectorAll('.popup-buttons .button'), function (b) {
                    var p = part(b); p.text = b.textContent.trim(); return p;
                }), backdrop: part(shown('.backdrop'))};
        }
        var rects = {page: {x: 0, y: 0, w: innerWidth, h: innerHeight}, statusBar: 'above'};
        if (popup) { rects.popup = rect(popup); }
        return shoot(name, rects, Math.round(innerHeight - 40)).then(function (shot) {
            out.shot = shot;
            return post('/__tw/record', out);
        });
    }

    function closeNotice() {
        var popup = shown('.popup-container .popup');
        var s = angular.element(popup).scope();
        s.$buttonTapped(s.buttons[0], {preventDefault: function () { }, defaultPrevented: false});
        var $rootScope = angular.element(document.body).scope().$root;
        if (!$rootScope.$$phase) { $rootScope.$apply(); }
        return wait(1200).then(frames).then(function () {
            if (shown('.popup-container .popup') || shown('.backdrop.visible')) { throw new Error('O01 did not close'); }
        });
    }

    // A word typed and three predictions shown, as `callbackAutocomplete` sets them (the Maps API is not loaded): the
    // result rows, Google's attribution and the Cancel button.
    var PREDICTIONS = [
        {description: 'London, UK', matched_substrings: [{offset: 0, length: 3}], terms: [{offset: 0, value: 'London'}, {offset: 8, value: 'UK'}]},
        {description: 'London, ON, Canada', matched_substrings: [{offset: 0, length: 3}],
            terms: [{offset: 0, value: 'London'}, {offset: 8, value: 'ON'}, {offset: 12, value: 'Canada'}]},
        {description: 'Londonderry, UK', matched_substrings: [{offset: 0, length: 3}],
            terms: [{offset: 0, value: 'Londonderry'}, {offset: 13, value: 'UK'}]}
    ];
    function typeWord() {
        var c = shown('ion-content.main-content');
        var scope = angular.element(c.querySelector('input')).scope();
        scope.search.word = 'Lon';
        scope.searchResults2 = PREDICTIONS;
        var $rootScope = angular.element(document.body).scope().$root;
        if (!$rootScope.$$phase) { $rootScope.$apply(); }
        return wait(1200).then(frames).then(function () {
            if (!shown('img[src="img/powered_by_google_on_white.png"]')) { throw new Error('the predictions did not show'); }
        });
    }

    ready(0)
        .then(function () { return post('/__tw/step', {name: 'access'}); })
        .then(function () { return record('access'); })
        .then(closeNotice)
        .then(function () { return post('/__tw/step', {name: 'start'}); })
        .then(function () { return record('start'); })
        .then(typeWord)
        .then(function () { return post('/__tw/step', {name: 'search'}); })
        .then(function () { return record('search'); })
        .then(function () { return post('/__tw/done', env()); })
        .catch(function (e) { return post('/__tw/error', {error: String(e && e.stack || e)}); });
}());
