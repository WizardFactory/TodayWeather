'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const calendar = require('../../lib/solarTerms/calendar');
const official = require('../../lib/solarTerms/official');
const {checkYears, publish, refresh} = require('../../lib/solarTerms/maintenance');
const mount = require('../../routes/solarTerms');
const seeds = require('../../lib/solarTerms/published.json');
const fixture = year => fs.readFileSync(path.join(__dirname, 'fixtures/solar-terms', year + '.txt'), 'utf8');
const url2024 = 'https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001687328191439000&tocId=I0000000000000001686831567351000&isTocOrder=N';
const url2027 = seeds[1].sourceUrl;

function checkAstronomy() {
    const calculated = calendar.calculate(2024);
    const edition = official.parseEdition(2024, url2024, '1'.repeat(64), fixture(2024));
    assert.deepStrictEqual(calculated.map(term => term.date), edition.dates);
    const crossing = calculated.find(term => term.id === 'solar-0');
    assert.equal(crossing.nameKo, '춘분');
    assert.equal(crossing.date, '2024-03-20');
    assert.ok(calculated.some(term => term.utc.slice(0, 10) !== term.date));
    for (const seed of seeds) {
        assert.deepStrictEqual(calendar.calculate(seed.year).map(term => term.date), seed.dates);
    }
    const clock = () => new Date('2026-02-01T00:00:00Z');
    const horizon = calendar.createCalendar({now: clock, futureYears: 50});
    for (let year = 2026; year <= 2076; year++) {
        const terms = horizon.readYear(year).terms;
        assert.equal(new Set(terms.map(term => term.id)).size, 24);
        assert.equal(new Set(terms.map(term => term.nameKo)).size, 24);
        const dates = terms.map(term => term.date);
        assert.deepStrictEqual(dates, [...dates].sort());
        assert.ok(dates.every(date => date.startsWith(year + '-')));
    }
    // Crossing close to KST midnight: verify it against its own independent published row.
    const near = seeds.flatMap(seed => calendar.calculate(seed.year).map((term, i) => ({
        term, officialDate: seed.dates[i], kstMinutes: (Date.parse(term.utc) / 60000 + 540) % 1440
    }))).find(hit => Math.min(hit.kstMinutes, 1440 - hit.kstMinutes) < 20);
    assert.ok(near);
    assert.equal(near.term.date, near.officialDate);
}

async function checkSource() {
    const text = fixture(2027);
    const markup = '<h3>2027년 월력요항</h3><button id="gwanboLink" onclick="window.open(\'' + url2027 + '\')">';
    const get = official.locateEdition(markup, 2027);
    assert.equal(get.sourceUrl, url2027);
    assert.throws(() => official.locateEdition(markup, 2028));
    assert.throws(() => official.locateEdition(markup.replace('www.gwanbo.go.kr', 'untrusted.example'), 2027));
    assert.throws(() => official.parseEdition(2028, url2027, '0'.repeat(64), text));
    assert.throws(() => official.parseEdition(2027, url2027, '0'.repeat(64), text.replace('대한', '소한')));
    assert.throws(() => official.parseEdition(2027, url2027, '0'.repeat(64), text.replace(/.*처서.*\n/, '')));
    assert.throws(() => calendar.isoDate(2027, 2, 29));
    assert.deepStrictEqual(checkYears(new Date('2026-05-31T14:59:59Z')), [2026]);
    assert.deepStrictEqual(checkYears(new Date('2026-05-31T15:00:00Z')), [2026, 2027]);
    const calls = [];
    const downloaded = await official.fetchEdition(2027, async (url, form) => {
        calls.push([url, form]);
        return Buffer.from(form ? '%PDF-test' : markup);
    }, async () => text);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1], 'cntnt_seq_no=' + get.toc);
    assert.deepStrictEqual(downloaded.edition.dates, seeds[1].dates);
    return downloaded;
}

function fixtureCollection() {
    const docs = new Map();
    return {
        async insertOne(doc) {
            if (docs.has(doc._id)) throw Object.assign(new Error('duplicate'), {code: 11000});
            docs.set(doc._id, doc);
        },
        async findOne(query) { return docs.get(query._id); },
        find(query) {
            return {sort() { return {async toArray() {
                return [...docs.keys()].sort().filter(key => key >= query._id.$gte && key < query._id.$lt)
                    .map(key => docs.get(key));
            }}; }};
        }
    };
}

async function checkLookup(item, db) {
    let instant = '2026-12-31T14:59:59Z';
    const create = () => calendar.createCalendar({now: () => new Date(instant)});
    const target = create();
    const app = express();
    mount(app, target);
    const calendarGet = year => request(app).get('/calendar/v1/kr/solar-terms/' + year);
    assert.equal((await calendarGet('foo')).status, 400);
    assert.equal((await calendarGet(2047)).status, 404);
    const missing = express();
    mount(missing, {inRange: () => true, readYear: () => null});
    assert.equal((await request(missing).get('/calendar/v1/kr/solar-terms/2027')).status, 503);
    const initial = await calendarGet(2027);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, 'calculated');
    assert.equal(initial.body.terms.length, 24);
    assert.equal((await calendarGet(2027).set('If-None-Match', initial.headers.etag)).status, 304);
    const unaffected = target.readYear(2026);
    await publish(db, item);
    await refresh(db, target);
    const matched = await calendarGet(2027).set('If-None-Match', initial.headers.etag);
    assert.equal(matched.status, 200);
    assert.equal(matched.body.status, 'verified');
    assert.deepStrictEqual(matched.body.terms, initial.body.terms);
    // Deliberately altered fixture: later gazette corrects just 입춘 by one KST day.
    const amended = {...item.edition, dates: [...item.edition.dates], id: '2026-0090',
        order: '2026-07-02/000000090', publicationDate: '2026-07-02', sourceDigest: calendar.digest('new PDF')};
    amended.dates[2] = '2027-02-05';
    const revision = {edition: amended, pdf: Buffer.from('new PDF')};
    await Promise.all([publish(db, revision), publish(db, revision), publish(db, item)]);
    await refresh(db, target);
    target.apply(item.edition);
    const corrected = target.readYear(2027);
    assert.equal(corrected.terms[2].date, '2027-02-05');
    assert.equal(corrected.terms.filter(term => term.corrected).length, 1);
    assert.equal(target.readYear(2026), unaffected);
    assert.notEqual(corrected.revision, matched.body.revision);
    assert.equal(corrected.terms[2].id, 'solar-315');
    const restarted = create();
    restarted.beginRestore();
    assert.equal(restarted.readYear(2027), null);
    assert.equal(restarted.readYear(2028).status, 'calculated');
    await refresh(db, restarted);
    assert.deepStrictEqual(restarted.readYear(2027), corrected);
    await assert.rejects(publish(db, {...revision, pdf: Buffer.from('other')}));
    await assert.rejects(publish(db, {pdf: Buffer.from('conflict'), edition:
        {...amended, sourceDigest: calendar.digest('conflict')}}));
    assert.throws(() => target.apply({...amended, dates: amended.dates.slice(1)}));
    assert.equal(target.readYear(2027), corrected);
    instant = '2026-12-31T15:00:00Z';
    assert.equal(target.readYear(2026), null);
    assert.equal(target.readYear(2047).terms.length, 24);
}

(async () => {
    checkAstronomy();
    const downloaded = await checkSource();
    const port = process.env.SOLAR_TEST_MONGO_PORT;
    if (port) {
        if (!/^\d{1,5}$/.test(port)) throw new Error('Invalid localhost test Mongo port');
        const client = await require('mongodb').MongoClient.connect('mongodb://127.0.0.1:' + port + '/');
        try {
            const unique = require('crypto').randomBytes(12).toString('hex');
            await checkLookup(downloaded, client.db('solar_terms_test_' + unique).collection('editions'));
        } finally { await client.close(); }
    } else {
        await checkLookup(downloaded, fixtureCollection());
    }
    console.log('Annual lookup, independent gazette dates, June checks, replay, corrections and KST rollover passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
