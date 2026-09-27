/* Test-only harness for the #2605 PoC. Injected as the first <head> script of a built www;
 * never part of client/www. Emits "TW<KIND> <t> <msg>" lines through console.log:
 *   TWERR  JS error / resource failure / unhandled rejection / console.error / HTTP failure
 *   TWWARN console.warn
 *   TWHTTP successful XHR (status, url)
 *   TWCHECK ok|fail <name> <detail>
 *   TWSHOT <name>        host takes a screenshot
 *   TWHOST <action>      host performs an action (back, bgresume, external-return)
 *   TWSTEP <name>        progress marker
 *   TWEND <index> <name> scenario finished; host relaunches the app
 *   TWALLDONE            every scenario finished
 * Scenario progress is kept in localStorage so each app launch runs the next scenario.
 */
(function () {
    'use strict';
    var T0 = Date.now();
    var buffer = [];
    var ready = false;
    var baseLog = null;

    function emit(kind, msg) {
        var line = 'TW' + kind + ' ' + ((Date.now() - T0) / 1000).toFixed(1) + ' ' + String(msg).replace(/\s+/g, ' ').slice(0, 600);
        if (!ready) { buffer.push(line); }
        try { (baseLog || console.log).call(console, line); } catch (e) { /* ignore */ }
    }

    function stringify(args) {
        var out = [];
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (a instanceof Error) { out.push(a.message + (a.stack ? ' | ' + a.stack.split('\n').slice(0, 3).join(' | ') : '')); }
            else if (typeof a === 'object') { try { out.push(JSON.stringify(a)); } catch (e) { out.push(String(a)); } }
            else { out.push(String(a)); }
        }
        return out.join(' ');
    }

    // cordova-ios replaces window.console after bootstrap, so hooks are re-applied when lost.
    function hookConsole() {
        var c = window.console;
        if (!c || c.__tw) { return; }
        var origLog = c.log, origError = c.error, origWarn = c.warn;
        baseLog = function () { return origLog.apply(c, arguments); };
        c.error = function () { emit('ERR', 'console.error ' + stringify(arguments)); return origError.apply(c, arguments); };
        c.warn = function () { emit('WARN', stringify(arguments)); return origWarn.apply(c, arguments); };
        c.__tw = true;
    }
    hookConsole();
    setInterval(hookConsole, 100);

    window.addEventListener('error', function (e) {
        var t = e.target;
        if (t && t !== window && t.tagName) {
            emit('ERR', 'resource ' + t.tagName + ' ' + (t.currentSrc || t.src || t.href) + ' @' + location.hash);
        } else {
            emit('ERR', 'js ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno);
        }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        emit('ERR', 'rejection ' + stringify([e.reason]));
    });

    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__tw = { m: m, u: u }; return XO.apply(this, arguments); };
    // Push registration writes (PUT/POST/DELETE /vNNNNNN/push, /push-list) must not reach production
    // during test runs: record the request and answer it locally with 200 {}.
    var IS_ANDROID = /Android/.test(navigator.userAgent);
    var PUSH_WRITE = /\/v\d+\/push(-list)?(\?|$)/;
    XMLHttpRequest.prototype.send = function (body) {
        var x = this, t = Date.now();
        if (x.__tw && x.__tw.m !== 'GET' && PUSH_WRITE.test(String(x.__tw.u))) {
            emit('STEP', 'push-write intercepted ' + x.__tw.m + ' ' + x.__tw.u + ' ' + String(body || '').slice(0, 300));
            window.__twPushWrites = (window.__twPushWrites || []).concat([{ m: x.__tw.m, u: x.__tw.u, body: String(body || '') }]);
            ['readyState', 'status', 'statusText', 'responseText', 'response'].forEach(function (k, i) {
                Object.defineProperty(x, k, { configurable: true, value: [4, 200, 'OK', '{}', '{}'][i] });
            });
            x.getAllResponseHeaders = function () { return 'content-type: application/json\r\n'; };
            setTimeout(function () { if (x.onload) { x.onload(); } }, 10);
            return;
        }
        x.addEventListener('loadend', function () {
            var info = x.__tw || {};
            var u = String(info.u || '');
            var local = !/^https?:\/\//.test(u) || /\/\/localhost\//.test(u);
            if (x.status >= 200 && x.status < 400) {
                if (!local) { emit('HTTP', x.status + ' ' + (Date.now() - t) + 'ms ' + info.m + ' ' + u); }
            } else {
                emit('ERR', 'http ' + x.status + ' ' + info.m + ' ' + u);
            }
        });
        return XS.apply(this, arguments);
    };

    document.addEventListener('deviceready', function () {
        ready = true;
        hookConsole();
        // Re-emit anything logged before cordova's console (iOS native log) existed.
        if (/iPhone|iPad/.test(navigator.userAgent)) {
            for (var i = 0; i < buffer.length; i++) { baseLog.call(console, buffer[i].replace(/^TW(\w+)/, 'TW$1 [early]')); }
        }
        buffer = [];
        emit('STEP', 'deviceready ua=' + navigator.userAgent.slice(0, 80));
        // Record notification permission requests (the iOS alert itself is native and not tappable here).
        var fm = window.FirebasexMessaging;
        if (fm && fm.grantPermission) {
            var grant = fm.grantPermission;
            fm.grantPermission = function () {
                window.__twGrantRequests = (window.__twGrantRequests || 0) + 1;
                emit('STEP', 'push grantPermission');
                return grant.apply(this, arguments);
            };
        }
    }, false);
    document.addEventListener('resume', function () { emit('CHECK', 'ok resume-event'); }, false);
    window.__twAds = {};
    ['on.sdkInitialization', 'on.banner.load', 'on.banner.failed.load', 'on.banner.hide', 'on.banner.impression',
        'on.consent.info.update.failed'].forEach(function (name) {
        document.addEventListener(name, function (e) {
            window.__twAds[name] = (window.__twAds[name] || 0) + 1;
            emit('STEP', 'admob ' + name + (e && e.message ? ' ' + String(e.message).slice(0, 120) : ''));
        }, false);
    });
    document.addEventListener('pause', function () { emit('STEP', 'pause-event'); }, false);

    // ---------- helpers ----------
    var inj;
    function svc(name) { return inj.get(name); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function visible(el) {
        if (!el || !el.getBoundingClientRect) { return false; }
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { return false; }
        for (var n = el; n && n !== document; n = n.parentNode) {
            if (n.getAttribute && n.getAttribute('nav-view') === 'cached') { return false; }
            var cs = n.nodeType === 1 ? getComputedStyle(n) : null;
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
        }
        return true;
    }
    function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    // Ionic keeps the previous view's nav bar in the DOM; prefer the candidate a tap would hit.
    function hittable(el) {
        var r = el.getBoundingClientRect();
        var t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!t && (t === el || el.contains(t));
    }
    function find(sel, pred) {
        var c = all(sel).filter(function (el) { return visible(el) && (!pred || pred(el)); });
        return c.filter(hittable)[0] || c[0];
    }
    function byNg(expr) { return find('[ng-click]', function (el) { return el.getAttribute('ng-click').replace(/;\s*$/, '') === expr; }); }
    function byText(sel, text) { return find(sel, function (el) { return el.textContent.replace(/\s+/g, ' ').trim() === text; }); }
    // ionic.tap drops clicks it did not create; a real tap reaches handlers as a click with
    // isIonicTap=true (see tapClickGateKeeper), so dispatch exactly that at the element centre.
    function click(el, label) {
        if (!el) { emit('CHECK', 'fail click ' + label + ' not-found state=' + stateName()); return false; }
        if (!hittable(el) && el.scrollIntoView) { el.scrollIntoView({ block: 'center' }); }   // a user scrolls first
        var r = el.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;
        var target = document.elementFromPoint(x, y);
        if (!target || !(el === target || el.contains(target))) {
            // A user cannot tap through an overlay (popup, backdrop, side menu); report instead.
            var t = target || {};
            emit('CHECK', 'fail click ' + label + ' covered-by ' + (t.tagName || '?') + '.' + String(t.className || '').split(' ').slice(0, 3).join('.') + ' state=' + stateName());
            return false;
        }
        // ionic.tap sends the click to the control of an enclosing <label> (tapContainingElement +
        // tapTargetElement), e.g. the <input type=radio> of an ion-radio row.
        for (var up = target, k = 0; up && k < 6; up = up.parentElement, k++) {
            if (up.tagName === 'LABEL') { target = up.control || up.querySelector('input,textarea,select') || up; break; }
        }
        var ev = document.createEvent('MouseEvents');
        ev.initMouseEvent('click', true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
        ev.isIonicTap = true;
        target.dispatchEvent(ev);
        emit('STEP', 'click ' + label);
        return true;
    }
    function check(name, ok, detail) { emit('CHECK', (ok ? 'ok ' : 'fail ') + name + (detail ? ' ' + detail : '')); return ok; }
    function stateName() { try { return svc('$state').current.name; } catch (e) { return '?'; } }
    function waitFor(pred, ms, label) {
        var end = Date.now() + ms;
        return new Promise(function (resolve) {
            (function poll() {
                var v = false;
                try { v = pred(); } catch (e) { v = false; }
                if (v) { return resolve(true); }
                if (Date.now() > end) { if (label) { emit('CHECK', 'fail wait ' + label + ' state=' + stateName()); } return resolve(false); }
                setTimeout(poll, 250);
            })();
        });
    }
    function idle(ms) {
        return waitFor(function () {
            return svc('$http').pendingRequests.length === 0 && !find('.loading-container.visible');
        }, ms || 20000, 'http-idle').then(function () { return sleep(700); });
    }
    function shot(name) { emit('SHOT', name); return sleep(1800); }
    function host(action, ms) { emit('HOST', action); return sleep(ms || 6000); }
    function popupOk() {
        var b = find('.popup-container.active .popup-buttons button') || find('.popup-buttons button');
        return b ? (click(b, 'popup-button'), sleep(800)) : Promise.resolve();
    }
    function go(state, params) { svc('$state').go(state, params || {}); return sleep(1200).then(function () { return idle(); }); }
    function tab(i) {
        var tabs = all('.tabs a.tab-item').filter(visible);
        return click(tabs[i], 'tab[' + i + ']') ? sleep(1000).then(function () { return idle(); }) : Promise.resolve();
    }
    function typeInto(input, text) {
        input.focus();
        // On Android the native AdMob banner holds window focus after launch, so focus() fires no focus
        // event (ng-focus) until a real touch. Deliver it the way a tap would.
        if (!document.hasFocus()) { input.dispatchEvent(new FocusEvent('focus')); }
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        emit('STEP', 'type "' + text + '"');
    }
    function brokenImages() {
        return all('img').filter(function (i) { return visible(i) && i.getAttribute('src') && i.complete && i.naturalWidth === 0; })
            .map(function (i) { return i.getAttribute('src'); });
    }
    function checkImages(where) {
        var b = brokenImages();
        return check('images ' + where, b.length === 0, b.slice(0, 5).join(','));
    }
    function forecastRendered(where) {
        var svg = all('[ng-short-chart] svg, [ng-mid-chart] svg').filter(visible).length;
        var temp = /\d/.test(((find('.main-content [ng-style*="bigFontSize"]') || {}).textContent || ''));
        check('forecast-rendered ' + where, svg > 0, 'svg=' + svg + ' bigTemp=' + temp + ' state=' + stateName());
        return checkImages(where);
    }
    function openMenu() {
        var b = find('[menu-toggle]');
        if (b) { click(b, 'menu-toggle'); } else { svc('$ionicSideMenuDelegate').toggleLeft(true); emit('STEP', 'menu via delegate'); }
        return sleep(900);
    }
    function menuItem(key) {
        var el = byNg("clickMenu('" + key + "')") || byNg("settingRadio('" + key + "')");
        return el;
    }
    function back() {
        var b = find('.bar [ng-click="onClose()"]') || byNg('onClose()');
        if (b) { click(b, 'onClose'); } else { svc('$ionicHistory').goBack(); emit('STEP', 'history.goBack'); }
        return sleep(1200).then(function () { return idle(); });
    }
    function chooseRadio(index) {
        var radios = all('ion-radio input[type=radio], .item-radio input[type=radio]').filter(function (r) { return visible(r.parentNode); });
        var lbl = radios[index] && (radios[index].closest('label') || radios[index].parentNode);
        return click(lbl, 'radio[' + index + '/' + radios.length + ']') ? sleep(1200).then(function () { return idle(); }) : Promise.resolve();
    }
    function radioCount() {
        return all('ion-radio input[type=radio], .item-radio input[type=radio]').filter(function (r) { return visible(r.parentNode); }).length;
    }
    function currentRadio() {
        var radios = all('ion-radio input[type=radio], .item-radio input[type=radio]').filter(function (r) { return visible(r.parentNode); });
        for (var i = 0; i < radios.length; i++) { if (radios[i].checked) { return i; } }
        return -1;
    }
    // S02/S01 legacy rule: with the keyboard up, the first tap on a row/result only closes it.
    function tapResult(getEl, label) {
        var kb = window.cordova && cordova.plugins && cordova.plugins.Keyboard;
        var open = !!(kb && kb.isVisible);
        click(getEl(), label);
        if (!open) { return sleep(300); }
        return sleep(1200).then(function () {
            var el = getEl();
            check('keyboard-first-tap-closes', !(kb && kb.isVisible) && stateName() === 'tab.search', 'state=' + stateName());
            if (el && stateName() === 'tab.search') { click(el, label + ' (2nd tap)'); }
        });
    }
    function cityRows() {
        var rows = [];
        all('[ng-click^="OnSelectCity"]').filter(visible).forEach(function (el) {
            var row = el.closest('.item') || el.parentNode;
            if (rows.indexOf(row) < 0) { rows.push(row); }
        });
        return rows;
    }
    function lastHttp(re) { return (window.__twHttpLog || []).filter(function (u) { return re.test(u); }).pop(); }

    // Remember request URLs for assertions (units etc.).
    window.__twHttpLog = [];
    var XO2 = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { window.__twHttpLog.push(String(u)); return XO2.apply(this, arguments); };

    function pushWrites(method) { return (window.__twPushWrites || []).filter(function (w) { return w.m === method; }); }
    function checkPlatformIntegrations(where) {
        var put = pushWrites('PUT').filter(function (w) { return /"newToken":"[^"]{20,}"/.test(w.body); });
        // iOS gets a token only after the notification permission is granted, which the harness cannot tap.
        if (IS_ANDROID) { check('fcm-token-registered ' + where, put.length > 0, put.length ? put[0].body.slice(0, 60) : 'no PUT /push with newToken'); }
        check('admob-sdk-initialized ' + where, !!window.__twAds['on.sdkInitialization'], JSON.stringify(window.__twAds));
        var ma = window.MobileAccessibility;
        if (!ma) { check('accessibility-plugin', false, 'window.MobileAccessibility missing'); return Promise.resolve(); }
        if (!/Android/.test(navigator.userAgent)) { check('accessibility-plugin', true, 'loaded (iOS: app does not call it)'); return Promise.resolve(); }
        return new Promise(function (res) {
            ma.getTextZoom(function (zoom) { check('accessibility-text-zoom', zoom === 100, 'textZoom=' + zoom); res(); });
            setTimeout(res, 3000);
        });
    }

    // ---------- scenarios ----------
    var S = [];

    S.push({ name: 'S1_fresh_start', run: function () {
        return Promise.resolve()
            .then(function () { var k = window.cordova && cordova.plugins && cordova.plugins.Keyboard; check('keyboard-api', !!k && typeof k.close === 'function', 'window.Keyboard=' + !!window.Keyboard); })
            .then(function () { return waitFor(function () { return stateName() === 'start'; }, 15000, 'start-state'); })
            .then(function () { return sleep(1500); })
            .then(function () { check('start-popup', !!find('.popup-container .popup-buttons button')); return shot('s1-start-popup'); })
            .then(popupOk)
            .then(function () { checkImages('start'); return shot('s1-start'); })
            .then(function () {
                var favs = all('button.button-outline').filter(visible);
                check('start-favorites', favs.length >= 5, 'count=' + favs.length);
                var seoul = byText('button.button-outline', '서울') || favs[0];
                click(seoul, 'favorite-first(서울)');
                return waitFor(function () { return stateName() === 'tab.forecast'; }, 20000, 'forecast-after-seoul');
            })
            .then(function () { return idle(30000); })
            .then(function () { return sleep(1500); })
            .then(function () { forecastRendered('s1-hourly'); return waitFor(function () { return window.__twAds['on.banner.load'] || window.__twAds['on.banner.failed.load']; }, 15000, 'admob-banner-event'); })
            .then(function () { check('admob-banner-loaded', !!window.__twAds['on.banner.load'], JSON.stringify(window.__twAds)); return checkPlatformIntegrations('s1'); })
            .then(function () { return shot('s1-hourly'); })
            .then(function () {
                var ex = byNg('clickExpander()');
                click(ex, 'expander');
                return sleep(1500);
            })
            .then(function () {
                check('short-detail-chart', all('[ng-short-detail-chart] svg').filter(visible).length > 0);
                return shot('s1-hourly-expanded');
            })
            .then(function () { click(byNg('clickExpander()'), 'expander-close'); return sleep(800); })
            .then(function () { return tab(2); })
            .then(function () { return sleep(1000); })
            .then(function () { check('state-daily', stateName() === 'tab.dailyforecast', stateName()); forecastRendered('s1-daily'); return shot('s1-daily'); })
            .then(function () { return tab(3); })
            .then(function () { return sleep(1500); })
            .then(function () { check('state-air', stateName() === 'tab.air', stateName()); checkImages('air'); return shot('s1-air'); })
            .then(function () {
                var codes = all('[ng-click^="setMainAqiCode"]').filter(visible);
                check('air-codes', codes.length > 0, 'count=' + codes.length);
                if (codes[1]) { click(codes[1], 'air-code[1]'); }
                return sleep(1200);
            })
            .then(function () { return shot('s1-air-code'); })
            .then(function () {
                var st = all('[ng-click^="setStation"]').filter(visible);
                if (st[1]) { click(st[1], 'air-station[1]'); return sleep(1500).then(function () { return idle(); }).then(function () { return shot('s1-air-station'); }); }
                emit('STEP', 'air-station none (' + st.length + ')');
            })
            .then(function () { return tab(0); })
            .then(function () { return sleep(1000); })
            .then(function () {
                check('state-search', stateName() === 'tab.search', stateName());
                var cities = all('[ng-click^="OnSelectCity"]').filter(visible);
                check('favorites-list', cities.length >= 1, 'count=' + cities.length);
                return shot('s1-favorites');
            })
            .then(function () { return tab(1); })
            .then(function () { check('state-hourly-again', stateName() === 'tab.forecast', stateName()); return sleep(500); });
    } });

    S.push({ name: 'S2_warm_settings', run: function () {
        var unitIdx = -1, origUnit = null;
        function tempUnit() { var m = /temperatureUnit=(\w)/.exec(lastHttp(/weather\/v000903\/coord/) || ''); return m && m[1]; }
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'warm-start-tab'); })
            .then(function () { return idle(30000); })
            .then(function () { check('no-update-popup', !find('.popup-container .popup-buttons button'), 'warm launch'); })
            .then(function () { origUnit = tempUnit(); check('warm-start-state', stateName() === 'tab.forecast', stateName() + ' unit=' + origUnit); forecastRendered('s2-warm'); return shot('s2-warm'); })
            .then(openMenu)
            .then(function () { checkImages('menu'); return shot('s2-menu'); })
            .then(function () { click(menuItem('units'), 'menu-units'); return sleep(1500); })
            .then(function () {
                check('state-units', stateName() === 'units', stateName());
                var units = all('[ng-click="settingRadio(unit)"]').filter(visible);
                check('units-list', units.length >= 5, 'count=' + units.length);
                return shot('s2-units').then(function () { click(units[0], 'unit[0]-temperature'); return sleep(1500); });
            })
            .then(function () {
                check('state-unit-radio', stateName() === 'setting-radio', stateName());
                unitIdx = currentRadio();
                emit('STEP', 'temperature radios=' + radioCount() + ' current=' + unitIdx);
                return shot('s2-unit-temperature').then(function () { return chooseRadio(unitIdx === 0 ? 1 : 0); });
            })
            .then(function () { return sleep(500); })
            .then(function () { if (stateName() === 'setting-radio') { return back(); } })
            .then(function () { if (stateName() === 'units') { return back(); } })
            .then(function () { return idle(30000); })
            .then(function () {
                var u = lastHttp(/weather\/v000903\/coord/);
                check('units-changed-request', !!u && tempUnit() !== origUnit, origUnit + '->' + tempUnit());
                forecastRendered('s2-fahrenheit');
                return shot('s2-fahrenheit');
            })
            .then(function () { return go('units'); })
            .then(function () { click(all('[ng-click="settingRadio(unit)"]').filter(visible)[0], 'unit[0]-temperature'); return sleep(1500); })
            .then(function () { return chooseRadio(unitIdx < 0 ? 0 : unitIdx); })
            .then(function () { if (stateName() === 'setting-radio') { return back(); } })
            .then(function () { if (stateName() === 'units') { return back(); } })
            .then(function () { return idle(30000); })
            .then(function () {
                var u = lastHttp(/weather\/v000903\/coord/);
                check('units-restored-request', !!u && tempUnit() === origUnit, 'expected ' + origUnit + ' got ' + tempUnit());
            })
            .then(function () {
                // theme radio: visit every option, screenshot the forecast in each, restore the original
                var themeCount = 0, original = -1, i = 0;
                function visitTheme() {
                    return openMenu()
                        .then(function () { click(menuItem('theme'), 'menu-theme'); return sleep(1500); })
                        .then(function () {
                            if (original < 0) { original = currentRadio(); themeCount = radioCount(); emit('STEP', 'themes=' + themeCount + ' current=' + original); }
                            return chooseRadio(i);
                        })
                        .then(function () { if (stateName() === 'setting-radio') { return back(); } })
                        .then(function () { return idle(); })
                        .then(function () { return sleep(1000); })
                        .then(function () {
                            var cls = (/(\w+)-theme/.exec(document.body.className) || [])[1];
                            check('theme-applied', !!cls && (i === original || cls !== window.__twLastTheme), 'theme[' + i + ']=' + cls);
                            window.__twLastTheme = cls;
                            forecastRendered('theme-' + i); return shot('s2-theme-' + i + '-' + cls);
                        })
                        .then(function () { i++; if (i < themeCount) { return visitTheme(); } });
                }
                return visitTheme().then(function () {
                    i = original < 0 ? 0 : original; themeCount = 0;
                    return openMenu()
                        .then(function () { click(menuItem('theme'), 'menu-theme-restore'); return sleep(1500); })
                        .then(function () { return chooseRadio(i); })
                        .then(function () { if (stateName() === 'setting-radio') { return back(); } });
                });
            })
            .then(function () {
                function visitRadio(key) {
                    return openMenu()
                        .then(function () { click(menuItem(key), 'menu-' + key); return sleep(1500); })
                        .then(function () {
                            check('radio-' + key, stateName() === 'setting-radio' && radioCount() > 1, 'count=' + radioCount() + ' current=' + currentRadio());
                            return shot('s2-radio-' + key);
                        })
                        .then(back);
                }
                return visitRadio('startupPage').then(function () { return visitRadio('refreshInterval'); });
            })
            .then(function () { check('back-to-tab', /^tab\./.test(stateName()), stateName()); });
    } });

    S.push({ name: 'S3_menu_pages', run: function () {
        function page(key) {
            return openMenu()
                .then(function () {
                    var el = menuItem(key);
                    if (el) { click(el, 'menu-' + key); } else { emit('STEP', 'menu-' + key + ' hidden (region ' + (svc('Util').region) + '); $state.go'); svc('$ionicSideMenuDelegate').toggleLeft(false); svc('$state').go(key); }
                    return sleep(2000);
                })
                .then(function () { return idle(30000); })
                .then(function () { return sleep(1500); })
                .then(function () { check('page-' + key, stateName() === key, stateName()); checkImages(key); return shot('s3-' + key); });
        }
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { return page('kma-special'); })
            .then(back)
            .then(function () { return page('nation'); })
            .then(function () {
                var p = Promise.resolve();
                [1, 2, 0].forEach(function (t) {
                    p = p.then(function () { click(byNg('changeWeatherType(' + t + ')'), 'nation-type-' + t); return sleep(1500); })
                        .then(function () { return idle(); })
                        .then(function () { checkImages('nation-' + t); return shot('s3-nation-type-' + t); });
                });
                return p;
            })
            .then(back)
            .then(function () { return page('nation-air'); })
            .then(function () {
                var types = all('[ng-click="changeAirType(name)"]').filter(visible);
                emit('STEP', 'nation-air types=' + types.length);
                var p = Promise.resolve();
                types.slice(1, 3).forEach(function (el, k) {
                    p = p.then(function () { click(el, 'nation-air-type-' + (k + 1)); return sleep(1500); })
                        .then(function () { return idle(); })
                        .then(function () { checkImages('nation-air-' + (k + 1)); return shot('s3-nation-air-type-' + (k + 1)); });
                });
                return p;
            })
            .then(back)
            .then(openMenu)
            .then(function () {
                var el = menuItem('openInfo');
                if (!el) { emit('STEP', 'openInfo hidden (language ' + svc('Util').language + ')'); return svc('$ionicSideMenuDelegate').toggleLeft(false); }
                click(el, 'menu-openInfo');
                return sleep(1500).then(function () {
                    check('info-popup', !!find('.popup-container .popup-buttons button'));
                    return shot('s3-info-popup');
                }).then(popupOk).then(function () { svc('$ionicSideMenuDelegate').toggleLeft(false); return sleep(800); });
            })
            .then(function () { check('purchase-menu-hidden', !menuItem('purchase')); })
            .then(function () { return go('guide'); })
            .then(function () { check('page-guide', stateName() === 'guide', stateName()); checkImages('guide'); return shot('s3-guide'); })
            .then(function () { click(byNg('onRightClick()'), 'guide-right'); return sleep(1000); })
            .then(function () { return shot('s3-guide-2'); })
            .then(function () { click(byNg('onClose()'), 'guide-close'); return sleep(1500); })
            .then(function () { check('after-guide', /^tab\.|^start$/.test(stateName()), stateName()); return idle(); });
    } });

    S.push({ name: 'S4_search_cities', run: function () {
        var before = 0;
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { return tab(0); })
            .then(function () {
                before = cityRows().length;
                var input = find('#searchInput');
                if (!input) { check('search-input', false); return; }
                typeInto(input, '부산');
                return waitFor(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible).length > 0; }, 15000, 'search-results');
            })
            .then(function () {
                var results = all('[ng-click="OnSelectResult(result)"]').filter(visible);
                check('search-results', results.length > 0, 'count=' + results.length + ' first=' + (results[0] ? results[0].textContent.trim().slice(0, 40) : ''));
                return shot('s4-search-results').then(function () { return tapResult(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible)[0]; }, 'search-result[0]'); }).then(function () { return sleep(2000); });
            })
            .then(function () { return idle(30000); })
            .then(function () { return sleep(1500); })
            .then(function () { check('state-after-select', stateName() === 'tab.forecast', stateName()); forecastRendered('s4-busan'); return shot('s4-busan'); })
            .then(function () { click(byNg('onSwipeRight()'), 'swipe-right(prev city)'); return sleep(1500).then(function () { return idle(30000); }); })
            .then(function () { forecastRendered('s4-swipe-right'); return shot('s4-swipe-right'); })
            .then(function () { click(byNg('onSwipeLeft()'), 'swipe-left(next city)'); return sleep(1500).then(function () { return idle(30000); }); })
            .then(function () { forecastRendered('s4-swipe-left'); return shot('s4-swipe-left'); })
            .then(function () { return tab(0); })
            .then(function () {
                var after = cityRows().length;
                check('city-added', after === before + 1, before + '->' + after);
                // world city through the search tab
                var input = find('#searchInput');
                typeInto(input, 'London');
                return waitFor(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible).length > 0; }, 15000, 'search-results-london');
            })
            .then(function () {
                return tapResult(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible)[0]; }, 'search-result-london[0]')
                    .then(function () { return sleep(2000); }).then(function () { return idle(30000); }).then(function () { return sleep(1500); });
            })
            .then(function () {
                var p = find('.popup-container .popup-buttons button');
                if (p) {
                    var body = ((find('.popup-container .popup-body') || {}).textContent || '').trim();
                    check('world-weather', false, 'error popup "' + body + '" state=' + stateName());
                    return shot('s4-london-error').then(popupOk);
                }
                check('world-weather', stateName() === 'tab.forecast', stateName());
                forecastRendered('s4-london');
                return shot('s4-london').then(function () { return tab(2); })
                    .then(function () { forecastRendered('s4-london-daily'); return shot('s4-london-daily'); })
                    .then(function () { return tab(3); })
                    .then(function () { checkImages('s4-london-air'); return shot('s4-london-air'); });
            })
            .then(function () { return tab(0); })
            .then(function () { window.__twRowsBeforeDelete = cityRows().length; click(byNg('OnEdit()'), 'edit'); return sleep(1000); })
            .then(function () { return shot('s4-edit'); })
            .then(function () {
                var del = all('[ng-click="OnDeleteCity($index)"]').filter(visible);
                check('delete-buttons', del.length > 0, 'count=' + del.length);
                click(del[del.length - 1], 'delete-last');
                return sleep(1500);
            })
            .then(function () { var b = find('.popup-container .popup-buttons button'); if (b) { return shot('s4-delete-confirm').then(function () { var bs = all('.popup-buttons button').filter(visible); click(bs[bs.length - 1], 'confirm-delete'); return sleep(1200); }); } })
            .then(function () { click(byNg('OnEdit()'), 'edit-done'); return sleep(1000); })
            .then(function () {
                var n = cityRows().length, expected = window.__twRowsBeforeDelete - 1;
                check('city-deleted', n === expected, 'count=' + n + ' expected=' + expected);
                return shot('s4-after-delete');
            })
            .then(function () {
                // Only the row's cells carry OnSelectCity; wide screens leave dead gaps between them.
                return tapResult(function () { var r = cityRows()[0]; return r && r.querySelector('[ng-click^="OnSelectCity"]'); }, 'select-city[0]')
                    .then(function () { return sleep(2000); }).then(function () { return idle(30000); });
            })
            .then(function () { check('select-city-state', stateName() === 'tab.forecast', stateName()); forecastRendered('s4-select-city'); });
    } });

    S.push({ name: 'S5_current_location', run: function () {
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { return tab(0); })
            .then(function () {
                var input = find('#searchInput');
                input.focus();
                input.dispatchEvent(new Event('focus'));
                return sleep(1200);
            })
            .then(function () {
                var b = byNg('OnSearchCurrentPosition()');
                click(b, 'find-by-location');
                return sleep(3000);
            })
            .then(function () { return waitFor(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible).length > 0; }, 20000, 'location-result'); })
            .then(function () {
                var r = all('[ng-click="OnSelectResult(result)"]').filter(visible);
                check('location-result', r.length > 0, r[0] ? r[0].textContent.trim().slice(0, 40) : '');
                return shot('s5-location-result').then(function () { return tapResult(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible)[0]; }, 'location-result[0]'); }).then(function () { return sleep(2000); });
            })
            .then(function () { return waitFor(function () { return stateName() === 'tab.forecast'; }, 30000, 'forecast-after-location'); })
            .then(function () { return idle(30000); })
            .then(function () { return sleep(1500); })
            .then(function () {
                var g = lastHttp(/geocode|coord/);
                check('location-forecast', stateName() === 'tab.forecast', 'last=' + g);
                forecastRendered('s5-location');
                return shot('s5-location-forecast');
            })
            .then(function () { return tab(0); })
            .then(function () { return shot('s5-favorites'); });
    } });

    S.push({ name: 'S6_push_settings', run: function () {
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { if (stateName() !== 'tab.forecast') { return tab(1); } })
            .then(function () { click(byNg('goPushPage()'), 'bell(goPushPage)'); return sleep(2000); })
            .then(function () { return shot('s6-push'); })
            .then(function () {
                emit('STEP', 'push state=' + stateName());
                if (stateName() !== 'setting-push') { var b = find('.popup-container .popup-buttons button'); if (b) { return popupOk(); } return; }
                var t = find('label.toggle', function (el) { return !el.closest('.popup-container'); });
                var before = t && t.querySelector('input').checked;
                click(t, 'push-enable-toggle');
                window.__twToggle = function () { return t && t.querySelector('input').checked !== before; };
                return sleep(1500).then(function () { check('push-toggle', window.__twToggle(), 'alert.enable changed'); return shot('s6-push-toggled'); })
                    .then(function () { var ok = byNg('onOkay()'); if (ok) { click(ok, 'push-ok'); } else { return back(); } return sleep(2000); })
                    .then(function () { var b = find('.popup-container .popup-buttons button'); if (b) { return shot('s6-push-popup').then(popupOk); } })
                    .then(function () {
                        check('push-permission-requested', window.__twGrantRequests > 0, 'grantPermission calls=' + (window.__twGrantRequests || 0));
                        var post = pushWrites('POST');
                        if (!IS_ANDROID) { return; }   // no token before the native grant (see checkPlatformIntegrations)
                        check('push-list-posted', post.length > 0 && /fcmToken/.test(post[post.length - 1].body), post.length ? post[post.length - 1].body.slice(0, 120) : 'no POST /push-list');
                    });
            })
            .then(function () {
                // Unsaved changes (iOS without the permission) ask "Save changes?"; close it.
                if (stateName() === 'setting-push') { return back().then(function () { if (find('.popup-container .popup-buttons button')) { return popupOk().then(function () { return sleep(1200); }); } }); }
            })
            .then(function () { check('after-push', /^tab\./.test(stateName()), stateName()); });
    } });

    S.push({ name: 'S7_resume_back', run: function () {
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { return host('bgresume', 9000); })
            .then(function () { return idle(30000); })
            .then(function () { forecastRendered('s7-after-resume'); return shot('s7-after-resume'); })
            .then(function () { return tab(2); })
            .then(function () {
                if (!/Android/.test(navigator.userAgent)) { return; }
                return host('back', 3000).then(function () {
                    var title = ((find('.popup-container .popup-title, .popup-container .popup-body') || {}).textContent || '').trim();
                    check('exit-confirm', !!find('.popup-container .popup-buttons button'), '"' + title + '" state=' + stateName());
                    return shot('s7-exit-confirm');
                }).then(function () {
                    var bs = all('.popup-container .popup-buttons button').filter(visible);
                    click(bs[0], 'exit-cancel');
                    return sleep(1200);
                }).then(function () { check('exit-cancelled', !find('.popup-container .popup-buttons button') && stateName() === 'tab.dailyforecast', stateName()); });
            })
            .then(function () { localStorage.removeItem('startVersion'); emit('STEP', 'removed startVersion; next launch opens S01'); });
    } });

    S.push({ name: 'S8_start_current_location', run: function () {
        return Promise.resolve()
            .then(function () { return waitFor(function () { return stateName() === 'start'; }, 15000, 'start-state'); })
            .then(function () { return sleep(1500); })
            .then(function () { check('start-access-popup', !!find('.popup-container .popup-buttons button')); return popupOk(); })
            .then(function () { click(byNg('OnUseLocationService()'), 'use-current-location'); return sleep(2000); })
            .then(function () {
                return waitFor(function () { return stateName() !== 'start' || !!find('.popup-container .popup-buttons button'); }, 30000, 'start-location-result');
            })
            .then(function () {
                var p = find('.popup-container .popup-buttons button');
                if (p) {
                    var body = ((find('.popup-container .popup-body') || {}).textContent || '').trim();
                    check('start-current-location', false, 'popup "' + body + '"');
                    return shot('s8-start-location-popup').then(popupOk);
                }
                return idle(30000).then(function () { return sleep(1500); }).then(function () {
                    var city = svc('WeatherInfo').getCityOfIndex(0) || {};
                    check('start-current-location', /^tab\./.test(stateName()) && city.currentPosition === true && !city.disable,
                        'state=' + stateName() + ' city0=' + (city.name || city.address || '?'));
                    forecastRendered('s8-start-location');
                    return shot('s8-start-location-forecast');
                });
            });
    } });

    // External apps suspend the web view's timers (iOS), so the host screenshots and returns:
    // announce the hand-off, tap, then wait until the host has brought the app back.
    function handOff(name, getEl, label) {
        emit('HOST', 'external ' + name);
        return sleep(300).then(function () { click(getEl(), label); return sleep(14000); });
    }

    S.push({ name: 'S9_external', run: function () {
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { if (stateName() !== 'tab.forecast') { return tab(1); } })
            .then(openMenu)
            .then(function () { return handOff('s9-market', function () { return menuItem('openMarket'); }, 'menu-openMarket'); })
            .then(openMenu)
            .then(function () { return handOff('s9-mail', function () { return menuItem('sendMail'); }, 'menu-sendMail'); })
            .then(function () { check('after-external', /^tab\./.test(stateName()), stateName()); return shot('s9-after-external'); })
            // Last: the iOS share sheet cannot be dismissed from the host.
            .then(function () { return handOff('s9-share', function () { return byNg('doTabShare()'); }, 'share'); })
            .then(function () { return shot('s9-after-share'); });
    } });

    // ---------- layout mode (window.TW_HARNESS_MODE === 'layout') ----------
    // Per screen: page-level horizontal overflow, elements outside the viewport that are not inside a
    // horizontal scroller, and clipped text. Charts: scrollability, initial position, current column,
    // both ends reachable, no vertical clipping; on Android a real touch swipe via the host.
    function hScroller(el) {
        for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            var ox = getComputedStyle(n).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) { return n; }
        }
        return null;
    }
    function describe(el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.') + (t ? '"' + t + '"' : '');
    }
    // Visible part of an element: its rect cut by every ancestor that clips (overflow other than visible).
    function visibleRect(el) {
        var r = el.getBoundingClientRect(), L = r.left, R = r.right;
        for (var n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
            if (getComputedStyle(n).overflowX !== 'visible') { var p = n.getBoundingClientRect(); L = Math.max(L, p.left); R = Math.min(R, p.right); }
        }
        return { left: L, right: R, empty: R - L < 1 };
    }
    function truncatedByEllipsis(el) {
        for (var n = el; n && n !== document.body; n = n.parentElement) {
            var cs = getComputedStyle(n);
            if (cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) { return true; }
        }
        return false;
    }
    function audit(name) {
        var W = window.innerWidth, issues = [];
        var de = document.documentElement;
        if (de.scrollWidth > W + 1 || document.body.scrollWidth > W + 1) { issues.push('page-overflow-x ' + Math.max(de.scrollWidth, document.body.scrollWidth) + '>' + W); }
        var offscreen = [], truncated = [];
        all('body *').forEach(function (el) {
            if (el.children.length > 0 && !/^(BUTTON|LABEL|A|svg)$/i.test(el.tagName)) { return; }
            if (!visible(el) || el.closest('.click-block')) { return; }
            if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') { return; }
            var r = el.getBoundingClientRect();
            if (r.right < -1000 || r.left > W + 1000) { return; }            // Ionic's off-screen parking (-9999px)
            if (hScroller(el) || el.closest('.menu-left')) { return; }      // inside a horizontal scroller / closed menu
            var v = visibleRect(el);
            if (v.empty) { return; }                                         // clipped away on purpose (slides, tabs)
            if (v.right > W + 1 || v.left < -1) { offscreen.push(describe(el) + ' [' + Math.round(v.left) + ',' + Math.round(v.right) + ']'); }
            if ((el.textContent || '').trim() && truncatedByEllipsis(el)) { truncated.push(describe(el)); }
        });
        if (offscreen.length) { issues.push('offscreen x' + offscreen.length + ': ' + offscreen.slice(0, 4).join(' | ')); }
        check('layout ' + name, issues.length === 0, 'W=' + W + ' screen=' + screen.width + 'x' + screen.height + ' ' + issues.join(' ; '));
        if (truncated.length) { emit('STEP', 'ellipsis ' + name + ' x' + truncated.length + ': ' + truncated.slice(0, 6).join(' | ')); }
    }
    function chartCheck(kind) {
        var el = document.getElementById(kind === 'short' ? 'chartShortScroll' : 'chartMidScroll');
        if (!el || !visible(el)) { check('chart-' + kind + ' present', false); return Promise.resolve(); }
        var max = el.scrollWidth - el.clientWidth, sw = screen.width;
        var colWidth = Math.min(sw / 7, 60);
        var ox = getComputedStyle(el).overflowX;
        var start = el.scrollLeft;
        var cur = el.querySelector('.current-rect');
        var er = el.getBoundingClientRect();
        var curVisible = null;
        if (cur) { var cr = cur.getBoundingClientRect(); curVisible = cr.left >= er.left - 1 && cr.right <= er.right + 1; }
        var svgs = all('#' + el.id + ' svg').filter(visible);
        var vclip = svgs.filter(function (g) { var p = g.parentElement.getBoundingClientRect(), r = g.getBoundingClientRect(); return r.bottom > p.bottom + 1 || r.top < p.top - 1; }).length;
        var detail = 'overflowX=' + ox + ' client=' + el.clientWidth + ' scroll=' + el.scrollWidth + ' colWidth=' + colWidth.toFixed(1) + ' start=' + Math.round(start) + ' max=' + max + ' currentVisible=' + curVisible + ' svg=' + svgs.length + ' vclip=' + vclip;
        var scrollExpected = kind === 'short' || el.scrollWidth > el.clientWidth + 1;
        check('chart-' + kind + ' scrollable', ox === 'auto' && (!scrollExpected || max > 0), detail);
        check('chart-' + kind + ' initial-position', kind === 'short' ? start > 0 || max === 0 : (sw >= 640 ? start === 0 : true), detail);
        if (cur) { check('chart-' + kind + ' current-column-visible', curVisible, detail); }
        check('chart-' + kind + ' no-vertical-clip', vclip === 0, detail);
        return shot('L-chart-' + kind + '-initial').then(function () {
            el.scrollLeft = max; return sleep(600);
        }).then(function () {
            var inner = el.firstElementChild.getBoundingClientRect(), er2 = el.getBoundingClientRect();
            var ok = el.scrollLeft >= max - 1 && Math.abs(inner.right - er2.right) <= 2;
            check('chart-' + kind + ' reaches-end', ok, 'scrollLeft=' + Math.round(el.scrollLeft) + ' max=' + max + ' contentRight=' + Math.round(inner.right) + ' boxRight=' + Math.round(er2.right));
            return shot('L-chart-' + kind + '-end');
        }).then(function () {
            el.scrollLeft = 0; return sleep(600);
        }).then(function () {
            var inner = el.firstElementChild.getBoundingClientRect(), er2 = el.getBoundingClientRect();
            check('chart-' + kind + ' reaches-start', el.scrollLeft <= 1 && Math.abs(inner.left - er2.left) <= 2, 'scrollLeft=' + Math.round(el.scrollLeft));
            el.scrollLeft = start;
            if (!/Android/.test(navigator.userAgent) || max <= 0) { return sleep(300); }
            // Real touch swipe (host sends a DevTools scroll gesture): the chart must scroll, the city must not change.
            var city = svc('WeatherInfo').getCityIndex(), before = el.scrollLeft, r = el.getBoundingClientRect();
            var x = Math.round(r.left + r.width * 0.7), y = Math.round(r.top + Math.min(r.height / 2, 120));
            return host('cdp-swipe ' + x + ' ' + y + ' ' + (before > max / 2 ? 250 : -250), 3500).then(function () {
                check('chart-' + kind + ' touch-swipe', Math.abs(el.scrollLeft - before) > 50 && svc('WeatherInfo').getCityIndex() === city, 'scrollLeft ' + Math.round(before) + '->' + Math.round(el.scrollLeft) + ' city ' + city + '->' + svc('WeatherInfo').getCityIndex());
                el.scrollLeft = start; return sleep(300);
            });
        });
    }
    function screenStep(name, fn) {
        return Promise.resolve().then(fn).then(function () { return idle(20000); }).then(function () { return sleep(900); })
            .then(function () { audit(name); return shot('L-' + name); });
    }
    function goBackTo(re) { return (re.test(stateName()) ? Promise.resolve() : back()).then(function () { if (!re.test(stateName())) { return back(); } }); }
    var LAYOUT = [
        { name: 'L1_layout_screens', run: function () {
            return Promise.resolve()
                .then(function () { return waitFor(function () { return stateName() === 'start'; }, 15000, 'start-state'); })
                .then(function () { return sleep(1500); })
                .then(function () { audit('O01-access'); return shot('L-O01-access'); })
                .then(popupOk)
                .then(function () { return screenStep('S01-start', function () {}); })
                .then(function () {
                    var seoul = byText('button.button-outline', '서울') || all('button.button-outline').filter(visible)[0];
                    click(seoul, 'favorite-first(서울)');
                    return waitFor(function () { return stateName() === 'tab.forecast'; }, 20000, 'forecast');
                })
                .then(function () { return screenStep('S03-hourly', function () { return idle(30000).then(function () { return sleep(1200); }); }); })
                .then(function () { return chartCheck('short'); })
                .then(function () { return screenStep('S03-expanded', function () { click(byNg('clickExpander()'), 'expander'); return sleep(1200); }); })
                .then(function () { click(byNg('clickExpander()'), 'expander-close'); return sleep(800); })
                .then(function () { return screenStep('S04-daily', function () { return tab(2).then(function () { return sleep(1200); }); }); })
                .then(function () { return chartCheck('mid'); })
                .then(function () { return screenStep('S05-air', function () { return tab(3); }); })
                .then(function () { return screenStep('S02-favorites', function () { return tab(0); }); })
                .then(function () { return screenStep('S02-search', function () {
                    typeInto(find('#searchInput'), '부산');
                    return waitFor(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible).length > 0; }, 15000, 'search-results');
                }); })
                .then(function () { click(byNg('OnEdit()'), 'cancel-search'); var kb = window.cordova && cordova.plugins && cordova.plugins.Keyboard; if (kb) { kb.close(); } return sleep(1200); })
                .then(function () { return tab(1); })
                .then(function () { return screenStep('S06-menu', openMenu); })
                .then(function () { return screenStep('S07-units', function () { click(menuItem('units'), 'menu-units'); return sleep(1500); }); })
                .then(function () { return screenStep('S08-radio', function () { click(all('[ng-click="settingRadio(unit)"]').filter(visible)[0], 'unit[0]'); return sleep(1500); }); })
                .then(function () { return goBackTo(/^tab\./); })
                .then(function () { return screenStep('S10-nation', function () { svc('$state').go('nation'); return sleep(2000); }); })
                .then(back)
                .then(function () { return screenStep('S11-nation-air', function () { svc('$state').go('nation-air'); return sleep(2000); }); })
                .then(back)
                .then(function () { return screenStep('S12-bulletin', function () { svc('$state').go('kma-special'); return sleep(2000); }); })
                .then(back)
                .then(function () { return screenStep('S14-guide', function () { svc('$state').go('guide'); return sleep(2000); }); })
                .then(function () { click(byNg('onClose()'), 'guide-close'); return sleep(1500); })
                .then(function () { if (!/^tab\./.test(stateName())) { return go('tab.forecast'); } })
                .then(function () { return screenStep('S09-push', function () { click(byNg('goPushPage()'), 'bell'); return sleep(2000); }); });
        } },
        { name: 'L2_layout_launch_popup', run: function () {
            // Warm launch: no popup is expected since the update-info popup (O05) was removed.
            return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab')
                .then(function () { return screenStep('S03-warm', function () { return sleep(800); }); });
        } },
    ];
    if (window.TW_HARNESS_MODE === 'layout') { S = LAYOUT; }

    // ---------- world mode (window.TW_HARNESS_MODE === 'world'): add Tokyo through search ----------
    function worldCity(query, tag) {
        var before = 0;
        return Promise.resolve()
            .then(function () { return waitFor(function () { return /^tab\./.test(stateName()); }, 20000, 'tab'); })
            .then(function () { return idle(30000); })
            .then(function () { return tab(0); })
            .then(function () {
                before = cityRows().length;
                typeInto(find('#searchInput'), query);
                return waitFor(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible).length > 0; }, 15000, 'search-results-' + tag);
            })
            .then(function () { return shot(tag + '-search'); })
            .then(function () {
                var first = all('[ng-click="OnSelectResult(result)"]').filter(visible)[0];
                emit('STEP', 'first result "' + ((first && first.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 80) + '"');
                return tapResult(function () { return all('[ng-click="OnSelectResult(result)"]').filter(visible)[0]; }, 'search-result-' + tag + '[0]')
                    .then(function () { return sleep(2000); }).then(function () { return idle(30000); }).then(function () { return sleep(1500); });
            })
            .then(function () {
                var p = find('.popup-container .popup-buttons button');
                if (p) {
                    var body = ((find('.popup-container .popup-body') || {}).textContent || '').trim();
                    check('world-weather ' + tag, false, 'error popup "' + body + '" state=' + stateName());
                    return shot(tag + '-error').then(popupOk);
                }
                var req = lastHttp(/\/weather\/v000903\/coord\//);
                check('world-weather ' + tag, stateName() === 'tab.forecast', stateName() + ' ' + (req || 'no request'));
                var title = ((find('.bar .title') || {}).textContent || '').trim();
                emit('STEP', tag + ' title "' + title + '"');
                forecastRendered(tag + '-hourly');
                return shot(tag + '-hourly')
                    .then(function () { click(byNg('clickExpander()'), 'expander'); return sleep(1500); })
                    .then(function () {
                        var vc = find('a', function (el) { return /Visual Crossing/.test(el.textContent) && visible(el); });
                        check('vc-attribution ' + tag, !!vc, vc ? vc.textContent.trim() : 'no Visual Crossing link');
                        return shot(tag + '-expanded');
                    })
                    .then(function () { return tab(2); })
                    .then(function () { forecastRendered(tag + '-daily'); return shot(tag + '-daily'); })
                    .then(function () { return tab(3); })
                    .then(function () { checkImages(tag + '-air'); return shot(tag + '-air'); })
                    .then(function () { return tab(0); })
                    .then(function () { check('city-added ' + tag, cityRows().length === before + 1, before + '->' + cityRows().length); return shot(tag + '-favorites'); });
            });
    }
    if (window.TW_HARNESS_MODE === 'world') {
        S = [S[0], { name: 'W2_world_tokyo', run: function () { return worldCity(/iPhone|iPad/.test(navigator.userAgent) ? '도쿄' : 'Tokyo', 'tokyo'); } }];
    }

    // The update-info popup (O05) was removed, so a popup after a warm launch is a failure. Record it and
    // close it like a user would so the scenario can continue.
    function dismissLaunchPopup(i) {
        // S01 shows only its own access popup; scenarios check it.
        if (i === 0 || stateName() === 'start') { return Promise.resolve(); }
        return waitFor(function () { return !!find('.popup-container .popup-buttons button'); }, 4000)
            .then(function (shown) {
                if (!shown) { emit('STEP', 'no launch popup'); return; }
                var title = (find('.popup-container .popup-title') || {}).textContent || '';
                check('no-launch-popup', false, 'launch popup "' + title.trim() + '"');
                return (i === 1 ? shot('launch-popup') : Promise.resolve()).then(function () {
                    var bs = all('.popup-container .popup-buttons button').filter(visible);
                    click(bs[bs.length - 1], 'launch-popup-close');
                    return sleep(1000);
                });
            });
    }

    // Exceptions the app catches itself only reach Util.ga.trackException; surface them too.
    function hookTrackException() {
        var ga = svc('Util').ga;
        var orig = ga.trackException;
        ga.trackException = function (description, fatal) {
            var d = description instanceof Error ? description.message + ' | ' + String(description.stack || '').split('\n').slice(0, 2).join(' | ') : stringify([description]);
            emit('ERR', 'caught ' + d + ' @' + location.hash);
            return orig.apply(this, arguments);
        };
    }

    // ---------- runner ----------
    var KEY = 'twHarnessRun';
    function run() {
        var st = {};
        try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { st = {}; }
        var i = st.i || 0;
        if (i >= S.length) { emit('ALLDONE', 'scenarios=' + S.length); return; }
        localStorage.setItem(KEY, JSON.stringify({ i: i + 1 }));   // advance first: a crash must not loop
        emit('STEP', 'scenario ' + i + ' ' + S[i].name + ' start state=' + stateName());
        dismissLaunchPopup(i).then(function () { return S[i].run(); }).then(function () {
            emit('END', i + ' ' + S[i].name + ' state=' + stateName());
        }, function (e) {
            emit('ERR', 'harness ' + S[i].name + ' ' + (e && (e.stack || e.message) || e));
            emit('END', i + ' ' + S[i].name + ' aborted');
        });
    }

    var started = false;
    function tryStart() {
        if (started) { return; }
        var body = document.body;
        if (!ready || !window.angular || !body) { return setTimeout(tryStart, 300); }
        inj = angular.element(body).injector();
        if (!inj) { return setTimeout(tryStart, 300); }
        started = true;
        try { hookTrackException(); } catch (e) { emit('ERR', 'harness hookTrackException ' + e.message); }
        setTimeout(run, 3000);
    }
    document.addEventListener('deviceready', function () { setTimeout(tryStart, 500); }, false);
})();
