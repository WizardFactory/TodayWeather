'use strict';
// Explicit isolated test. Never accepts a database URI; owns a new local mongod.
// Provide an already installed binary, so the test does not download anything.
const assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    http = require('http');
if (!process.env.MONGOMS_SYSTEM_BINARY || !fs.existsSync(process.env.MONGOMS_SYSTEM_BINARY)) {
    console.error(
        'Set MONGOMS_SYSTEM_BINARY to an existing isolated-test mongod binary; no downloads allowed.',
    );
    process.exit(2);
}
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const MongoClient = require('mongodb').MongoClient;
const Store = require('../../lib/awsMinute/store'),
    parser = require('../../lib/awsMinute/parser'),
    policy = require('../../lib/awsMinute/policy');
const service = require('../../lib/awsMinute/service'),
    client = require('../../lib/awsMinute/http'),
    cli = require('../../lib/awsMinute/cli');
const now = Date.parse('2026-09-25T05:10:00Z');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/aws-minute/valid.html'));
(async () => {
    let mongod, server, connection;
    try {
        mongod = await MongoMemoryServer.create({
            binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
            instance: { ip: '127.0.0.1', dbName: 'aws_minute_isolated' },
        });
        connection = await MongoClient.connect(mongod.getUri(), {
            connectTimeoutMS: 5000,
            socketTimeoutMS: 6000,
        });
        const store = new Store(connection.db('aws_minute_isolated')),
            rows = parser.parse(
                {
                    body: fixture,
                    statusCode: 200,
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                },
                now,
            ).rows;
        await Promise.all(Array.from({ length: 20 }, () => store.save(rows[0])));
        assert.strictEqual(await store.records.countDocuments({}), 1);
        await store.save({ ...rows[0], values: { t1h: 99 } });
        assert.strictEqual(
            (await store.latest('108', now)).values.t1h,
            22,
            'same publication immutable',
        );
        const older = {
            ...rows[0],
            _id: policy.id('108', now - 5 * 60000),
            observedAt: new Date(now - 5 * 60000),
            values: { t1h: 21 },
        };
        await store.save(older);
        assert.strictEqual((await store.latest('108', now)).values.t1h, 22);
        assert.strictEqual(
            await store.latest('108', now + 19 * 60000),
            null,
            'exact 20 minute boundary excluded',
        );
        const owners = await Promise.all([store.acquire(), store.acquire()]);
        assert.strictEqual(owners.filter(Boolean).length, 1);
        await store.release('wrong-owner');
        assert.strictEqual(await store.acquire(), null);
        await store.release(owners.find(Boolean));
        const token = await store.acquire();
        assert(token);
        await store.release(token);
        const indexes = await store.records.indexes();
        assert.deepStrictEqual(
            indexes.map((i) => i.name),
            ['_id_'],
        );
        const plan = await store.records
            .find({
                _id: { $gt: policy.id('108', now - policy.WINDOW), $lte: policy.id('108', now) },
            })
            .sort({ _id: -1 })
            .limit(1)
            .explain('executionStats');
        assert(JSON.stringify(plan.queryPlanner.winningPlan).includes('IXSCAN'));
        assert(plan.executionStats.totalDocsExamined <= 1);
        console.log(
            'PASS isolated Mongo: 20 concurrent duplicate upserts -> 1 record; immutable same-time replay, older replay, unique owner, _id query plan',
        );
        // Only this fresh, isolated test database creates station metadata/index.
        await store.stations.createIndex({ geo: '2d' });
        await store.stations.insertOne({
            stnId: '108',
            stnName: 'Seoul',
            isCityWeather: true,
            geo: [126.98, 37.57],
        });
        assert.strictEqual(
            (await store.mapping({ gCoord: { lon: 126.978, lat: 37.5665 } })).stationId,
            '108',
        );
        // Additional functional smoke: real localhost HTTP transport -> parser -> collector -> native DB -> service overlay.
        // Use current source time for collector's real clock, without any public provider request.
        const ms = Date.now() - 60000,
            kst = new Date(ms + 9 * 3600000).toISOString();
        const pub = kst.slice(0, 10).replace(/-/g, '.') + '.' + kst.slice(11, 16);
        const body = Buffer.from(fixture.toString().replace('2026.09.25.14:09', pub));
        server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(body);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const url = 'http://127.0.0.1:' + server.address().port;
        let logs = [];
        const result = await cli.run(
            { enabled: true, once: true },
            {
                openStore: async () => store,
                fetch: (opts) => client.fetch({ ...opts, url }),
                log: (r) => logs.push(r),
            },
        );
        assert(result.ok);
        assert.strictEqual(result.written, 2);
        assert.strictEqual(await store.owners.countDocuments({}), 0);
        const original = {
            date: '20260925',
            time: '1400',
            t1h: 23.5,
            reh: 60,
            vec: 90,
            wsd: 3,
            sky: 3,
            pty: 0,
            rn1: 0,
        };
        const req = {
            current: { ...original },
            currentList: [{ ...original }],
            short: [{ t3h: 24 }],
            _awsMinuteSources: {},
        };
        policy.fields.forEach(
            (f) =>
                (req._awsMinuteSources[f] = {
                    value: original[f],
                    observedAt: new Date(Date.now() - 10 * 60000).toISOString(),
                }),
        );
        const arrays = JSON.stringify([req.currentList, req.short]),
            headers = {};
        await new Promise((resolve) =>
            service.enrich(req, { setHeader: (k, v) => (headers[k] = v) }, resolve, {
                enabled: true,
                store,
                town: { gCoord: { lon: 126.978, lat: 37.5665 } },
            }),
        );
        assert.strictEqual(req.current.t1h, 22);
        assert.strictEqual(req.current.reh, 70);
        assert.strictEqual(req.current.wsd, 0);
        assert.strictEqual(JSON.stringify([req.currentList, req.short]), arrays);
        assert.strictEqual(headers['Cache-Control'], 'max-age=120');
        console.log(
            'PASS functional smoke: localhost HTTP -> real parser/collector -> isolated Mongo -> independent current overlay, 23.5 -> 22, arrays intact',
        );
        console.log(
            JSON.stringify({
                mongoVersion: '7.0.14',
                station: req.current.minuteObservation.stationId,
                observedAt: req.current.minuteObservation.observedAt,
                recordsWritten: result.written,
                docsExamined: plan.executionStats.totalDocsExamined,
            }),
        );
    } finally {
        if (server) await new Promise((r) => server.close(r));
        if (connection) await connection.close();
        if (mongod) await mongod.stop();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
