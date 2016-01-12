/**
 * New Relic agent configuration.
 *
 * See lib/config.defaults.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */

var config = require('./config/config');

exports.config = {
  /**
   * Array of application names.
   */
  app_name: [config.mode],
  /**
   * Your New Relic license key.
   */
  license_key: config.keyString.newrelic,
  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'info'
  }
};
