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

install gulp and bower

```bash
$ npm install
```

install www/lib

```bash
$ bower install
```

sass preprocessing - it makes www/css/ionic.app.css

```bash
$ gulp sass
```

build and run application for iOS

```bash
$ ionic run ios
```
