/**
 * v000903 overseas weather: the v000902 route with hourly/daily rows from the day before yesterday,
 * like the domestic view (#2585). Other versions and the widgets' /ww keep the yesterday-based range.
 */
'use strict';

var express = require('express');
var router = express.Router();

router.use(function (req, res, next) {
    req.dsfFromDayBeforeYesterday = true;
    next();
});
router.use(require('../v000902/route.dsf.coord.v000902'));

module.exports = router;
