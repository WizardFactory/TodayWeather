/*
 * iOS only (#2990): shows the App Tracking Transparency choice in the side menu and, while tracking is not allowed, a
 * notice at the end of the hourly, daily and air pages. Both open the app's page in iOS Settings.
 * scripts/ios-tracking-settings.js copies this file into platforms/ios/www after prepare; client/www and the Android
 * app never contain it. It never requests tracking permission: the status comes from the read-only twAdPrivacyState
 * action that scripts/ios-ad-privacy.js adds to the AdMob plugin (#2945).
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root && root.angular) { api.register(root.angular); }
}(typeof window !== 'undefined' ? window : this, function () {
    'use strict';
    var KNOWN = ['authorized', 'denied', 'restricted', 'not_determined'];

    /** What the menu row and the page notice show for an ATT status name (spec R2). */
    function visibility(status) {
        var known = KNOWN.indexOf(status) !== -1;
        return {
            row: known && (status === 'authorized' || status === 'denied'),
            allowed: status === 'authorized',
            notice: status === 'denied'
        };
    }

    function register(angular) {
        angular.module('starter')
            .factory('twTrackingStatus', ['$rootScope', '$window', function ($rootScope, $window) {
                var state = {status: 'unavailable'};

                // iOS ends the app when the switch changes in Settings, so a start reads the new value. Resume covers a
                // return without a change; the first banner follows the consent flow and the ATT answer.
                function read() {
                    var cordova = $window.cordova;
                    function apply(result) {
                        var status = result && KNOWN.indexOf(result.att_status) !== -1 ? result.att_status : 'unavailable';
                        $rootScope.$evalAsync(function () { state.status = status; });
                    }
                    if (!cordova || !cordova.exec) { return; }
                    try {
                        cordova.exec(apply, function () { apply(); }, 'emiAdmobPlugin', 'twAdPrivacyState', []);
                    } catch (e) {
                        apply();
                    }
                }

                function openSettings() {
                    var cordova = $window.cordova;
                    var diagnostic = cordova && cordova.plugins && cordova.plugins.diagnostic;
                    function failed(cause) {
                        ($window.console || console).warn({component: 'privacy', operation: 'tracking_settings',
                            cause: cause, result: 'not_opened'});
                    }
                    if (!diagnostic || !diagnostic.switchToSettings) { failed('unavailable'); return; }
                    try {
                        diagnostic.switchToSettings(function () {}, function () { failed('plugin_error'); });
                    } catch (e) {
                        failed('exception');
                    }
                }

                ['deviceready', 'resume', 'on.banner.load'].forEach(function (name) {
                    $window.document.addEventListener(name, read, false);
                });
                $rootScope.$on('$ionicView.enter', read);
                return {state: state, read: read, openSettings: openSettings};
            }])
            .run(['twTrackingStatus', function () {}])
            .directive('twTrackingRow', ['twTrackingStatus', function (tracking) {
                return {
                    restrict: 'E',
                    replace: true,
                    scope: {},
                    template: '<button class="item button button-clear button-block tw-tracking-row" ng-show="view().row" ng-click="open()">' +
                        "{{'LOC_TRACKING_PERMISSION'|translate}} · " +
                        "{{(view().allowed ? 'LOC_TRACKING_ALLOWED' : 'LOC_TRACKING_NOT_ALLOWED')|translate}}</button>",
                    link: function (scope) {
                        scope.view = function () { return visibility(tracking.state.status); };
                        scope.open = tracking.openSettings;
                    }
                };
            }])
            .directive('twTrackingNotice', ['twTrackingStatus', function (tracking) {
                return {
                    restrict: 'E',
                    scope: {},
                    template: '<div class="card tw-tracking-notice" ng-if="view().notice">' +
                        "<p>{{'LOC_TRACKING_NOTICE'|translate}}</p>" +
                        '<button class="button button-small button-outline tw-tracking-settings" ng-click="open()">' +
                        "{{'LOC_TRACKING_OPEN_SETTINGS'|translate}}</button></div>",
                    link: function (scope) {
                        scope.view = function () { return visibility(tracking.state.status); };
                        scope.open = tracking.openSettings;
                    }
                };
            }]);
    }

    return {visibility: visibility, register: register};
}));
