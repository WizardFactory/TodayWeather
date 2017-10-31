var gulp = require('gulp');
var gutil = require('gulp-util');
var bower = require('bower');
var concat = require('gulp-concat');
var sass = require('gulp-sass');
var minifyCss = require('gulp-minify-css');
var rename = require('gulp-rename');
var sh = require('shelljs');
var fs = require('fs');

var shell = require('gulp-shell');

var deleteLines = require('gulp-delete-lines');

var json = JSON.parse(fs.readFileSync('./package.json'));

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
    .pipe(minifyCss({
      keepSpecialComments: 0
    }))
    .pipe(rename({ extname: '.min.css' }))
    .pipe(gulp.dest('./www/css/'))
    .on('end', done);
});

gulp.task('watch', function() {
  gulp.watch(paths.sass, ['sass']);
});

gulp.task('install', ['git-check'], function() {
  return bower.commands.install()
    .on('log', function(data) {
      gutil.log('bower', gutil.colors.cyan(data.id), data.message);
    });
});

gulp.task('rm-prepare-app-pre', function () {
  gulp.src('./plugins/cordova-plugin-app-preferences/bin/after_prepare.js')
      .pipe(deleteLines({
        'filters': [
          /platforms\.android/i
        ]
      }))
      .pipe(gulp.dest('./plugins/cordova-plugin-app-preferences/bin'));

  gulp.src('./plugins/cordova-plugin-app-preferences/bin/lib/android.js')
      .pipe(deleteLines({
        'filters': [
          /fs.unlink\('platforms/i
        ]
      }))
      .pipe(gulp.dest('./plugins/cordova-plugin-app-preferences/bin/lib'));

});

gulp.task('build', shell.task([
  'ionic state reset',
  'cp -a ../ios platforms/',
  'ionic state restore --plugins',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'ionic build'
]));

gulp.task('build_ios', shell.task([
  'ionic state reset',
  'gulp rmplugins',
  'cp -a ../ios platforms/',
  'ionic state restore --plugins',
  'cordova plugin add cordova-plugin-app-preferences',
  'cordova plugin add cordova-plugin-inapppurchase',
  'cp -f www/js/controller.purchase.alexdisler.js www/js/controller.purchase.js',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'ionic build ios'
]));

gulp.task('build_android', shell.task([
  'ionic state reset',
  'cordova plugin add cordova-plugin-app-preferences',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="111"',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'ionic build android'
]));

gulp.task('release-android-nonpaid', shell.task([
  'cp config-androidsdk20.xml config.xml',
  'cp ads.onestore.tw.client.config.js www/tw.client.config.js',
  'ionic state reset',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add https://github.com/WizardFactory/phonegap-plugin-push.git#1.11.1 --variable SENDER_ID="111"',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="1111" --variable FABRIC_API_SECRET="111"',
  'cordova plugin add cordova-plugin-app-preferences',
  'cordova plugin add cc.fovea.cordova.purchase  --variable BILLING_KEY="1111"',
  'cp -f www/js/controller.purchase.j3k0.js www/js/controller.purchase.js',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'cp ads.playstore.tw.client.config.js www/tw.client.config.js',
  'ionic build android --release',
  'cp platforms/android/build/outputs/apk/android-release.apk ./',
  '~/Library/Android/sdk/build-tools/23.0.3/zipalign -v 4 android-release.apk TodayWeather_ads_playstore_v'+json.version+'_min19.apk',

  'cp build.gradle platforms/android/',
  'cp config-androidsdk16.xml config.xml',
  'cordova plugin add cordova-plugin-crosswalk-webview',
  'ionic build android --release',
  'cp -a platforms/android/build/outputs/apk/android-armv7-release.apk ./',
  '~/Library/Android/sdk/build-tools/23.0.3/zipalign -v 4 android-armv7-release.apk TodayWeather_ads_playstore_v'+json.version+'_min16.apk',

  //'cp config-androidsdk14.xml config.xml',
  //'cordova plugin add cordova-plugin-crosswalk-webview@1.8.0',
  //'ionic build android --release',
  //'cp -f platforms/android/build/outputs/apk/android-armv7-release.apk ./',
  //'~/Library/Android/sdk/build-tools/23.0.3/zipalign -v 4 android-armv7-release.apk TodayWeather_ads_playstore_v'+json.version+'_min14.apk',
]));

gulp.task('release-ios-nonpaid', shell.task([
  'ionic state reset',
  'gulp rmplugins',
  'cp -a ../ios platforms/',
  'ionic state restore --plugins',
  'cordova plugin rm cordova-plugin-console',
  'cordova plugin add cordova-fabric-plugin --variable FABRIC_API_KEY="1111" --variable FABRIC_API_SECRET="111"',
  'cordova plugin add cordova-plugin-app-preferences',
  'cordova plugin add cordova-plugin-inapppurchase',
  'cordova plugin add phonegap-plugin-push@1.8.4 --variable SENDER_ID="111"',
  'cp -f www/js/controller.purchase.alexdisler.js www/js/controller.purchase.js',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'cp ads.ios.tw.client.config.js www/tw.client.config.js',
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
