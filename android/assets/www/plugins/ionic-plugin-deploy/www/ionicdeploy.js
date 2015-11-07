cordova.define("ionic-plugin-deploy.IonicDeploy", function(require, exports, module) { var IonicDeploy = {
  init: function(app_id, server_host, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'initialize',
      [app_id, server_host]
    );
  },
  check: function(app_id, channel_tag, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'check',
      [app_id, channel_tag]
    );
  },
  download: function(app_id, success, failure) {
  	cordova.exec(
  		success,
  		failure,
  		'IonicDeploy',
  		'download',
  		[app_id]
  	);
  },
  extract: function(app_id, success,failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'extract',
      [app_id]
    );
  },
  redirect: function(app_id, success, failure) {
  	cordova.exec(
  		success,
  		failure,
  		'IonicDeploy',
  		'redirect',
  		[app_id]
  	);
  },
  info: function(app_id, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'info',
      [app_id]
    );
  },
  getVersions: function(app_id, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'getVersions',
      [app_id]
    );
  },
  deleteVersion: function(app_id, version, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'deleteVersion',
      [app_id, version]
    );
  },
  getMetadata: function(app_id, uuid, success, failure) {
    cordova.exec(
      success,
      failure,
      'IonicDeploy',
      'getMetadata',
      [app_id, uuid]
    );
  }
}

module.exports = IonicDeploy;

});
