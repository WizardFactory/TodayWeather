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

release mobile application

check version config.xml, package.json

build
```bash
$ cordova plugin rm cordova-plugin-console
$ ionic build --release android
$ ionic build --release ios
```
import android widget

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


