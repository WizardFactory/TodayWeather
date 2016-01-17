#!/usr/bin/env node

var fs = require('fs');
var path = require('path');

var _ = require('lodash');
var et = require('elementtree');

var rootdir = path.resolve(__dirname, '../../');

(function() {
    if (rootdir) {
        // go through each of the platform directories that have been prepared
        var platforms = _.filter(fs.readdirSync('platforms'), function(file) {
            return fs.statSync(path.resolve('platforms', file)).isDirectory();
        });

        _.each(platforms, function(platform) {
            try {
                platform = platform.trim().toLowerCase();
                if (platform === "android") {
                    var file = path.join(process.argv[2], "resources/android/strings.json");
                    var strings = JSON.parse(fs.readFileSync(file, 'utf8'));

                    for (var lang in strings) {
                        var srcfile = path.join(process.argv[2], "platforms/android/res/values/strings.xml");
                        var destfile = path.join(process.argv[2], "platforms/android/res/values-" + lang + "/strings.xml");
                        var destdir = path.dirname(destfile);
                        if (fs.existsSync(srcfile)) {
                            if (!fs.existsSync(destdir)) {
                                fs.mkdirSync(destdir);
                            }

                            var xmlData = new et.ElementTree(et.XML(fs.readFileSync(srcfile, 'utf-8')));
                            for (var key in strings[lang]) {
                                var value = xmlData.findall('string[@name=\'' + key + '\']/');
                                value[0].text = strings[lang][key];
                            }

                            var result = xmlData.write({'xml_declaration': true, 'indent': true});
                            fs.writeFileSync(destfile, result, 'utf8');
                        }
                    }
                }
                else if (platform === "ios") {

                }
            } catch (e) {
                process.stdout.write(e);
            }
        });
    }
})();