'use strict';
const calendar = require('../lib/solarTerms/calendar');

function mount(app, source = calendar) {
    app.get('/calendar/v1/kr/solar-terms/:year', (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!/^\d{4}$/.test(req.params.year)) return res.status(400).json({error: 'invalid_year'});
        const year = Number(req.params.year);
        if (!source.inRange(year)) return res.status(404).json({error: 'year_out_of_range'});
        const body = source.readYear(year);
        if (!body) return res.status(503).json({error: 'calendar_unavailable'});
        res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
        res.set('ETag', '"' + body.revision + '"');
        return res.json(body);
    });
}
module.exports = mount;
