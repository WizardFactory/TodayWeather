

angular.module('service.branch', [])
    .factory('Branch', function($rootScope, Util, WeatherInfo) {
        var obj = {};

        function _createContentReference(callback) {
            var properties = {
                canonicalIdentifier: "content/123",
                canonicalUrl: "https://example.com/content/123",
                title: "Content 123 Title",
                contentDescription: "Content 123 Description " + Date.now(),
                contentImageUrl: "http://lorempixel.com/400/400/",
                contentIndexingMode: "public"
            };

            // create a branchUniversalObj variable to reference with other Branch methods
            Branch.createBranchUniversalObject(properties)
                .then(function(res) {
                    callback(null, res);
                })
                .catch(function(err) {
                    callback(err);
                });
        }

        obj.createDeepLink = function(callback) {
            if (this.inited === false) {
                console.log('branch is not init');
                return;
            }

            // optional fields
            var analytics = {
                channel: "facebook",
                feature: "onboarding",
                campaign: "content 123 launch",
                stage: "new user",
                tags: ["one", "two", "three"]
            };

            // optional fields
            var properties = {
                $deeplink_path: "content/123",
                custom_string: "data",
                custom_integer: Date.now(),
                custom_boolean: true
            };

            this.branchUniversalObj.generateShortUrl(analytics, properties)
                .then(function(res) {
                    callback(null, JSON.stringify(res.url));
                })
                .catch(function(err) {
                    callback(err);
                });
        };

        /**
         *
         * @param channel facebook, twitter, kakao,..
         */
        obj.shareDeepLink = function (channel) {
            if (this.inited === false) {
                console.log('branch is not init');
                return;
            }

            // optional fields
            var analytics = {
                channel: channel,
                feature: "onboarding",
                campaign: "content 123 launch",
                stage: "new user",
                tags: ["one", "two", "three"]
            };

            // optional fields
            var properties = {
                custom_string: "data",
                custom_integer: Date.now(),
                custom_boolean: true
            };

            var message = "Check out this link";

            branchUniversalObj.showShareSheet(analytics, properties, message);
        };

        function getDefaultPage() {
            var startupPage = $rootScope.settingsInfo.startupPage;
            var str;
            if (startupPage === "0") { //시간별날씨
                str = 'tab.forecast';
            } else if (startupPage === "1") { //일별날씨
                str = 'tab.dailyforecast';
            } else if (startupPage === "2") { //즐겨찾기
                str = 'tab.search';
            } else if (startupPage === "3") { //대기정보
                str = 'tab.air';
            } else if (startupPage === "4") { //날씨
                str = 'tab.weather';
            } else {
                console.error('unknown page:'+startupPage);
                if (clientConfig.package === 'todayWeather') {
                    str = 'tab.forecast';
                }
                else if (clientConfig.package === 'todayAir') {
                    str = 'tab.air';
                }
                else {
                    str = 'tab.forecast';
                }
            }

            return str;
        }

        obj.branchInit = function() {
            if (window.Branch == undefined)  {
                return;
            }

            // for development and debugging only
            Branch.setDebug(true);

            // for GDPR compliance (can be called at anytime)
            // Branch.disabledTracking(false);

            // for better Android matching
            // if (clientConfig.package === 'todayWeather') {
            //     Branch.setCookieBasedMatching("twa.app.link");
            // }
            // else if (clientConfig.package === 'todayAir') {
            //     Branch.setCookieBasedMatching("ta.app.link");
            // }

            var self = this;

            Branch.initSession()
                .then(function success(res) {
                    var fav;
                    if (res["+clicked_branch_link"]) {
                        console.log("Open app with a Branch deep link: " + JSON.stringify(res));
                        fav = res.fav;

                        // Branch quick link: https://cordova.app.link/uJcOH1IFpM
                        // Branch web link: https://cordova-alternate.app.link/uJcOH1IFpM
                        // Branch dynamic link: https://cordova.app.link?tags=one&tags=two&tags=three&channel=Copy&feature=onboarding&stage=new+user&campaign=content+123+launch&type=0&duration=0&source=android&data
                        // Branch uri scheme: branchcordova://open?link_click_id=link-500015444967786346
                        // Branch android intent: intent://open?link_click_id=518106399270344237#Intent;scheme=looprocks;package=com.eneff.branch.cordovatestbed;S.browser_fallback_url=https%3A%2F%2Fcordova.app.link%2FuJcOH1IFpM%3F__branch_flow_type%3Dchrome_deepview%26__branch_flow_id%3D518106399312287278;S.market_referrer=link_click_id-518106399270344237%26utm_source%3DCopy%26utm_campaign%3Dcontent%20123%20launch%26utm_feature%3Donboarding;S.branch_data=%7B%22~feature%22%3A%22onboarding%22%2C%22this_is%22%3A%22true%22%2C%22custom_string%22%3A%22data%22%2C%22testing%22%3A%22123%22%2C%22%24publicly_indexable%22%3A%22false%22%2C%22%24desktop_url%22%3A%22http%3A%2F%2Fwww.example.com%2Fdesktop%22%2C%22%24one_time_use%22%3Afalse%2C%22custom_object%22%3A%22%7B%5C%5C%5C%22random%5C%5C%5C%22%3A%5C%5C%5C%22dictionary%5C%5C%5C%22%7D%22%2C%22~id%22%3A%22517795540654792902%22%2C%22~campaign%22%3A%22content%20123%20launch%22%2C%22%2Bclick_timestamp%22%3A1524764418%2C%22%2Burl%22%3A%22https%3A%2F%2Fcordova.app.link%2FuJcOH1IFpM%22%2C%22custom_boolean%22%3A%22true%22%2C%22custom%22%3A%22data%22%2C%22source%22%3A%22android%22%2C%22%24og_image_url%22%3A%22http%3A%2F%2Florempixel.com%2F400%2F400%2F%22%2C%22%2Bdomain%22%3A%22cordova.app.link%22%2C%22custom_integer%22%3A%221524690301794%22%2C%22~tags%22%3A%5B%22one%22%2C%22two%22%2C%22three%22%5D%2C%22custom_array%22%3A%22%5B1%2C2%2C3%2C4%2C5%5D%22%2C%22~channel%22%3A%22Copy%22%2C%22~creation_source%22%3A2%2C%22%24canonical_identifier%22%3A%22content%2F123%22%2C%22%24og_title%22%3A%22Content%20123%20Title%22%2C%22%24og_description%22%3A%22Content%20123%20Description%201524690296449%22%2C%22%24identity_id%22%3A%22453670943617990547%22%2C%22~stage%22%3A%22new%20user%22%2C%22%2Bclicked_branch_link%22%3Atrue%2C%22%2Bmatch_guaranteed%22%3Atrue%2C%22%2Bis_first_session%22%3Afalse%7D;B.branch_intent=true;end
                        // Branch android app link (device controlled): https://cordova.app.link/uJcOH1IFpM
                        // Branch ios universal link (device controlled): https://cordova.app.link/uJcOH1IFpM
                    } else if (res["+non_branch_link"]) {
                        console.log("Open app with a non Branch deep link: " + JSON.stringify(res));
                        // Competitor uri scheme: anotherurischeme://hello=world
                        fav = res["+non_branch_link"].replace('todayweather://', '');
                    } else {
                        console.log("Open app organically");
                        // Clicking on app icon or push notification
                    }

                    self.inited = true;
                    console.log('fav:',fav);
                    if (fav) {
                        WeatherInfo.setCityIndex(fav);
                        $rootScope.$broadcast('reloadEvent', 'deeplink');
                        console.log({deepLinkFav:fav});
                        Util.ga.trackEvent('plugin', 'info', 'deepLinkMatch '+fav);
                    }
                })
                .catch(function error(err) {
                    Util.ga.trackException(err.message, false);
                });

            // var self = this;
            // _createContentReference(function (err, res) {
            //     if (err) {
            //         alert("create content reference Error: " + JSON.stringify(err));
            //         return;
            //     }
            //     self.branchUniversalObj = res;
            //     setTimeout(function () {
            //         if (ionic.Platform.isIOS()) {
            //             self.branchUniversalObj
            //                 .listOnSpotlight()
            //                 .then(function (res) {
            //                     console.log("list on spot light Response: " + JSON.stringify(res));
            //                 })
            //                 .catch(function (err) {
            //                     alert("Error: " + JSON.stringify(err));
            //                 });
            //         }
            //         self.branchUniversalObj
            //             .registerView()
            //             .then(function(res) {
            //                 console.log("register view Response: " + JSON.stringify(res));
            //             })
            //             .catch(function(err) {
            //                 alert("Error: " + JSON.stringify(err));
            //             });
            //     }, 0);
            // });
        };

        obj.trackUser = function (userId) {
            if (this.inited === false) {
                console.log('track user : branch is not init');
                return;
            }

            Branch.setIdentity(userId)
                .then(function(res) {
                    console.log("set identity Response: " + JSON.stringify(res));
                })
                .catch(function(err) {
                    Util.ga.trackException(err.message, false);
                });
        };

        obj.trackEvent = function (eventName, metaData) {
            if (this.inited === false) {
                console.log('track event : branch is not init');
                return;
            }

            Branch.userCompletedAction(eventName, metaData)
                .then(function(res) {
                    console.log("Response: " + JSON.stringify(res));
                })
                .catch(function(err) {
                    Util.ga.trackException(err.message, false);
                });
        };

        /**
         *
         * @param {string} productId
         */
        obj.trackCommerce = function (productId) {
            if (this.inited === false) {
                console.log('track commerce : branch is not init');
                return;
            }

            // only revenue is required
            var event = {
                revenue: 1,
                products: [ { sku: productId } ]
            };

            Branch.sendCommerceEvent(event, metadata)
                .then(function(res) {
                    console.log(res);
                    console.log("Response: " + JSON.stringify(res));
                })
                .catch(function(err) {
                    console.error(err);
                    console.log("Error: " + JSON.stringify(err.message));
                });
        };

        //Referral points are obtained from events triggered by users from rules created

        return obj;
    });

