# TodayWeather
Inform how warm or cold it is today than yesterday.

## Architecture documentation

See the [service architecture guide](docs/architecture/README.md) for the overall structure, weather collection pipeline, mobile API calls, and interactive Archify diagrams. Shared contributor and agent guidance is maintained in [AGENTS.md](AGENTS.md).

For server/client replacement planning, see the [rewrite reference package](docs/rewrite/README.md): screen definitions and simulator screenshots, data contracts and examples, ordered server assembly diagrams, migration decisions, and verification criteria.

For a browser client alongside iOS and Android, see the [webapp documentation](docs/webapp/README.md): the static PWA, direct existing-API access, remaining mobile-parity goals and deployment preparation.

## Running Locally
You have to run server before start mobile application.

download source
```bash
$ git clone https://github.com/WizardFactory/TodayWeather.git
```

### weather rest api server
Make sure you have [Node.js](http://nodejs.org/)

move to server folder
```bash
$ cd TodayWeather/server/
```

install node modules
```bash
$ npm install
```

run
```bash
$ npm install
```

### mobile application
TodayWeather builds with Cordova 13 from npm scripts (cordova-android 15, targetSdk 36; cordova-ios 8, iOS 15+). gulp and `ionic state` are no longer used.

```bash
$ cd TodayWeather/client/
$ npm ci
$ cp .env.example .env          # fill in names and paths; no secret values
$ npm run release:fetch         # release files (Firebase config, keystore, build.json, client config) from S3
$ npm run build:android         # debug build with Google's test ad units
$ npm run emulate:ios           # debug build on the iOS Simulator
```

`npm run www` prepares `www/` (bower libs, SCSS, `www/client.config.js`, Firebase config files). Debug and emulator builds always use Google's test ad units.

### release mobile application

Check the version in `config.xml` (`version`, `android-versionCode`, `ios-CFBundleVersion`); it must exceed the store versions.

```bash
$ npm run build:android:release   # signed AAB: platforms/android/app/build/outputs/bundle/release/app-release.aab
$ npm run build:ios:release       # prepares platforms/ios; archive and sign in Xcode (App.xcworkspace, Product > Archive)
```

iOS builds need full Xcode as the active developer directory (`sudo xcode-select -s /Applications/Xcode.app`, or `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`).

Both use the real AdMob app IDs and ad units and refuse to continue if `www/client.config.js` still holds test ad units. Release builds show no ads while the AdMob consent (UMP) message is not published.

### import android widget

Legacy procedure: the Cordova 1.1.0 build ships without widgets (they return with the native app, #2605).


copy widget files and overwrite strings.xml
```bash
cd platforms/android/src/net/wizardfactory/todayweather/
cp -af ../../../../../../../android/src/net/wizardfactory/todayweather/widget ./
cd -
cd platforms/android/res/drawable-xhdpi
cp ../../../../../android/res/drawable-xhdpi/* ./
cd -
cd platforms/android/res
cp -af ../../../../android/res/layout ./
cp ../../../../android/res/xml/w2x1_widget_provider.xml xml/
cd -
cd platforms/android/res
cp ../../../../android/res/values/strings.xml values/strings.xml 
```

add activity and service for widget
```bash
cd platforms/android/
vimdiff AndroidManifest.xml ../../../android/AndroidManifest.xml
```

### import apple watch app

현재 동작오류로 유보하였음.

1. ionic build ios에 의해서 생성된 xcode 프로젝트에서 File/New/Target -> WatchKit App for watchOS1을 선택
2. WatchKit App을 선택할 경우 정상적으로 실행되지 않습니다(시뮬레이터는 실행됩니다.). 아래의 에러코드 발생

 ```
ld: framwork not found AVFoundation
clang: error: linker command failed with exit code 1 (use -v to see invocation)
```
1. Include Notification Scense 체크박스 해제
3. 생성된 targets의 Version과 Build가 iPhone app과 모두 동일해야 합니다.
4. 모든 프로젝트의 Capabilities/App Groups에서 그룹을 추가해야 합니다.
5. applewatch 폴더 하위의 watch app과 extension 폴더를 platforms/ios에 복사

 ```bash
$ cd platforms/ios/
$ cp -rf ../../../applewatch/TodayWeather\ WatchKit\ 1\ App ./
$ cp -rf ../../../applewatch/TodayWeather\ WatchKit\ 1\ Extension ./
```
6. 실제 watch를 이용하여 테스트할 경우에는 target project를 watch app으로 변경하고, WatchKit1 App의 Build Settings의 Deployment에서 iOS Deployment Target을 iOS 8.2로 변경합니다.
7. App group에 문제가 발생할 경우 메인 project의 App Group을 한번 껐다켜고 4번 과정을 다시 실행한다.
8. 프로젝트를 모두 복사한게 아니므로 이미지 파일은 watch app 폴더에서 확인하고, Xcode IDE의 프로젝트 디렉토리로 드래그 해야한다. - Copy items if needed 를 체크한다.

### Publishing

Mobile (Android and iOS): see "release mobile application" above.

chrome extension

```bash
$ cd ../../chromeExtension
$ gulp sass;gulp manifest;gulp www;gulp uglify
$ zip -r TodayWeather_chromeExtension.zip chrome
```
publish on https://chrome.google.com/webstore/developer/dashboard

## Web app

The responsive web app is a static PWA that calls the existing public API directly. It needs no additional Node API server and runs independently of Cordova. Browser notifications are unavailable; native apps remain the notification option. See [run instructions and implementation status](docs/webapp/implementation.md), [S3/CloudFront deployment](infra/web/static/README.md), and [issue #2558](https://github.com/WizardFactory/TodayWeather/issues/2558).

```sh
npm ci --ignore-scripts
VITE_WEB_MODE=demo npm run dev
```
