#!/bin/sh
cp package.json import_today_ext/package.json.backup
cp import_today_ext/ta.empty.package.json package.json
ionic state reset
cordova plugin add https://github.com/DavidStrausz/cordova-plugin-today-widget.git
cp config.xml import_today_ext/config.xml.backup
cp import_today_ext/ta.import.config.xml config.xml
cordova platform rm ios;cordova platform add ios
#cordova plugin rm cordova-plugin-today-widget
#cp -a ../ta.ios/TodayAir/*.lproj platforms/ios/TodayAir/
#mv import_today_ext/package.json.backup package.json
#mv import_today_ext/config.xml.backup config.xml
#open platforms/ios/TodayAir.xcodeproj
