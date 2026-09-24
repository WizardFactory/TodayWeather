'use strict';
const assert = require('node:assert/strict');
const p = require('../../lib/history/policy'),
    Recovery = require('../../lib/history/recovery'),
    Provider = require('../../lib/history/provider');
const now = Date.parse('2026-09-24T07:27:00Z');
function store() {
    const rows = new Map();
    let locked = false;
    return {
        rows,
        acquire: async () => {
            if (locked) return null;
            locked = true;
            return 'token';
        },
        release: async () => {
            locked = false;
        },
        read: async (kind, stn, a, b) =>
            [...rows.values()].filter(
                (r) => r.kind === kind && r.stationId === stn && r.key >= a && r.key <= b
            ),
        save: async (r) => {
            const prev = rows.get(r._id);
            rows.set(r._id, prev ? { ...prev, values: { ...r.values, ...prev.values } } : r);
        }
    };
}
function source() {
    const calls = [];
    return {
        calls,
        fetch: async (kind, station, range) => {
            calls.push({ kind, station, range });
            let out = [];
            for (
                let ms = p.instant(range.start);
                ms <= p.instant(range.end);
                ms += kind === 'hourly' ? 3600000 : 86400000
            ) {
                const key = p.key(ms, kind === 'daily');
                const date = key.slice(0, 4) + '-' + key.slice(4, 6) + '-' + key.slice(6, 8);
                out.push({
                    stnId: station,
                    tm: date + (kind === 'hourly' ? ' ' + key.slice(8, 10) + ':00' : ''),
                    ta: '21',
                    hm: '70',
                    minTa: '12',
                    maxTa: '26'
                });
            }
            return out;
        }
    };
}
(async () => {
    let passed = 0;
    async function check(name, fn) {
        await fn();
        passed++;
        console.log('PASS ' + name);
    }
    await check('multi-day missing-only recovery and sequential idempotency', async () => {
        const db = store(),
            api = source(),
            r = new Recovery(db, api);
        let result = await r.run('108', '20260917', '20260923', now);
        assert(result.complete);
        assert.equal(db.rows.size, 175);
        assert.equal(api.calls.length, 2);
        result = await r.run('108', '20260917', '20260923', now);
        assert(result.complete);
        assert.equal(api.calls.length, 2);
        assert.equal(db.rows.size, 175);
    });
    await check('overlapping recovery is excluded by station lease', async () => {
        const db = store(),
            r = new Recovery(db, source());
        const results = await Promise.all([
            r.run('108', '20260923', '20260923', now),
            r.run('108', '20260923', '20260923', now)
        ]);
        assert(results.some((r) => r.failures.includes('busy')));
        assert.equal(db.rows.size, 25);
    });
    await check('wrong-date rows and duplicates rejected, unavailable data stays missing', async () => {
        const db = store(),
            api = {
                fetch: async (kind) =>
                    kind === 'hourly' ? [{ stnId: '108', tm: '2026-09-24 12:00', ta: '21', hm: '70' }] : []
            };
        const out = await new Recovery(db, api).run('108', '20260923', '20260923', now);
        assert.equal(out.complete, false);
        assert.equal(out.rejected, 1);
        assert.equal(out.missing.hourly.length, 24);
        assert.equal(out.missing.daily.length, 1);
        assert.equal(db.rows.size, 0);
    });
    await check('write failures cannot be reported as recovered', async () => {
        const db = store();
        db.save = async () => {
            throw new Error('HISTORY_STORAGE_WRITE');
        };
        const out = await new Recovery(db, source()).run('108', '20260923', '20260923', now);
        assert.equal(out.complete, false);
        assert.equal(out.failures.length, 2);
        assert.equal(out.missing.hourly.length, 24);
    });
    await check('partial cached temperature is preserved while humidity recovers', async () => {
        const db = store(),
            n = p.normalize(
                'hourly',
                { stnId: 108, tm: '2026-09-23 12:00', ta: '15' },
                '108',
                new Set(['202609231200']),
                now
            );
        await db.save(n);
        await new Recovery(db, source()).run('108', '20260923', '20260923', now);
        assert.equal(db.rows.get(n._id).values.t1h, 15);
        assert.equal(db.rows.get(n._id).values.reh, 70);
    });
    await check(
        'pagination validates every page and rejects truncated batches before persistence',
        async () => {
            const api = new Provider({ key: 'synthetic' });
            api.pageSize = 2;
            let calls = 0;
            api.page = async (k, s, r, page) => {
                calls++;
                return {
                    response: {
                        header: { resultCode: '00' },
                        body: {
                            pageNo: page,
                            numOfRows: 2,
                            totalCount: 3,
                            items: { item: page === 1 ? [{ rnum: 1 }, { rnum: 2 }] : [{ rnum: 3 }] }
                        }
                    }
                };
            };
            assert.equal((await api.fetch('hourly', '108', {})).length, 3);
            assert.equal(calls, 2);
            api.page = async () => ({
                response: {
                    header: { resultCode: '00' },
                    body: { pageNo: 1, numOfRows: 2, totalCount: 3, items: { item: [{}] } }
                }
            });
            await assert.rejects(api.fetch('hourly', '108', {}), /TRUNCATED/);
        }
    );

    await check('deadline stops a slow write batch before admitting another row', async () => {
        const db = store(),
            api = source(),
            save = db.save,
            clock = Date.now;
        let elapsed = 0;
        Date.now = () => now + elapsed;
        db.save = async (row) => {
            await save(row);
            elapsed += 11 * 60000;
        };
        try {
            const result = await new Recovery(db, api).run('108', '20260923', '20260923', now);
            assert.equal(db.rows.size, 1);
            assert.equal(api.calls.length, 1);
            assert.equal(result.complete, false);
            assert.equal(result.missing.hourly.length, 23);
            assert.equal(result.missing.daily.length, 1);
            assert(result.failures.some((f) => f.reason === 'HISTORY_DEADLINE'));
        } finally {
            Date.now = clock;
        }
    });
    console.log(JSON.stringify({ passed }));
})().catch((err) => {
    console.error(err.stack);
    process.exitCode = 1;
});
