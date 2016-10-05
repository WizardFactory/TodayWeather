var gulp = require('gulp');
var gutil = require('gulp-util');
var bower = require('bower');
var concat = require('gulp-concat');
var sass = require('gulp-sass');
var minifyCss = require('gulp-minify-css');
var rename = require('gulp-rename');
var sh = require('shelljs');
var fs = require('fs');
var rmplugin = require('gulp-cordova-plugin-remove');

var shell = require('gulp-shell');

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

gulp.task('build', shell.task([
  'ionic state reset',
  'cp -a ../ios platforms/',
  'cp -a ../android platforms/',
  'ionic state restore --plugins',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'ionic build'
]));

gulp.task('release', shell.task([
  'ionic state reset',
  'cp -a ../ios platforms/',
  'cp -a ../android platforms/',
  'ionic state restore --plugins',
  'npm install',
  'cd node_modules/cordova-uglify/;npm install',
  'bower install',
  'gulp sass',
  'ionic build --release'
]));

/**
 * it does not works perfectly
 */
gulp.task('rmplugins', function () {
  var pluginList = JSON.parse(fs.readFileSync('./package.json')).cordovaPlugins;
  pluginList = pluginList.map(function (plugin) {
    if (typeof plugin === 'string') {
      return plugin;
    }
    else {
      if (plugin.hasOwnProperty('id')) {
        return plugin.id;
      }
    }
  });
  console.log(pluginList);
  return gulp.src('./').pipe(rmplugin(pluginList));
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
