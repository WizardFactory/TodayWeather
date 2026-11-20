'use strict';

const {createHash} = require('crypto');
const {SearchSunLongitude} = require('astronomy-engine');

const names = Object.freeze('소한 대한 입춘 우수 경칩 춘분 청명 곡우 입하 소만 망종 하지 소서 대서 입추 처서 백로 추분 한로 상강 입동 소설 대설 동지'.split(' '));
const algorithm = 'astronomy-engine/2.1.19';
const offset = 9 * 3600000;

function digest(data) {
    return createHash('sha256').update(data).digest('hex');
}
function koreaDate(instant) {
    return new Date(instant.valueOf() + offset).toISOString().slice(0, 10);
}
function isoDate(year, month, day) {
    const iso = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(iso)) ||
        new Date(iso).toISOString().slice(0, 10) !== iso) throw new Error('Invalid civil date');
    return iso;
}
function calculate(year) {
    return names.map((nameKo, i) => {
        const longitude = (285 + i * 15) % 360;
        const start = new Date(Date.UTC(year, Math.floor(i / 2), i % 2 ? 15 : 1) - offset);
        const hit = SearchSunLongitude(longitude, start, 13);
        if (!hit) throw new Error('Missing solar longitude crossing for ' + year);
        return {id: 'solar-' + longitude, nameKo, utc: hit.date.toISOString(), date: koreaDate(hit.date)};
    });
}

function buildYear(year, baseline, edition) {
    const terms = baseline.map((base, i) => {
        const date = edition ? edition.dates[i] : base.date;
        return Object.freeze({id: base.id, nameKo: base.nameKo, date, corrected: date !== base.date});
    });
    const officialEdition = edition ? Object.freeze({id: edition.id, sourceUrl: edition.sourceUrl,
        publicationDate: edition.publicationDate}) : null;
    const body = {year, timeZone: 'Asia/Seoul', status: edition ? 'verified' : 'calculated',
        officialEdition, terms: Object.freeze(terms)};
    body.revision = digest(JSON.stringify([algorithm, edition && edition.sourceDigest, body]));
    return Object.freeze(body);
}

// Readers always see a whole immutable year. Only the daily preparation / edition
// import paths calculate instants or publish data; a request does a map lookup.
function createCalendar(options = {}) {
    const now = options.now || (() => new Date());
    const future = options.futureYears === undefined ? 20 : Number(options.futureYears);
    if (!Number.isInteger(future) || future < 20 || future > 50) throw new Error('Invalid solar-term horizon');
    const records = new Map();
    let restoring = false;
    function currentYear() { return Number(koreaDate(now()).slice(0, 4)); }
    function inRange(year) { const first = currentYear(); return year >= first && year <= first + future; }
    function prepare() {
        const first = currentYear();
        // Stage one extra year so an instantaneous January rollover has no lookup gap.
        for (let year = first; year <= first + future + 1; year++) {
            if (!records.has(year)) {
                const baseline = calculate(year);
                records.set(year, {baseline, active: buildYear(year, baseline, null), edition: null});
            }
        }
        for (const year of records.keys()) if (year < first) records.delete(year);
    }
    function apply(edition) {
        validateEdition(edition);
        const record = records.get(edition.year);
        if (!record) return;
        const previous = record.edition;
        if (previous) {
            if (edition.order < previous.order) return;
            if (edition.order === previous.order) {
                if (edition.sourceDigest !== previous.sourceDigest ||
                    JSON.stringify(edition.dates) !== JSON.stringify(previous.dates)) {
                    throw new Error('Conflicting same-version almanac');
                }
                return;
            }
        }
        const active = buildYear(edition.year, record.baseline, edition);
        records.set(edition.year, {baseline: record.baseline, active, edition});
    }
    function readYear(year) {
        // On a service restart a newer gazette may be in Mongo. Never expose
        // bundled or calculated dates for an eligible year until restoration.
        if (restoring && year <= currentYear() + 1) return null;
        const record = records.get(year);
        return inRange(year) && record ? record.active : null;
    }
    prepare();
    for (const seed of options.seeds || []) apply(seed);
    return {prepare, apply, readYear, inRange, currentYear,
        beginRestore() { restoring = true; },
        finishRestore() { restoring = false; }
    };
}

function validateEdition(e) {
    if (!e || !Number.isInteger(e.year) || !/^\d{4}-\d+$/.test(e.id) ||
        !/^[0-9a-f]{64}$/.test(e.sourceDigest) || !Array.isArray(e.dates) || e.dates.length !== 24) {
        throw new Error('Incomplete official almanac');
    }
    const publication = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.publicationDate);
    const serial = e.id.split('-');
    if (!publication || isoDate(+publication[1], +publication[2], +publication[3]) !== e.publicationDate ||
        serial[0] !== publication[1] || e.order !== e.publicationDate + '/' + serial[1].padStart(9, '0') ||
        !/^https:\/\/www\.gwanbo\.go\.kr\/ezpdf\/customLayout\.jsp\?contentId=I\d+&tocId=I\d+&isTocOrder=N$/.test(e.sourceUrl)) {
        throw new Error('Invalid official edition identity');
    }
    e.dates.forEach((date, i) => {
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!parts || +parts[1] !== e.year || +parts[2] !== Math.floor(i / 2) + 1 ||
            isoDate(e.year, +parts[2], +parts[3]) !== date || (i && date <= e.dates[i - 1])) {
            throw new Error('Invalid official term dates');
        }
    });
}

const active = createCalendar({futureYears: process.env.SOLAR_TERMS_FUTURE_YEARS,
    seeds: require('./published.json')});
module.exports = {names, algorithm, digest, isoDate, koreaDate, calculate, validateEdition, createCalendar, ...active};
