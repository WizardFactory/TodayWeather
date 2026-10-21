'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const {shiftRaw} = require('./shift-raw');
const boundary = require('./asos-boundary');
async function asos(L, context, now) {
    // Only provider raw response bytes from the old public fixture are read, never
    // its expected store/read/report values. Current legacy revalidates/converts them.
    const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(L.root, 'server2/tests/domestic/fixtures/stations.json.gz'))));
    const original = fixture.asos.find(r => r.id === 'october-108').runs[0].requests;
    const bodies = {};
    for (const request of original) {
        const body = JSON.parse(shiftRaw(request.body, 1));
        if (body.response.header.resultCode !== '00') throw new Error('ASOS raw input must be successful');
        bodies[request.kind] = JSON.stringify(body);
    }
    const records = boundary.collection(), leases = boundary.collection();
    context.mongoose.connection.db = {collection: name => name === 'asos_history' ? records : name === 'asos_history_leases' ? leases : (() => {throw new Error('Unexpected native collection')})()};
    const Store = L.load('lib/history/store.js'), Provider = L.load('lib/history/provider.js'), Recovery = L.load('lib/history/recovery.js');
    const policy = L.load('lib/history/policy.js');
    const window = policy.window(now);
    const requests = [];
    const provider = new Provider({key:'synthetic-offline-key',transport:boundary.transport(kind => ({body:bodies[kind]}),requests),sleep:()=>Promise.resolve()});
    const store = new Store(records, leases);
    const report = await new Recovery(store, provider).run('108', window.start, window.end, now);
    return {requests, window, report, records:context.ej(records.docs)};
}
module.exports = {asos};
