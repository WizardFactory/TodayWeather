(function () {
    function post(path, value) {
        return fetch(path, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(value)});
    }
    window.__renderErrors = [];
    ['log', 'warn', 'error'].forEach(function (level) {
        var original = console[level];
        console[level] = function () {
            var args = Array.prototype.map.call(arguments, function (a) {
                if (a instanceof Error) return {message:a.message, stack:a.stack};
                try { return JSON.parse(JSON.stringify(a)); } catch (_) { return String(a); }
            });
            post('/__event', {level:level, args:args});
            original.apply(console, arguments);
        };
    });
    window.addEventListener('error', function (e) {
        var detail = {message:e.message, src:e.filename || (e.target && (e.target.src || e.target.href)), line:e.lineno};
        window.__renderErrors.push(detail);
        post('/__event', {type:'error', detail:detail});
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        window.__renderErrors.push(String(e.reason));
        post('/__event', {type:'unhandledrejection', message:String(e.reason)});
    });
    // No provider SDK or credentials are used for this layout-only test.
    window.google = {maps:{places:{AutocompleteService:function () {
        this.getPlacePredictions = function (_, callback) { callback([], 'ZERO_RESULTS'); };
    }, PlacesServiceStatus:{OK:'OK', ZERO_RESULTS:'ZERO_RESULTS'}}}};
    window.alert = function (message) { post('/__event', {type:'alert', message:String(message)}); };
    // prepare.py --locale replaces this value. Region derivation reads navigator.languages.
    var HARNESS_LOCALE = 'ko-KR';
    Object.defineProperty(navigator, 'language', {get:function () { return HARNESS_LOCALE; }});
    Object.defineProperty(navigator, 'languages', {get:function () { return [HARNESS_LOCALE]; }});
    setInterval(function () {
        fetch('/__command').then(function (r) { return r.json(); }).then(function (command) {
            if (!command) return;
            try {
                Promise.resolve((0, eval)(command.code)).then(function (value) {
                    post('/__result', {id:command.id, value:value === undefined ? null : value});
                }, function (e) { post('/__result', {id:command.id, error:String(e), stack:e.stack}); });
            } catch (e) { post('/__result', {id:command.id, error:String(e), stack:e.stack}); }
        });
    }, 500);
})();
