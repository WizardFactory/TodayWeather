var gulp = require('gulp');
var gutil = require('gulp-util');
var bower = require('bower');
var sass = require('gulp-sass');
var cleanCss = require('gulp-clean-css');
var rename = require('gulp-rename');
var sh = require('shelljs');
var fs = require('fs');

var shell = require('gulp-shell');

var deleteLines = require('gulp-delete-lines');

var json = JSON.parse(fs.readFileSync('./tw.package.json'));

var BILLING_KEY = process.env.BILLING_KEY || '111';
var SENDER_ID = process.env.SENDER_ID || '111';
var FABRIC_API_KEY = process.env.FABRIC_API_KEY || '111';
var FABRIC_API_SECRET = process.env.FABRIC_API_SECRET || '111';

var paths = {
  sass: ['./scss/**/*.scss']
};

gulp.task('default', ['sass']);

gulp.task('sass', function(done) {
  gulp.src('./scss/ionic.app.scss')
    .pipe(sass({
      errLogToConsole: true
    }))
    .pipe(gulp.dest('./www/css/'))
    .pipe(cleanCss({
      keepSpecialComments: 0
    }))
    .pipe(rename({ extname: '.min.css' }))
    .pipe(gulp.dest('./www/css/'))
    .on('end', done);
});

gulp.task('watch', ['sass'], function() {
  gulp.watch(paths.sass, ['sass']);
});

gulp.task('install', ['git-check'], function() {
  return bower.commands.install()
    .on('log', function(data) {
      gutil.log('bower', gutil.colors.cyan(data.id), data.message);
    });
});

gulp.task('build', shell.task([
  'ionic state reset',
  'cp -a ../ios platforms/',
  'ionic state restore --plugins',
  'yarn install',
  'bower install',
  'gulp sass',
  'ionic build'
]));

gulp.task('build_tw_ios', shell.task([
  'cp tw.package.json package.json',
  'cp tw.config.xml config.xml',
  'cp tw.ads.client.config.js www/client.config.js',
  'rm -rf resources;cp -a tw.resources resources',
  'cp package.json import_today_ext/package.json.backup',
  'cp import_today_ext/tw.empty.package.json package.json',
  'ionic state reset',
  'cp -a ../tw.ios/* platforms/ios/',
  'mv import_today_ext/package.json.backup package.json',
  'ionic state restore --plugins',
  'cordova plugin add cordova-plugin-inapppurchase',
  'cp -f www/js/controller.purchase.alexdisler.js www/js/controller.purchase.js',
  'yarn install',
  'bower install',
  'gulp sass',
  'ionic build ios'
]));

gulp.task('build_ta_ios', shell.task([
  'cp ta.package.json package.json',
  'cp ta.config.xml config.xml',
  'cp ta.ads.client.config.js www/client.config.js',
  'rm -rf resources;cp -a ta.resources resources',
  'cp package.json import_today_ext/package.json.backup',
  'cp import_today_ext/ta.empty.package.json package.json',
  'ionic state reset',
  'cp -a ../ta.ios/* platforms/ios/',
  'mv import_today_ext/package.json.backup package.json',
  'ionic state restore --plugins',
  'cordova plugin add cordova-plugin-inapppurchase',
  'cp -f www/js/controller.purchase.alexdisler.js www/js/controller.purchase.js',
  'yarn install',
  'bower install',
  'gulp sass',
  'ionic build ios'
]));

gulp.task('build_tw_android', shell.task([
  'cp tw.package.json package.json',
  'cp tw.config.xml config.xml',
  'cp tw.ads.client.config.js www/client.config.js',
  'rm -rf resources;cp -a tw.resources resources',
  'ionic state reset',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="'+BILLING_KEY+'"',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',
  'yarn install',
  'bower install',
  'gulp sass',
  'ionic build android'
]));

gulp.task('build_ta_android', shell.task([
  'cp ta.package.json package.json',
  'cp ta.config.xml config.xml',
  'cp ta.ads.client.config.js www/client.config.js',
  'rm -rf resources;cp -a ta.resources resources',
  'ionic state reset',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="'+BILLING_KEY+'"',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',
  'yarn install',
  'bower install',
  'gulp sass',
  'ionic build android'
]));

gulp.task('release-tw-min20-android-nonpaid', shell.task([
  'ionic state reset',
  'cordova platform rm ios',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add https://github.com/WizardFactory/phonegap-plugin-push.git#1.11.1 --variable SENDER_ID="'+SENDER_ID+'"',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="'+FABRIC_API_KEY+'" --variable FABRIC_API_SECRET="'+FABRIC_API_SECRET+'"',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="'+BILLING_KEY+'"',
  'yarn install',
  //'cd node_modules/cordova-uglify/;yarn install',
  'bower install',
  'gulp sass',

  //'cp ads.playstore.tw.client.config.js www/tw.client.config.js',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',

  'cp config-androidsdk20.xml config.xml',
  'ionic build android --release',
  'cp platforms/android/build/outputs/apk/android-release.apk ./TodayWeather_ads_playstore_v'+json.version+'_min20.apk'
]));

gulp.task('release-tw-min16-android-nonpaid', shell.task([
  'ionic state reset',
  'cordova platform rm ios',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add https://github.com/WizardFactory/phonegap-plugin-push.git#1.11.1 --variable SENDER_ID="'+SENDER_ID+'"',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="'+FABRIC_API_KEY+'" --variable FABRIC_API_SECRET="'+FABRIC_API_SECRET+'"',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="'+BILLING_KEY+'"',
  'yarn install',
  //'cd node_modules/cordova-uglify/;yarn install',
  'bower install',
  'gulp sass',

  //'cp ads.playstore.tw.client.config.js www/tw.client.config.js',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',

  'cp config-androidsdk16.xml config.xml',
  'cordova plugin add cordova-plugin-crosswalk-webview',
  'ionic build android --release',
  'cp -a platforms/android/build/outputs/apk/android-armv7-release.apk ./TodayWeather_ads_playstore_v'+json.version+'_min16.apk'
]));

gulp.task('release-tw-android-nonpaid', shell.task([
  'ionic state reset',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add https://github.com/WizardFactory/phonegap-plugin-push.git#1.11.1 --variable SENDER_ID="'+SENDER_ID+'"',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="'+FABRIC_API_KEY+'" --variable FABRIC_API_SECRET="'+FABRIC_API_SECRET+'"',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="'+BILLING_KEY+'"',
  'yarn install',
  'bower install',
  'gulp sass',

  //'cp ads.playstore.tw.client.config.js www/tw.client.config.js',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',

  'cp config-androidsdk20.xml config.xml',
  'ionic build android --release',
  'cp platforms/android/build/outputs/apk/android-release.apk ./TodayWeather_ads_playstore_v'+json.version+'_min20.apk',

  'cp config-androidsdk16.xml config.xml',
  'cordova plugin add cordova-plugin-crosswalk-webview',
  'ionic build android --release',
  'cp -a platforms/android/build/outputs/apk/android-armv7-release.apk ./TodayWeather_ads_playstore_v'+json.version+'_min16.apk',

  //'cp config-androidsdk14.xml config.xml',
  //'cordova plugin add cordova-plugin-crosswalk-webview@1.8.0',
  //'ionic build android --release',
  //'cp -f platforms/android/build/outputs/apk/android-armv7-release.apk ./',
  //'~/Library/Android/sdk/build-tools/23.0.3/zipalign -v 4 android-armv7-release.apk TodayWeather_ads_playstore_v'+json.version+'_min14.apk',
]));

gulp.task('release-tw-ios-nonpaid', shell.task([
  'cp package.json import_today_ext/package.json.backup',
  'cp import_today_ext/tw.empty.package.json package.json',
  'ionic state reset',
  'cp -a ../ios platforms/',
  'mv import_today_ext/package.json.backup package.json',
  'ionic state restore --plugins',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add phonegap-plugin-push@1.8.4 --variable SENDER_ID="'+SENDER_ID+'"',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="'+FABRIC_API_KEY+'" --variable FABRIC_API_SECRET="'+FABRIC_API_SECRET+'"',
  'cordova plugin add cordova-plugin-inapppurchase',
  'cp -f www/js/controller.purchase.alexdisler.js www/js/controller.purchase.js',
  'yarn install',
  'bower install',
  'gulp sass',
  //'cp ads.ios.tw.client.config.js www/tw.client.config.js',
  'ionic build ios --release'
  //'xcodebuild -project TodayWeather.xcodeproj -scheme TodayWeather -configuration Release clean archive'
  //'xcodebuild -exportArchive -archivePath ~/Library/Developer/Xcode/Archives/2016-10-27/TodayWeather\ 2016.\ 10.\ 27.\ 13.48.xcarchive -exportPath TodayWeather.ipa''
  //'/Applications/Xcode.app/Contents/Applications/Application\ Loader.app/Contents/Frameworks/ITunesSoftwareService.framework/Versions/A/Support/altool --validate-app -f TodayWeather.ipa -u kimalec7@gmail.com'
  //'/Applications/Xcode.app/Contents/Applications/Application\ Loader.app/Contents/Frameworks/ITunesSoftwareService.framework/Versions/A/Support/altool --upload-app -f TodayWeather.ipa -u kimalec7@gmail.com'
]));

/**
 * it does not works perfectly
 */
gulp.task('rmplugins', function () {
  var pluginList = json.cordovaPlugins;
  pluginList = pluginList.map(function (plugin) {
    if (typeof plugin === 'string') {
      var index = plugin.indexOf('@');
      if (index != -1) {
        return plugin.slice(0,index);
      }
      else {

        return plugin;
      }
    }
    else {
      if (plugin.hasOwnProperty('id')) {
        return plugin.id;
      }
    }
  });
  //console.log(pluginList);
  var shellLists=[];
  for (var i=pluginList.length-1; i>=0; i--) {
    shellLists.push('cordova plugin rm '+pluginList[i]);
  }
  return gulp.src('./').pipe(shell(shellLists));
});

gulp.task('git-check', function(done) {
  if (!sh.which('git')) {
    console.log(
      '  ' + gutil.colors.red('Git is not installed.'),
      '\n  Git, the version control system, is required to download Ionic.',
      '\n  Download git here:', gutil.colors.cyan('http://git-scm.com/downloads') + '.',
      '\n  Once git is installed, run \'' + gutil.colors.cyan('gulp install') + '\' again.'
    );
    process.exit(1);
  }
  done();
});
