'use strict';
// Read-only operator tool. Compare against the live gazette or replay retained PDF bytes.
const fs = require('fs');
const calendar = require('../lib/solarTerms/calendar');
const {fetchEdition, extractText, parseEdition} = require('../lib/solarTerms/official');

async function run([yearText, pdfPath, sourceUrl]) {
    if (!/^\d{4}$/.test(yearText) || Boolean(pdfPath) !== Boolean(sourceUrl)) {
        throw new Error('Usage: node utils/solar-term-almanac.js YEAR [GAZETTE.pdf GAZETTE_VIEWER_URL]');
    }
    const year = Number(yearText);
    let edition;
    if (pdfPath) {
        const pdf = fs.readFileSync(pdfPath);
        edition = parseEdition(year, sourceUrl, calendar.digest(pdf), await extractText(pdf));
    } else {
        edition = (await fetchEdition(year)).edition;
    }
    const terms = calendar.calculate(year).map((term, i) => {
        const local = new Date(Date.parse(term.utc) + 9 * 3600000);
        const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
        return {...term, officialDate: edition.dates[i], corrected: term.date !== edition.dates[i],
            nearMidnight: minutes < 30 || minutes >= 1410};
    });
    console.log(JSON.stringify({algorithm: calendar.algorithm, edition, terms}, null, 2));
}
run(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
