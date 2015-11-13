var config = {
    seleniumAddress: 'http://localhost:4444/wd/hub',
    specs: ['defaults.js'],
    capabilities: {
        browserName: 'phantomjs'
    },
    files: [
        'http://code.jquery.com/jquery-1.9.1.js',
        'https://cdnjs.cloudflare.com/ajax/libs/chai/3.4.0/chai.js',
        'https://ajax.googleapis.com/ajax/libs/angularjs/1.4.7/angular.js',
        'https://ajax.googleapis.com/ajax/libs/angularjs/1.4.7/angular-resource.js',
        'https://ajax.googleapis.com/ajax/libs/angularjs/1.4.7/angular-mocks.js',
        'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.10.6/moment.js',
        'www/js/app.js',
        'www/js/controllers.js',
        'www/js/services.js',
    ]
};

exports.config = config;
