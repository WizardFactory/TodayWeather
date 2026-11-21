'use strict';
const calendar = require('./calendar');
const {fetchEdition} = require('./official');

// Immutable edition keys make the effective pointer max(publication date, serial).
// This election is independent of arrival order across gather hosts. Readers
// fetch complete editions in a single document, including after a process restart.
async function publish(collection, item) {
    const {edition, pdf} = item;
    calendar.validateEdition(edition);
    if (calendar.digest(pdf) !== edition.sourceDigest) throw new Error('Official document digest mismatch');
    const key = edition.year + ':' + edition.order;
    const document = {_id: key, edition, pdf, verifiedAt: new Date(), algorithm: calendar.algorithm};
    try {
        await collection.insertOne(document);
    } catch (error) {
        if (error.code !== 11000) throw error;
        const prior = await collection.findOne({_id: key}, {projection: {edition: 1}});
        if (!prior || prior.edition.sourceDigest !== edition.sourceDigest ||
            JSON.stringify(prior.edition.dates) !== JSON.stringify(edition.dates)) {
            throw new Error('Conflicting publication for an existing gazette edition');
        }
    }
}

async function refresh(collection, target, onInvalid = err => { throw err; }) {
    const first = target.currentYear();
    // The _id prefix is indexed. Exclude PDFs when loading the small hot catalog.
    const rows = await collection.find({_id: {$gte: first + ':', $lt: (first + 2) + ':'}},
        {projection: {edition: 1}}).sort({_id: 1}).toArray();
    for (const row of rows) {
        try { target.apply(row.edition); }
        catch (err) { onInvalid(err); }
    }
    target.finishRestore();
}

function checkYears(now) {
    const kst = calendar.koreaDate(now);
    const year = Number(kst.slice(0, 4));
    return Number(kst.slice(5, 7)) >= 6 ? [year, year + 1] : [year];
}

function start(connection, gather, logger) {
    calendar.beginRestore();
    let reading = false, lastCheck;
    async function tick() {
        if (reading) return;
        reading = true;
        try {
            calendar.prepare();
            if (connection.readyState !== 1) return;
            const collection = connection.db.collection('krSolarTermEditions');
            await refresh(collection, calendar, err => logger.warn('Rejected solar term edition: ' + err.message));
            const date = new Date();
            const day = calendar.koreaDate(date);
            if (!gather || lastCheck === day) return;
            lastCheck = day;
            for (const year of checkYears(date)) {
                try {
                    const item = await fetchEdition(year);
                    await publish(collection, item);
                    calendar.apply(item.edition);
                } catch (err) { logger.warn('Solar term verification ' + year + ': ' + err.message); }
            }
        } catch (err) { logger.warn('Solar term catalog refresh: ' + err.message); }
        finally { reading = false; }
    }
    const timer = setInterval(tick, 60000);
    timer.unref();
    connection.once('open', tick);
    tick();
    return timer;
}
module.exports = {publish, refresh, checkYears, start};
