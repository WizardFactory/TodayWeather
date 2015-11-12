# TodayWeather
Inform how warm or cold it is today than yesterday.

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
Make sure you have [ionic](http://ionicframework.com/)

move to mobile folder
```bash
$ cd TodayWeather/client/
```

ionic clear and reinstall plugins and platforms
```bash
$ ionic state reset
```

add crosswalk browser for android
```bash
ionic browser add crosswalk
```

install gulp and bower

```bash
$ npm install
```

install www/lib

```bash
$ bower install
```

hook up with IONIC.IO
```bash
$ ionic io init
```

sass preprocessing - it makes www/css/ionic.app.css

```bash
$ gulp sass
```

build and run application for iOS

```bash
$ ionic run ios
```

### release mobile application

check version config.xml, package.json

build
```bash
$ cordova plugin rm cordova-plugin-console
$ ionic build --release android
$ ionic build --release ios
```

### import android widget

copy widget files
```bash
$ cd platforms/android/src/net/wizardfactory/todayweather/
$ cp ../../../../../../../android/src/net/wizardfactory/todayweather/widget ./
$ cp -af ../../../../../../../android/src/net/wizardfactory/todayweather/widget ./
$ cd platforms/android/res/drawable-xhdpi
$ cp ../../../../../android/res/drawable-xhdpi/* ./
$ cd platforms/android/res
$ cp -af ../../../../android/res/layout ./
$ cp ../../../../android/res/xml/w2x1_widget_provider.xml xml/
```  

overwrite strings.xml
```bash
$ cd platforms/android/res
$ cp ../../../../android/res/values/strings.xml values/strings.xml 
```

add activity and service for widget
set android:minSdkVersion to 14
```bash
$ vimdiff vimdiff AndroidManifest.xml ../../../android/AndroidManifest.xml
```

### import apple watch app

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

ionic deploy
```bash
$ ionic upload
```

android
```bash
$ ionic build --release android
$ cp platforms/android/build/outputs/apk/android-armv7-release-unsigned.apk ./
$ jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 -keystore my-release-key.keystore android-armv7-release-unsigned.apk alias_name
$ ~/Library/Android/sdk/build-tools/VERSION/zipalign android-armv7-release-unsigned.apk TodayWeather_V0.00.00.apk
```

ios
1. run xcode
2. general -> device : iPhone, check Hide status bar
3. connect iPhone by USB
4. Menu -> Product -> Archives
